import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/s3", () => ({ presignDocumentPage: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { presignDocumentPage } from "@/lib/s3";
import { GET } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockPresign = vi.mocked(presignDocumentPage);

const MENTOR_A = "faizan@avantifellows.org";
const MENTOR_B = "lokesh@avantifellows.org";
const ADMIN_READ_ONLY = "viewer@avantifellows.org";
const TEACHER = "teacher@avantifellows.org";

// Fixture tables, keyed the way the SQL reads them.
const PERMISSIONS: Record<string, { role: string; read_only: boolean; user_id: number }> = {
  [MENTOR_A]: { role: "blended_mentor", read_only: false, user_id: 9001 },
  [MENTOR_B]: { role: "blended_mentor", read_only: false, user_id: 9002 },
  [ADMIN_READ_ONLY]: { role: "blended_admin", read_only: true, user_id: 12 },
  [TEACHER]: { role: "teacher", read_only: false, user_id: 40 },
};
// Active current-year Mappings: student → Mentor user id. Student 503 is unmapped.
const MAPPINGS: Record<number, number> = { 501: 9001, 601: 9002 };
const CONVERSATIONS: Record<number, { student_id: number; kind: string; notes_html: null }> = {
  71: { student_id: 501, kind: "conversation", notes_html: null },
  72: { student_id: 501, kind: "conversation", notes_html: null },
  73: { student_id: 501, kind: "attempt", notes_html: null },
  81: { student_id: 601, kind: "conversation", notes_html: null },
  91: { student_id: 503, kind: "conversation", notes_html: null },
};
// Photo rows per Conversation, deliberately stored out of position order.
const PHOTOS: Record<number, { id: number; s3_key: string; content_type: string; position: number }[]> = {
  71: [
    { id: 702, s3_key: "lms-documents/blended-learning/photos/501/b.jpg", content_type: "image/jpeg", position: 2 },
    { id: 701, s3_key: "lms-documents/blended-learning/photos/501/a.png", content_type: "image/png", position: 1 },
  ],
  81: [{ id: 801, s3_key: "lms-documents/blended-learning/photos/601/c.jpg", content_type: "image/jpeg", position: 1 }],
};

function givenTables() {
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes("FROM user_permission")) {
      const email = String(params?.[0]).toLowerCase();
      const row = PERMISSIONS[email];
      return row ? [{ email, level: 1, school_codes: null, regions: null, program_ids: [], ...row }] : [];
    }
    if (sql.includes("FROM blended_learning_mentor_mentee_mappings")) {
      const mentor = MAPPINGS[Number(params?.[0])];
      return mentor ? [{ mentor_user_id: mentor }] : [];
    }
    if (sql.includes("FROM blended_learning_conversation_photos")) {
      const rows = PHOTOS[Number(params?.[0])] ?? [];
      return sql.includes("ORDER BY position") ? [...rows].sort((a, b) => a.position - b.position) : rows;
    }
    if (sql.includes("FROM blended_learning_conversations")) {
      const row = CONVERSATIONS[Number(params?.[0])];
      return row ? [row] : [];
    }
    return [];
  });
}

// The fake presigner signs locally, the way the real one does, and echoes
// the key and expiry it was asked for.
function givenPresigner() {
  mockPresign.mockImplementation(
    async ({ s3Key, ttlSeconds }) => `https://s3.test/${s3Key}?X-Amz-Expires=${ttlSeconds}`
  );
}

function signedInAs(email: string | null) {
  mockSession.mockResolvedValue(email ? { user: { email }, expires: "2099-01-01" } : null);
}

async function getPhotos(conversationId: string) {
  const res = await GET(
    new Request(`http://localhost/api/blended-learning/conversations/${conversationId}/photos`),
    routeParams({ id: conversationId })
  );
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  givenTables();
  givenPresigner();
});

describe("GET /api/blended-learning/conversations/[id]/photos", () => {
  it("returns 401 when signed out", async () => {
    signedInAs(null);
    expect((await getPhotos("71")).status).toBe(401);
  });

  it("returns 403 for a role without Blended Learning access", async () => {
    signedInAs(TEACHER);
    expect((await getPhotos("71")).status).toBe(403);
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("returns 5-minute presigned GETs for the Mentor's own Mentee, in photo order", async () => {
    signedInAs(MENTOR_A);
    expect(await getPhotos("71")).toEqual({
      status: 200,
      body: {
        photos: [
          { id: 701, url: "https://s3.test/lms-documents/blended-learning/photos/501/a.png?X-Amz-Expires=300" },
          { id: 702, url: "https://s3.test/lms-documents/blended-learning/photos/501/b.jpg?X-Amz-Expires=300" },
        ],
      },
    });
  });

  it("returns an empty list for a Conversation without photos", async () => {
    signedInAs(MENTOR_A);
    expect(await getPhotos("72")).toEqual({ status: 200, body: { photos: [] } });
  });

  it("returns 404 for another Mentor's Mentee without signing anything", async () => {
    signedInAs(MENTOR_A);
    expect((await getPhotos("81")).status).toBe(404);
    expect(mockPresign).not.toHaveBeenCalled();
  });

  it("returns 404 for an unmapped Student, a missing Conversation, an Attempt and a malformed id", async () => {
    signedInAs(ADMIN_READ_ONLY);
    expect((await getPhotos("91")).status).toBe(404);
    expect((await getPhotos("99")).status).toBe(404);
    expect((await getPhotos("73")).status).toBe(404);
    expect((await getPhotos("7x")).status).toBe(404);
  });

  it("lets a read-only Blended Learning Admin view any mapped Mentee's photos", async () => {
    signedInAs(ADMIN_READ_ONLY);
    expect(await getPhotos("81")).toEqual({
      status: 200,
      body: { photos: [{ id: 801, url: "https://s3.test/lms-documents/blended-learning/photos/601/c.jpg?X-Amz-Expires=300" }] },
    });
  });

  it("returns 502 without leaking the key when signing fails", async () => {
    signedInAs(MENTOR_A);
    mockPresign.mockRejectedValue(new Error("no credentials"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { status, body } = await getPhotos("71");

    expect(status).toBe(502);
    expect(JSON.stringify(body)).not.toContain("lms-documents");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("lms-documents");
    errorLog.mockRestore();
  });
});
