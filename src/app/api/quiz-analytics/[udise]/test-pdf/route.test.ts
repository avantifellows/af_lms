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
vi.mock("@/lib/cms-test-pdf", () => ({
  serveCmsTestPdf: vi.fn(),
}));

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getSessionCmsTest } from "@/lib/question-analytics";
import { serveCmsTestPdf } from "@/lib/cms-test-pdf";
import { GET } from "./route";
import { routeParams } from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockLookup = vi.mocked(getSessionCmsTest);
const mockServe = vi.mocked(serveCmsTestPdf);
const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };
const BASE = "http://localhost/api/quiz-analytics/1234/test-pdf";
const URL_ = `${BASE}?grade=12&sessionId=s1&program=EMRS+CoE&type=answers&testId=1`;

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CMS_SERVICE_URL", "https://cms.test");
  vi.stubEnv("CMS_SERVICE_TOKEN", "tok");
  mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
  mockLookup.mockResolvedValue("9330");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/quiz-analytics/[udise]/test-pdf", () => {
  it("gates on Performance access to the School", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    });
    const res = await GET(new Request(URL_), routeParams({ udise: "1234" }));
    expect(res.status).toBe(403);
    expect(mockAuth).toHaveBeenCalledWith("1234", { feature: "performance" });
    expect(mockServe).not.toHaveBeenCalled();
  });

  it("refuses JNV NVS", async () => {
    const res = await GET(
      new Request(`${BASE}?grade=12&sessionId=s1&program=JNV+NVS&type=questions`),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
    expect(mockServe).not.toHaveBeenCalled();
  });

  it("serves the School's own session test, ignoring any testId the caller sends", async () => {
    mockServe.mockResolvedValue(NextResponse.redirect("https://s3.test/x.pdf", 302));
    const res = await GET(new Request(URL_), routeParams({ udise: "1234" }));
    expect(res.status).toBe(302);
    expect(mockLookup).toHaveBeenCalledWith({
      udise: "1234", grade: 12, sessionId: "s1", program: "EMRS CoE", stream: undefined,
    });
    const [req, cms] = mockServe.mock.calls[0];
    expect(new URL(req.url).searchParams.get("testId")).toBe("9330");
    expect(new URL(req.url).searchParams.get("type")).toBe("answers");
    expect(cms).toEqual({ url: "https://cms.test", token: "tok" });
  });

  it("returns 404 when the session has no CMS test", async () => {
    mockLookup.mockResolvedValue(null);
    const res = await GET(new Request(URL_), routeParams({ udise: "1234" }));
    expect(res.status).toBe(404);
    expect(mockServe).not.toHaveBeenCalled();
  });

  it("returns 500 when the CMS is not configured", async () => {
    vi.stubEnv("CMS_SERVICE_TOKEN", "");
    const res = await GET(new Request(URL_), routeParams({ udise: "1234" }));
    expect(res.status).toBe(500);
  });
});
