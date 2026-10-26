import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonRequest, routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("@/lib/blended-learning-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/blended-learning-access")>()),
  getBlendedLearningAccess: vi.fn(),
}));

import { withTransaction } from "@/lib/db";
import { MENTOR, READ_ONLY_ADMIN, mockBlendedDb, rows, signedInAs } from "@/app/api/blended-learning/test-db";
import { POST } from "./route";

const mockFetch = vi.fn();
const QUEUED_KEY = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const IN_SCOPE = [{ mentor_user_id: 9001 }];
// Draft 41 with its active request, as readDraft reads it.
const STUCK = {
  id: 41, student_id: 501, state: "transcribing",
  request_key: QUEUED_KEY, request_state: "queued", request_stale: true,
};
const FAILED = { id: 41, student_id: 501, state: "failed", request_key: null, request_state: null, request_stale: null };

let db: ReturnType<typeof mockBlendedDb>;

// readDraft's two reads: the draft row, then the Student's Mapping.
function givenDraft(draft: Record<string, unknown>) {
  db.query.mockResolvedValueOnce([draft]).mockResolvedValueOnce(IN_SCOPE);
}

async function retry(draftId: string) {
  const res = await POST(
    jsonRequest(`http://localhost/api/blended-learning/drafts/${draftId}/retry`, { method: "POST" }),
    routeParams({ id: draftId })
  );
  return { status: res.status, body: await res.json() };
}

function enqueueUrl(key: string) {
  return `https://etl.test/api/internal/blended-learning/transcription-requests/${key}/enqueue`;
}

beforeEach(() => {
  vi.clearAllMocks();
  db = mockBlendedDb();
  mockFetch.mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal("fetch", mockFetch);
  vi.stubEnv("BLENDED_LEARNING_ETL_URL", "https://etl.test");
  vi.stubEnv("BLENDED_LEARNING_ETL_TOKEN", "etl-machine-token");
  vi.stubEnv("APP_ENV", "staging");
  signedInAs(MENTOR);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/blended-learning/drafts/[id]/retry", () => {
  it("wakes a request still queued after 10 minutes again with the same key, and writes nothing", async () => {
    givenDraft(STUCK);
    givenDraft(STUCK);

    expect(await retry("41")).toEqual({ status: 200, body: { id: 41, state: "transcribing", retryOffered: true } });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(enqueueUrl(QUEUED_KEY), expect.objectContaining({ method: "POST" }));
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("gives a failed draft a new queued request and moves it back to transcribing in one transaction", async () => {
    givenDraft(FAILED);
    db.clientQuery.mockResolvedValueOnce(rows({ id: 41 })).mockResolvedValueOnce(rows());
    // Afterwards: transcribing, with the new request queued under 10 minutes.
    givenDraft({ ...STUCK, request_key: "new", request_stale: false });

    expect(await retry("41")).toEqual({ status: 200, body: { id: 41, state: "transcribing", retryOffered: false } });
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(db.clientQuery).toHaveBeenNthCalledWith(1, expect.stringContaining("WHERE id = $1 AND state = 'failed'"), [41, "transcribing"]);
    expect(db.clientQuery).toHaveBeenNthCalledWith(2, expect.stringContaining("INSERT INTO blended_learning_transcription_requests"), [
      expect.any(String), 41, 501, MENTOR.actorEmail, "queued",
    ]);
    const newKey = db.clientQuery.mock.calls[1][1][0];
    expect(newKey).not.toBe(QUEUED_KEY);
    expect(mockFetch).toHaveBeenCalledWith(enqueueUrl(newKey), expect.objectContaining({ method: "POST" }));
  });

  it.each([
    ["a request queued under 10 minutes ago", { ...STUCK, request_stale: false }],
    ["a request ETL has picked up", { ...STUCK, request_state: "running" }],
    ["a ready draft", { ...FAILED, state: "ready" }],
  ])("returns 409 for %s, with no wake and no writes", async (_case, draft) => {
    givenDraft(draft);
    expect(await retry("41")).toEqual({ status: 409, body: { error: "This draft can't be retried now." } });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it("returns 409 when the failed draft moved on before the update", async () => {
    givenDraft(FAILED);
    db.clientQuery.mockResolvedValueOnce(rows());

    expect((await retry("41")).status).toBe(409);
    expect(db.clientQuery).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 401 when signed out, and 403 to those who can't manage drafts", async () => {
    signedInAs(null);
    expect((await retry("41")).status).toBe(401);
    for (const who of ["no access" as const, READ_ONLY_ADMIN]) {
      signedInAs(who);
      expect((await retry("41")).status).toBe(403);
    }
    expect(db.query).not.toHaveBeenCalled();
  });

  it("returns 404 for another Mentor's Mentee's draft, an unknown draft and a malformed id", async () => {
    db.query.mockResolvedValueOnce([STUCK]).mockResolvedValueOnce([{ mentor_user_id: 9002 }]);
    expect(await retry("41")).toEqual({ status: 404, body: { error: "Not found" } });
    expect(await retry("99")).toEqual({ status: 404, body: { error: "Not found" } });
    expect((await retry("4x")).status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
