import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/quiz-session-access", () => ({
  requireQuizSessionRequestAccess: vi.fn(),
  canAccessQuizSessionBatches: vi.fn(),
  resolveBatchGroups: vi.fn(),
}));
vi.mock("@/lib/curriculum-options", () => ({ resolveGradeId: vi.fn() }));

import {
  canAccessQuizSessionBatches,
  requireQuizSessionRequestAccess,
  resolveBatchGroups,
} from "@/lib/quiz-session-access";
import { resolveGradeId } from "@/lib/curriculum-options";

const BODY = {
  cmsTestId: 9535,
  testType: "major_test",
  examTrack: "jee_main",
  grade: 12,
  testName: "AIAT-03",
  parentBatchId: "EnableStudents_12_Engg",
  classBatchIds: ["EnableStudents_12_Engg_A"],
  stream: "engineering",
  startTime: "2026-10-01T06:30:00.000Z",
  endTime: "2026-10-01T10:30:00.000Z",
};

async function loadPost() {
  vi.resetModules();
  process.env.DB_SERVICE_URL = "http://db-service.local";
  process.env.DB_SERVICE_TOKEN = "token";
  process.env.QUIZ_BACKEND_URL = "http://quiz-backend.local";
  process.env.SESSION_PORTAL_URL = "http://auth.local";
  return (await import("./route")).POST;
}

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
}

let fetchMock: ReturnType<typeof vi.fn>;

function bodyOf(urlPart: string) {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => String(input).includes(urlPart) && init?.method === "POST"
  );
  return JSON.parse(String(call?.[1]?.body));
}

function post(POST: (request: NextRequest) => Promise<Response>, extra: Record<string, unknown>) {
  return POST(
    new NextRequest("http://localhost/api/quiz-sessions/from-cms", {
      method: "POST",
      body: JSON.stringify({ ...BODY, ...extra }),
    })
  );
}

describe("POST /api/quiz-sessions/from-cms quiz language", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireQuizSessionRequestAccess).mockResolvedValue({
      ok: true,
      email: "pm@avantifellows.org",
      permission: {},
    } as never);
    vi.mocked(canAccessQuizSessionBatches).mockResolvedValue(true);
    vi.mocked(resolveBatchGroups).mockResolvedValue(
      new Map([["EnableStudents_12_Engg_A", { group: "EnableStudents", authType: "ID" }]]) as never
    );
    vi.mocked(resolveGradeId).mockResolvedValue(4 as never);
    fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/quiz/from-cms")) return json({ id: "quiz-1", warnings: [] });
      if (url.endsWith("/session")) return json({ id: 55 });
      if (url.includes("/batch?")) return json([{ id: 9 }]);
      if (url.includes("/group/?")) return json([{ id: 3 }]);
      return json({ id: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends the language to quiz-backend and stores it on the session", async () => {
    const POST = await loadPost();

    const res = await post(POST, { langCode: "hi" });

    expect(res.status).toBe(200);
    expect(bodyOf("/quiz/from-cms").lang_code).toBe("hi");
    expect(bodyOf("db-service.local/session").meta_data.lang_code).toBe("hi");
  });

  it("sends no language for English", async () => {
    const POST = await loadPost();

    for (const extra of [{}, { langCode: "en" }]) {
      fetchMock.mockClear();
      expect((await post(POST, extra)).status).toBe(200);
      expect(bodyOf("/quiz/from-cms")).not.toHaveProperty("lang_code");
      expect(bodyOf("db-service.local/session").meta_data).not.toHaveProperty("lang_code");
    }
  });

  it("rejects a malformed language before building anything", async () => {
    const POST = await loadPost();

    expect((await post(POST, { langCode: "hindi" })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
