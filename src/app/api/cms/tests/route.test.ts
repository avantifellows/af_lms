import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/cms-service", () => ({ requireCmsServiceAccess: vi.fn() }));
vi.mock("@/lib/curriculum-options", () => ({ resolveGradeId: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/cms-test-languages", () => ({ getCmsTestLanguages: vi.fn() }));

import { requireCmsServiceAccess } from "@/lib/cms-service";
import { resolveGradeId } from "@/lib/curriculum-options";
import { query } from "@/lib/db";
import { getCmsTestLanguages } from "@/lib/cms-test-languages";
import { GET } from "./route";

function req(query: string) {
  return new NextRequest(`https://lms.test/api/cms/tests?${query}`);
}

const RAW_TESTS = [
  {
    id: 9535,
    code: "JN-MT-5-26",
    name: [{ lang_code: "en", resource: "AIAT-03 JEE" }],
    subtype: "major_test",
    type_params: { marks: 300, duration: "180" },
  },
  { id: 7, code: "CT-1", name: [], subtype: "chapter_test", type_params: { chapter_id: 22 } },
];

describe("GET /api/cms/tests", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireCmsServiceAccess).mockResolvedValue({
      ok: true,
      cms: { url: "https://cms.test", token: "t" },
    } as never);
    vi.mocked(resolveGradeId).mockResolvedValue(4 as never);
    vi.mocked(getCmsTestLanguages).mockResolvedValue(
      new Map([[9535, [{ code: "hi", name: "Hindi" }]]])
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(RAW_TESTS), { status: 200 }))
    );
  });

  it("returns the requested test type with each test's regional languages", async () => {
    const res = await GET(req("exam_track=jee_main&grade=12&test_type=major_test"));

    await expect(res.json()).resolves.toEqual({
      tests: [
        {
          id: 9535,
          code: "JN-MT-5-26",
          name: "AIAT-03 JEE",
          chapterId: null,
          marks: 300,
          duration: "180",
          languages: [{ code: "hi", name: "Hindi" }],
        },
      ],
    });
    expect(getCmsTestLanguages).toHaveBeenCalledWith([9535]);
  });

  it("matches chapter tests on any sibling chapter id and defaults missing fields", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 22 }, { id: 27 }]);

    const res = await GET(
      req("exam_track=jee_main&grade=12&test_type=chapter_test&chapter_id=27")
    );

    await expect(res.json()).resolves.toEqual({
      tests: [
        {
          id: 7,
          code: "CT-1",
          name: "",
          chapterId: 22,
          marks: null,
          duration: null,
          languages: [],
        },
      ],
    });
  });

  it("400s on an invalid scope", async () => {
    expect((await GET(req("grade=12"))).status).toBe(400);
  });
});
