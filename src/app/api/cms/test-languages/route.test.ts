import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/quiz-session-access", () => ({ requireQuizSessionRequestAccess: vi.fn() }));
vi.mock("@/lib/cms-test-languages", () => ({ getCmsTestLanguages: vi.fn() }));

import { requireQuizSessionRequestAccess } from "@/lib/quiz-session-access";
import { getCmsTestLanguages } from "@/lib/cms-test-languages";
import { GET } from "./route";

const mockAccess = vi.mocked(requireQuizSessionRequestAccess);
const mockLanguages = vi.mocked(getCmsTestLanguages);

function req(query: string) {
  return new NextRequest(`https://lms.test/api/cms/test-languages?${query}`);
}

describe("GET /api/cms/test-languages", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAccess.mockResolvedValue({ ok: true } as never);
  });

  it("returns the access response when not allowed", async () => {
    mockAccess.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) } as never);
    expect((await GET(req("testId=7"))).status).toBe(403);
  });

  it("400s on a non-numeric testId", async () => {
    expect((await GET(req("testId=https%3A%2F%2Fnew-cms"))).status).toBe(400);
    expect(mockLanguages).not.toHaveBeenCalled();
  });

  it("returns the test's regional languages", async () => {
    mockLanguages.mockResolvedValue(new Map([[7, [{ code: "hi", name: "Hindi" }]]]));

    const res = await GET(req("testId=7"));

    await expect(res.json()).resolves.toEqual({ languages: [{ code: "hi", name: "Hindi" }] });
    expect(mockLanguages).toHaveBeenCalledWith([7]);
  });
});
