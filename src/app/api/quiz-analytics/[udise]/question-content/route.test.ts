import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  isSessionOnlyForProgram: vi.fn(),
}));
vi.mock("@/lib/question-analytics", () => ({
  getSessionCmsTest: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getSessionCmsTest } from "@/lib/question-analytics";
import { GET } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockLookup = vi.mocked(getSessionCmsTest);
const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };
const BASE = "http://localhost/api/quiz-analytics/1234/question-content";

const TEST = {
  test: { id: 9330 },
  problems: [
    {
      id: 9248,
      subtype: "mcq_single_answer",
      meta_data: {
        text: "<div>Ratio of \\(I_{max}\\) to \\(I_{min}\\)?</div>",
        options: ["1/100", "1/10", "10/1", "3/2"],
        answer: ["4"],
        solutions: [{ type: "text", value: "<div>121/81</div>" }, { type: "text", value: "" }],
      },
    },
    {
      id: 9300,
      subtype: "comprehension",
      paragraph: { body: "<p>Passage.</p>" },
      meta_data: { text: "<p>Question.</p>", options: null, answer: ["2"], solutions: null },
    },
  ],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("CMS_SERVICE_URL", "https://cms.test/");
  vi.stubEnv("CMS_SERVICE_TOKEN", "tok");
  mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
  mockLookup.mockResolvedValue("9330");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const SESSION = "grade=12&sessionId=s1&program=EMRS+CoE";
const call = (query: string) =>
  GET(new Request(`${BASE}?${SESSION}&${query}`), routeParams({ udise: "1234" }));

describe("GET /api/quiz-analytics/[udise]/question-content", () => {
  it("returns the auth response before calling the CMS", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await call("questionId=9248");
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses JNV NVS", async () => {
    const res = await GET(
      new Request(`${BASE}?grade=12&sessionId=s1&program=JNV+NVS&questionId=9248`),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("looks the CMS test up from the School's session, never from the caller", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(TEST), { status: 200 }));
    await call("questionId=9248&cmsTestId=1");
    expect(mockLookup).toHaveBeenCalledWith(
      { udise: "1234", grade: 12, sessionId: "s1", program: "EMRS CoE", stream: undefined },
      9248
    );
    expect(fetchMock.mock.calls[0][0]).toBe("https://cms.test/api/service/test?id=9330");
  });

  it("returns 404 when the question was not in this School's session", async () => {
    mockLookup.mockResolvedValue(null);
    const res = await call("questionId=9248");
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["questionId=abc", "", "questionId=0", "questionId=1;x"])(
    "rejects %s",
    async (query) => {
      const res = await call(query);
      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("returns 500 when the CMS is not configured", async () => {
    vi.stubEnv("CMS_SERVICE_URL", "");
    const res = await call("questionId=9248");
    expect(res.status).toBe(500);
  });

  it("returns only the asked-for question, with the bearer token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(TEST), { status: 200 }));
    const res = await call("questionId=9248");
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://cms.test/api/service/test?id=9330", {
      headers: { Authorization: "Bearer tok" },
      cache: "no-store",
    });
    expect(await res.json()).toEqual({
      id: 9248,
      type: "mcq_single_answer",
      text: "<div>Ratio of \\(I_{max}\\) to \\(I_{min}\\)?</div>",
      options: ["1/100", "1/10", "10/1", "3/2"],
      answer: ["4"],
      solutions: ["<div>121/81</div>"],
    });
  });

  it("puts a comprehension passage before its question", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(TEST), { status: 200 }));
    const body = await (await call("questionId=9300")).json();
    expect(body.text).toBe("<p>Passage.</p><p>Question.</p>");
    expect(body.options).toEqual([]);
    expect(body.solutions).toEqual([]);
  });

  it("returns 404 for a question not in the test", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(TEST), { status: 200 }));
    const res = await call("questionId=1");
    expect(res.status).toBe(404);
  });

  it("returns 502 when the CMS answers with something that is not JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    expect((await call("questionId=9248")).status).toBe(502);
  });

  it("returns 502 when the CMS fails or is unreachable", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    expect((await call("questionId=9248")).status).toBe(502);
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    expect((await call("questionId=9248")).status).toBe(502);
  });
});
