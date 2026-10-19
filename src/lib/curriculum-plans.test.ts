import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeDb } from "./__test-utils__/fake-db";

const { db, mockCheckSchema } = vi.hoisted(() => ({
  db: { current: null as unknown as ReturnType<typeof import("./__test-utils__/fake-db").createFakeDb> },
  mockCheckSchema: vi.fn(),
}));

vi.mock("./db", () => ({
  query: (sql: string, params?: unknown[]) => db.current.query(sql, params),
  withTransaction: (fn: (client: unknown) => Promise<unknown>) => db.current.withTransaction(fn),
}));
vi.mock("./curriculum-schema", () => ({ checkCurriculumPlansSchema: mockCheckSchema }));

import { updateCurriculumPlanMetadata } from "./curriculum-plans";

const ADMIN_EMAIL = "admin@avantifellows.org";

const LOCKED_PLAN = {
  id: 7,
  title: "G11 2026-27",
  status: "draft",
  academic_year: "2026-2027",
  grade_id: 11,
  exam_tracks: ["jee_main", "jee_advanced"],
  closure_date: "2027-03-08",
};

const PLAN_ROW = {
  id: 7,
  title: "G11 2026-27",
  academic_year: "2026-2027",
  grade_id: 11,
  grade: 11,
  exam_tracks: ["jee_main"],
  status: "draft",
  closure_date: "2026-12-31",
  assignment_count: 0,
};

function metadataBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "G11 2026-27",
    exam_tracks: ["jee_main"],
    academic_year: "2026-2027",
    grade: 11,
    closure_date: "2026-12-31",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockCheckSchema.mockResolvedValue({ ok: true });
  db.current = createFakeDb([
    ["FOR UPDATE", [LOCKED_PLAN]],
    ["SELECT id FROM grade", (params) => [{ id: params[0] }]],
    ["FROM lms_curriculum_plans p", [PLAN_ROW]],
  ]);
});

describe("updateCurriculumPlanMetadata", () => {
  // A JEE Advanced-only Chapter dated 20 Feb is hidden once JEE Advanced is unticked; moving the
  // closure date before it must still be refused, or re-adding the track resurfaces a date
  // after closure that the Admin could not see.
  it("rejects a closure date before a stored date on a hidden Chapter", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      {
        chapter_id: 501,
        chapter_name: "Rotational Dynamics (Advanced)",
        due_date: "2027-02-20",
        test_date: null,
      },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody(),
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Invalid Curriculum Plan",
      errors: [
        {
          field: "closure_date",
          chapterId: 501,
          chapterName: "Rotational Dynamics (Advanced)",
          message: "Chapter Due Date 2027-02-20 is after the Plan Closure Date 2026-12-31",
        },
      ],
    });
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(0);
  });

  it("rejects an academic year change that leaves stored dates outside the new year", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Hidden Chapter", due_date: "2026-06-30", test_date: "2026-07-05" },
      { chapter_id: 502, chapter_name: "Visible Chapter", due_date: null, test_date: null },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ academic_year: "2027-2028", closure_date: "2028-03-01" }),
    });

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({
      status: 400,
      errors: [
        {
          chapterId: 501,
          chapterName: "Hidden Chapter",
          message: "Chapter Due Date 2026-06-30 is outside academic year 2027-2028",
        },
        {
          chapterId: 501,
          chapterName: "Hidden Chapter",
          message: "Chapter Test Date 2026-07-05 is outside academic year 2027-2028",
        },
      ],
    });
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(0);
  });

  it("reads every stored dated row of the plan, not only the effective Chapter list", async () => {
    await updateCurriculumPlanMetadata({ id: 7, adminEmail: ADMIN_EMAIL, body: metadataBody() });

    const [storedDates] = db.current.sqlCalls("FROM lms_curriculum_plan_chapters pc");
    expect(storedDates.sql).not.toContain("lms_chapter_exam_configs");
    expect(storedDates.params).toEqual([7]);
  });

  it("saves when every stored date fits the new academic year and closure date", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Hidden Chapter", due_date: "2026-11-30", test_date: "2026-12-02" },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody(),
    });

    expect(result).toMatchObject({ ok: true, plan: { id: 7, closureDate: "2026-12-31" } });
    const [update] = db.current.sqlCalls("UPDATE lms_curriculum_plans");
    expect(update.params).toEqual([
      7,
      "G11 2026-27",
      "2026-2027",
      11,
      ["jee_main"],
      "2026-12-31",
      ADMIN_EMAIL,
    ]);
  });
});
