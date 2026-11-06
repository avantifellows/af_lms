import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ query: queryMock }));

import { getCurriculumChapters } from "./curriculum-options";
import type { UserPermission } from "./permissions";

const adminPermission = {
  email: "admin@example.org",
  level: 3,
  role: "admin",
  school_codes: null,
  regions: null,
  program_ids: [1, 2],
  read_only: false,
} as unknown as UserPermission;

describe("curriculum topics hide archived topics", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("excludes topics archived in the CMS (cms_status_id = 1) from the chapter list", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM school")) return [{ code: "24701", region: null }];
      if (sql.includes("FROM program p")) return [{ id: 1, name: "JNV CoE" }];
      return [];
    });

    const result = await getCurriculumChapters({
      schoolCode: "24701",
      programId: 1,
      examTrack: "neet",
      grade: 11,
      subject: "Biology",
      permission: adminPermission,
    });

    expect(result.ok).toBe(true);
    const chapterSql = queryMock.mock.calls
      .map(([sql]) => sql as string)
      .find((sql) => sql.includes("lms_chapter_exam_configs") && sql.includes("topic_curriculum"));
    expect(chapterSql).toContain("t.cms_status_id IS DISTINCT FROM 1");
  });
});
