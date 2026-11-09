import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
vi.mock("./db", () => ({ query: queryMock }));
vi.mock("./curriculum-logs", () => ({
  validateSelectedScope: vi.fn(async () => ({
    ok: true,
    gradeId: 3,
    grade: 11,
    subjectId: 3,
    examTrack: "neet",
    curriculumId: 2,
  })),
}));

import { getCurriculumProgress } from "./curriculum-progress";
import type { UserPermission } from "./permissions";

const permission = { email: "t@example.org", role: "teacher" } as unknown as UserPermission;

describe("curriculum progress leaves out topics archived in the CMS", () => {
  beforeEach(() => {
    queryMock.mockReset();
    queryMock.mockResolvedValue([]);
  });

  it("excludes archived topics from the chapter topic list and the subject total", async () => {
    const result = await getCurriculumProgress({
      schoolCode: "24701",
      programId: 1,
      examTrack: "neet",
      grade: 11,
      subject: "Biology",
      permission,
    });
    expect(result.ok).toBe(true);

    const sqls = queryMock.mock.calls.map(([sql]) => sql as string);
    const totalSql = sqls.find((sql) => sql.includes("subject_total_time_minutes"));
    const chapterSql = sqls.find((sql) => sql.includes("scoped_log_topics"));

    // Subject total: each regular log counts for its share of non-archived topics.
    expect(totalSql).toContain("tp.cms_status_id IS DISTINCT FROM 1");
    expect(totalSql).toContain("COALESCE(tf.live_share, 1)");
    // Chapter topics: the filter sits inside the topic join, so a chapter whose
    // topics are all archived still comes back as a row.
    expect(chapterSql).toMatch(
      /JOIN topic_curriculum topic_scope[\s\S]*?t\.cms_status_id IS DISTINCT FROM 1\s*\)\s*ON t\.chapter_id = ch\.id/
    );
  });
});
