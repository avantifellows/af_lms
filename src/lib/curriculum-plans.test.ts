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

import {
  activateCurriculumPlan,
  copyCurriculumPlan,
  createCurriculumPlan,
  createCurriculumPlanDrafts,
  deleteCurriculumPlan,
  getCurriculumPlan,
  listCurriculumPlans,
  listEffectiveChaptersForGrade,
  normalizeCurriculumPlanListFilters,
  saveCurriculumPlanChapterDates,
  updateCurriculumPlanMetadata,
} from "./curriculum-plans";

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

  // The hidden Chapter isn't in the editor grid, so the Admin can't clear it there; consenting
  // with `clear_conflicting_dates` clears the clashing Chapters' dates and saves.
  it("clears the clashing Chapters' dates and saves when asked to", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      {
        chapter_id: 501,
        chapter_name: "Rotational Dynamics (Advanced)",
        due_date: "2027-02-20",
        test_date: "2027-02-21",
      },
      { chapter_id: 502, chapter_name: "Motion", due_date: "2026-07-01", test_date: null },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ clear_conflicting_dates: true, expected_chapter_ids: [501] }),
    });

    expect(result.ok).toBe(true);
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plan_chapters")).toHaveLength(0);
    const cleared = db.current.sqlCalls("UPDATE lms_curriculum_plan_chapters");
    expect(cleared).toHaveLength(1);
    // 501's due date clashes, so both its dates go; 502 is untouched.
    expect(cleared[0].params).toEqual([7, [501], [501], ADMIN_EMAIL]);
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(1);
  });

  // Only the test date is after the new closure date, so the valid due date stays.
  it("clears only a clashing test date and keeps the Chapter's due date", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Rotational Dynamics", due_date: "2026-12-20", test_date: "2027-01-05" },
      { chapter_id: 502, chapter_name: "Motion", due_date: "2026-07-01", test_date: "2026-07-03" },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ clear_conflicting_dates: true, expected_chapter_ids: [501] }),
    });

    expect(result.ok).toBe(true);
    const cleared = db.current.sqlCalls("UPDATE lms_curriculum_plan_chapters");
    expect(cleared).toHaveLength(1);
    // No due dates clash, so 501 is cleared by its test date only.
    expect(cleared[0].params).toEqual([7, [], [501], ADMIN_EMAIL]);
  });

  // The Admin consented to clear the Chapters a 400 listed. If the closure date was edited
  // since, the clashing set differs: clearing it would wipe dates the Admin never saw.
  it("refuses to clear when the clashing Chapters differ from the ones the Admin saw", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Rotational Dynamics", due_date: "2027-02-20", test_date: null },
      { chapter_id: 503, chapter_name: "Waves", due_date: "2027-01-10", test_date: null },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ clear_conflicting_dates: true, expected_chapter_ids: [501] }),
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "The dates that clash have changed; review them and try again",
    });
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plan_chapters")).toHaveLength(0);
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(0);
  });

  it("refuses to clear when nothing clashes any more but the Admin expected Chapters to", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Rotational Dynamics", due_date: "2026-11-20", test_date: null },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ clear_conflicting_dates: true, expected_chapter_ids: [501] }),
    });

    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plan_chapters")).toHaveLength(0);
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(0);
  });

  it("clears when the clashing set matches regardless of order or repeats", async () => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Rotational Dynamics", due_date: "2027-02-20", test_date: "2027-02-21" },
      { chapter_id: 503, chapter_name: "Waves", due_date: "2026-12-10", test_date: "2027-01-10" },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ clear_conflicting_dates: true, expected_chapter_ids: [503, 501, 501] }),
    });

    expect(result.ok).toBe(true);
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plan_chapters")).toHaveLength(1);
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(1);
  });

  it.each([
    ["missing", undefined],
    ["not an array", "501"],
    ["empty", []],
    ["a string id", ["501"]],
    ["zero", [0]],
    ["negative", [-1]],
    ["a fraction", [501.5]],
  ])("rejects clear_conflicting_dates with %s expected_chapter_ids", async (_label, expected) => {
    db.current.on("FROM lms_curriculum_plan_chapters pc", [
      { chapter_id: 501, chapter_name: "Rotational Dynamics", due_date: "2027-02-20", test_date: null },
    ]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ clear_conflicting_dates: true, expected_chapter_ids: expected }),
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      errors: [{ field: "expected_chapter_ids" }],
    });
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plan_chapters")).toHaveLength(0);
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

  it("reads the plan's stored dated rows by plan id", async () => {
    await updateCurriculumPlanMetadata({ id: 7, adminEmail: ADMIN_EMAIL, body: metadataBody() });

    const [storedDates] = db.current.sqlCalls("FROM lms_curriculum_plan_chapters pc");
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

describe("createCurriculumPlanDrafts", () => {
  const CHAPTERS = [
    {
      chapter_id: 501,
      chapter_code: "11P01",
      chapter_name: "Motion",
      subject_id: 4,
      subject_name: "Physics",
      due_date: null,
      test_date: null,
    },
  ];

  function draft(title: string, dueDate: string) {
    return {
      title,
      examTracks: ["jee_main", "jee_advanced", "neet"] as const,
      academicYear: "2026-2027",
      grade: 11,
      closureDate: "2027-03-08",
      chapters: [{ chapterId: 501, dueDate, testDate: null }],
    };
  }

  beforeEach(() => {
    let nextId = 100;
    db.current.on("INSERT INTO lms_curriculum_plans", () => [{ id: nextId++ }]);
    db.current.on("FROM lms_chapter_exam_configs cfg", CHAPTERS);
  });

  it("creates every Draft with its Chapter dates in one transaction", async () => {
    const result = await createCurriculumPlanDrafts({
      adminEmail: ADMIN_EMAIL,
      drafts: [draft("G12 2026-27", "2026-07-10"), draft("G11 2026-27 (HYD)", "2026-06-09")],
    });

    expect(result).toEqual({
      ok: true,
      plans: [
        { id: 100, title: "G12 2026-27", warnings: [] },
        { id: 101, title: "G11 2026-27 (HYD)", warnings: [] },
      ],
    });
    expect(db.current.transactions).toEqual(["committed"]);
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plan_chapters").map((call) => call.params)).toEqual([
      [100, 501, "2026-07-10", null, ADMIN_EMAIL],
      [101, 501, "2026-06-09", null, ADMIN_EMAIL],
    ]);
  });

  it("rolls every plan back when a later plan's dates are rejected", async () => {
    const result = await createCurriculumPlanDrafts({
      adminEmail: ADMIN_EMAIL,
      drafts: [draft("G12 2026-27", "2026-07-10"), draft("G11 2026-27 (HYD)", "2027-06-09")],
    });

    expect(result).toEqual({
      ok: false,
      error:
        'Could not create "G11 2026-27 (HYD)": Invalid Curriculum Plan; Motion: Chapter Due Date 2027-06-09 is outside academic year 2026-2027',
    });
    expect(db.current.transactions).toEqual(["rolled back"]);
  });

  it("rejects invalid plan details before writing any Chapter dates", async () => {
    const result = await createCurriculumPlanDrafts({
      adminEmail: ADMIN_EMAIL,
      drafts: [{ ...draft("", "2026-07-10") }],
    });

    expect(result).toEqual({
      ok: false,
      error: 'Could not create "": Invalid Curriculum Plan; title: Title is required',
    });
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plans")).toHaveLength(0);
  });

  it("reports the schema as unavailable without opening a transaction", async () => {
    mockCheckSchema.mockResolvedValue({
      ok: false,
      status: 503,
      error: "LMS curriculum schema unavailable",
      details: ["lms_curriculum_plans.id"],
    });

    const result = await createCurriculumPlanDrafts({ adminEmail: ADMIN_EMAIL, drafts: [] });

    expect(result).toEqual({
      ok: false,
      error: "LMS curriculum schema unavailable: lms_curriculum_plans.id",
    });
    expect(db.current.transactions).toEqual([]);
  });
});

const SCHEMA_UNAVAILABLE = {
  ok: false,
  status: 503,
  error: "LMS curriculum schema unavailable",
  details: ["lms_curriculum_plans.id"],
};

const PHYSICS_ROWS = [
  {
    chapter_id: 501,
    chapter_code: "11P01",
    chapter_name: "Motion",
    subject_id: 4,
    subject_name: "Physics",
    due_date: "2026-06-30",
    test_date: null,
  },
  {
    chapter_id: 502,
    chapter_code: null,
    chapter_name: "Friction",
    subject_id: 4,
    subject_name: "Physics",
    due_date: null,
    test_date: null,
  },
];

describe("listCurriculumPlans", () => {
  it("lists the academic year's plans with their derived status", async () => {
    const result = await listCurriculumPlans({ academicYear: "2026-2027", grade: 11 });

    expect(result).toEqual({
      ok: true,
      plans: [
        {
          id: 7,
          title: "G11 2026-27",
          academicYear: "2026-2027",
          grade: 11,
          examTracks: ["jee_main"],
          status: "draft",
          displayStatus: "draft",
          closureDate: "2026-12-31",
          assignmentCount: 0,
        },
      ],
    });
    expect(db.current.calls[0].params).toEqual(["2026-2027", 11]);
  });

  it("returns the schema-unavailable result without reading", async () => {
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);

    await expect(listCurriculumPlans({ academicYear: "2026-2027", grade: null })).resolves.toEqual(
      SCHEMA_UNAVAILABLE
    );
    expect(db.current.calls).toHaveLength(0);
  });
});

describe("normalizeCurriculumPlanListFilters", () => {
  it("keeps a valid academic year and Grade", () => {
    expect(normalizeCurriculumPlanListFilters({ academic_year: " 2025-2026 ", grade: "12" })).toEqual({
      academicYear: "2025-2026",
      grade: 12,
    });
  });

  it("falls back to the current academic year and all Grades", () => {
    const filters = normalizeCurriculumPlanListFilters({ academic_year: "2025", grade: "10" });
    expect(filters.grade).toBeNull();
    expect(filters.academicYear).toMatch(/^\d{4}-\d{4}$/);
  });
});

describe("getCurriculumPlan", () => {
  it("returns the plan with its effective Chapters", async () => {
    db.current.on("FROM lms_chapter_exam_configs cfg", PHYSICS_ROWS);

    const result = await getCurriculumPlan(7);

    expect(result).toMatchObject({
      ok: true,
      plan: {
        id: 7,
        chapters: [
          {
            chapterId: 501,
            chapterCode: "11P01",
            chapterName: "Motion",
            subjectId: 4,
            subjectName: "Physics",
            dueDate: "2026-06-30",
            testDate: null,
          },
          { chapterId: 502, chapterCode: "", dueDate: null },
        ],
      },
    });
    const [chapters] = db.current.sqlCalls("FROM lms_chapter_exam_configs cfg");
    expect(chapters.params).toEqual([7, 11, ["jee_main"]]);
  });

  it.each([[0], [-1], [1.5]])("is not found for id %s without reading", async (id) => {
    await expect(getCurriculumPlan(id)).resolves.toEqual({
      ok: false,
      status: 404,
      error: "Curriculum Plan not found",
    });
    expect(db.current.calls).toHaveLength(0);
  });

  it("is not found for a missing plan", async () => {
    db.current.on("FROM lms_curriculum_plans p", []);
    await expect(getCurriculumPlan(8)).resolves.toMatchObject({ ok: false, status: 404 });
  });

  it("returns the schema-unavailable result", async () => {
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(getCurriculumPlan(7)).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe("listEffectiveChaptersForGrade", () => {
  it("lists the Grade's in-syllabus Chapters for the tracks, with no stored dates", async () => {
    db.current.on("FROM lms_chapter_exam_configs cfg", PHYSICS_ROWS);

    const chapters = await listEffectiveChaptersForGrade(11, ["jee_main", "neet"]);

    expect(chapters.map((chapter) => chapter.chapterId)).toEqual([501, 502]);
    const [query] = db.current.sqlCalls("FROM lms_chapter_exam_configs cfg");
    expect(query.params).toEqual([null, 11, ["jee_main", "neet"]]);
  });

  it("is empty for an unknown Grade", async () => {
    db.current.on("SELECT id FROM grade", []);
    await expect(listEffectiveChaptersForGrade(13, ["jee_main"])).resolves.toEqual([]);
  });
});

describe("createCurriculumPlan", () => {
  it("creates a Draft plan", async () => {
    db.current.on("INSERT INTO lms_curriculum_plans", [{ id: 7 }]);

    const result = await createCurriculumPlan({ adminEmail: ADMIN_EMAIL, body: metadataBody() });

    expect(result).toMatchObject({ ok: true, plan: { id: 7, status: "draft" } });
    const [insert] = db.current.sqlCalls("INSERT INTO lms_curriculum_plans");
    expect(insert.params).toEqual(["G11 2026-27", "2026-2027", 11, ["jee_main"], "2026-12-31", ADMIN_EMAIL]);
  });

  it("names every invalid field and writes nothing", async () => {
    const result = await createCurriculumPlan({
      adminEmail: ADMIN_EMAIL,
      body: { title: "  ", exam_tracks: [], academic_year: "2026", grade: 10, closure_date: "soon" },
    });

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Invalid Curriculum Plan",
      errors: [
        { field: "title", message: "Title is required" },
        { field: "exam_tracks", message: "Choose at least one served Exam Track" },
        { field: "academic_year", message: "Academic year must look like 2026-2027" },
        { field: "grade", message: "Grade must be 11 or 12" },
        { field: "closure_date", message: "Plan Closure Date must be a valid date" },
      ],
    });
    expect(db.current.calls).toHaveLength(0);
  });

  it.each([
    [{ title: "x".repeat(201) }, "title", "Title must be at most 200 characters"],
    [{ exam_tracks: ["jee_main", "cet"] }, "exam_tracks", "Served Exam Tracks must be JEE Main, JEE Advanced or NEET"],
    [{ closure_date: "2027-04-01" }, "closure_date", "Plan Closure Date must fall within academic year 2026-2027"],
  ])("rejects %j", async (overrides, field, message) => {
    const result = await createCurriculumPlan({ adminEmail: ADMIN_EMAIL, body: metadataBody(overrides) });
    expect(result).toMatchObject({ ok: false, status: 400, errors: [{ field, message }] });
  });

  it("treats a missing body as empty", async () => {
    const result = await createCurriculumPlan({ adminEmail: ADMIN_EMAIL, body: null });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a Grade missing from the database", async () => {
    db.current.on("SELECT id FROM grade", []);
    const result = await createCurriculumPlan({ adminEmail: ADMIN_EMAIL, body: metadataBody() });
    expect(result).toMatchObject({ ok: false, errors: [{ field: "grade", message: "Grade was not found" }] });
  });

  it("returns the schema-unavailable result", async () => {
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(createCurriculumPlan({ adminEmail: ADMIN_EMAIL, body: metadataBody() })).resolves.toEqual(
      SCHEMA_UNAVAILABLE
    );
  });
});

describe("updateCurriculumPlanMetadata locks and lookups", () => {
  it("returns 409 when the academic year changes while the plan has a Plan Assignment", async () => {
    db.current.on("SELECT 1 FROM lms_curriculum_plan_assignments", [{ "?column?": 1 }]);

    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ academic_year: "2027-2028", closure_date: "2028-03-01" }),
    });

    expect(result).toEqual({
      ok: false,
      status: 409,
      error: "Academic year and Grade are locked while the plan has Plan Assignments",
    });
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(0);
  });

  it("does not check assignments when the academic year and Grade stay the same", async () => {
    db.current.on("SELECT 1 FROM lms_curriculum_plan_assignments", [{ "?column?": 1 }]);

    const result = await updateCurriculumPlanMetadata({ id: 7, adminEmail: ADMIN_EMAIL, body: metadataBody() });

    expect(result.ok).toBe(true);
    expect(db.current.sqlCalls("SELECT 1 FROM lms_curriculum_plan_assignments")).toHaveLength(0);
  });

  it("allows a Grade change on an unassigned plan", async () => {
    const result = await updateCurriculumPlanMetadata({
      id: 7,
      adminEmail: ADMIN_EMAIL,
      body: metadataBody({ grade: 12 }),
    });

    expect(result.ok).toBe(true);
    expect(db.current.sqlCalls("SELECT 1 FROM lms_curriculum_plan_assignments")).toHaveLength(1);
  });

  it.each([
    ["a missing plan", "FOR UPDATE"],
    ["a missing Grade", "SELECT id FROM grade"],
  ])("rejects %s", async (_case, sql) => {
    db.current.on(sql, []);
    const result = await updateCurriculumPlanMetadata({ id: 7, adminEmail: ADMIN_EMAIL, body: metadataBody() });
    expect(result.ok).toBe(false);
    expect(db.current.sqlCalls("UPDATE lms_curriculum_plans")).toHaveLength(0);
  });

  it("rejects invalid details and ids before opening a transaction", async () => {
    await expect(
      updateCurriculumPlanMetadata({ id: 0, adminEmail: ADMIN_EMAIL, body: metadataBody() })
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      updateCurriculumPlanMetadata({ id: 7, adminEmail: ADMIN_EMAIL, body: metadataBody({ grade: 9 }) })
    ).resolves.toMatchObject({ status: 400 });
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(
      updateCurriculumPlanMetadata({ id: 7, adminEmail: ADMIN_EMAIL, body: metadataBody() })
    ).resolves.toEqual(SCHEMA_UNAVAILABLE);
    expect(db.current.transactions).toEqual([]);
  });
});

describe("activateCurriculumPlan", () => {
  it("activates a Draft and warns about undated Chapters", async () => {
    db.current.on("FROM lms_chapter_exam_configs cfg", PHYSICS_ROWS);

    const result = await activateCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL });

    expect(result).toMatchObject({
      ok: true,
      plan: { id: 7 },
      warnings: [{ chapterId: 502, chapterName: "Friction", message: "Chapter has no Chapter Due Date" }],
    });
    const [update] = db.current.sqlCalls("SET status = 'active'");
    expect(update.params).toEqual([7, ADMIN_EMAIL]);
  });

  it("refuses a plan that is not a Draft", async () => {
    db.current.on("FOR UPDATE", [{ ...LOCKED_PLAN, status: "active" }]);

    await expect(activateCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Only Draft plans can be activated",
    });
    expect(db.current.sqlCalls("SET status = 'active'")).toHaveLength(0);
  });

  it("is not found for a missing plan or a bad id", async () => {
    db.current.on("FOR UPDATE", []);
    await expect(activateCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL })).resolves.toMatchObject({ status: 404 });
    await expect(activateCurriculumPlan({ id: -7, adminEmail: ADMIN_EMAIL })).resolves.toMatchObject({ status: 404 });
  });

  it("returns the schema-unavailable result", async () => {
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(activateCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL })).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe("deleteCurriculumPlan", () => {
  it("deletes a Draft", async () => {
    await expect(deleteCurriculumPlan({ id: 7 })).resolves.toEqual({ ok: true });
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plans")[0].params).toEqual([7]);
  });

  it("refuses an Active plan", async () => {
    db.current.on("FOR UPDATE", [{ ...LOCKED_PLAN, status: "active" }]);

    await expect(deleteCurriculumPlan({ id: 7 })).resolves.toEqual({
      ok: false,
      status: 409,
      error: "Only Draft plans can be deleted",
    });
    expect(db.current.sqlCalls("DELETE FROM lms_curriculum_plans")).toHaveLength(0);
  });
});

describe("copyCurriculumPlan", () => {
  beforeEach(() => {
    db.current.on("INSERT INTO lms_curriculum_plans", [{ id: 9 }]);
    db.current.on("AND due_date IS NOT NULL", [
      { chapter_id: 501, due_date: "2026-06-30", test_date: "2027-02-28" },
      { chapter_id: 503, due_date: "2027-02-28", test_date: null },
    ]);
  });

  it("copies a plan into a same-year Draft with its stored dates", async () => {
    const result = await copyCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { mode: "same_year" } });

    expect(result).toMatchObject({ ok: true, plan: { id: 7 } });
    const [insertPlan] = db.current.sqlCalls("INSERT INTO lms_curriculum_plans");
    expect(insertPlan.params).toEqual([
      "Copy of G11 2026-27",
      "2026-2027",
      11,
      ["jee_main", "jee_advanced"],
      "2027-03-08",
      ADMIN_EMAIL,
    ]);
    const [insertChapters] = db.current.sqlCalls("INSERT INTO lms_curriculum_plan_chapters");
    expect(insertChapters.params).toEqual([
      9,
      [501, 503],
      ["2026-06-30", "2027-02-28"],
      ["2027-02-28", null],
      ADMIN_EMAIL,
    ]);
  });

  it("moves every date forward a year for next year's copy", async () => {
    db.current.on("FOR UPDATE", [{ ...LOCKED_PLAN, academic_year: "2027-2028", closure_date: "2028-02-29" }]);
    db.current.on("AND due_date IS NOT NULL", [{ chapter_id: 501, due_date: "2028-02-29", test_date: "2028-03-01" }]);

    await copyCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { mode: "next_year" } });

    const [insertPlan] = db.current.sqlCalls("INSERT INTO lms_curriculum_plans");
    expect(insertPlan.params.slice(1, 5)).toEqual(["2028-2029", 11, ["jee_main", "jee_advanced"], "2029-02-28"]);
    const [insertChapters] = db.current.sqlCalls("INSERT INTO lms_curriculum_plan_chapters");
    expect(insertChapters.params.slice(1, 4)).toEqual([[501], ["2029-02-28"], ["2029-03-01"]]);
  });

  it("writes no Chapter rows for a plan without stored dates", async () => {
    db.current.on("AND due_date IS NOT NULL", []);
    await copyCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { mode: "same_year" } });
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plan_chapters")).toHaveLength(0);
  });

  it("rejects an unknown mode, a missing plan and a bad id", async () => {
    await expect(
      copyCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { mode: "last_year" } })
    ).resolves.toMatchObject({ status: 400 });
    await expect(copyCurriculumPlan({ id: 0, adminEmail: ADMIN_EMAIL, body: null })).resolves.toMatchObject({
      status: 404,
    });
    db.current.on("FOR UPDATE", []);
    await expect(
      copyCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { mode: "same_year" } })
    ).resolves.toMatchObject({ status: 404 });
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(
      copyCurriculumPlan({ id: 7, adminEmail: ADMIN_EMAIL, body: { mode: "same_year" } })
    ).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});

describe("saveCurriculumPlanChapterDates", () => {
  beforeEach(() => {
    db.current.on("FROM lms_chapter_exam_configs cfg", PHYSICS_ROWS);
  });

  function save(chapters: unknown) {
    return saveCurriculumPlanChapterDates({ id: 7, adminEmail: ADMIN_EMAIL, body: { chapters } });
  }

  it("saves the dates, warns about a test before its due date, and returns the reloaded plan", async () => {
    const result = await save([
      { chapter_id: 501, due_date: "2026-07-10", test_date: "2026-07-05" },
      { chapter_id: 502, due_date: "", test_date: null },
    ]);

    expect(result).toMatchObject({
      ok: true,
      plan: { id: 7, chapters: [{ chapterId: 501 }, { chapterId: 502 }] },
      warnings: [
        { chapterId: 501, chapterName: "Motion", message: "Chapter Test Date is before its Chapter Due Date" },
      ],
    });
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plan_chapters").map((call) => call.params)).toEqual([
      [7, 501, "2026-07-10", "2026-07-05", ADMIN_EMAIL],
      [7, 502, null, null, ADMIN_EMAIL],
    ]);
    expect(db.current.sqlCalls("SET updated_by_email = $2")[0].params).toEqual([7, ADMIN_EMAIL]);
  });

  it("rejects the whole batch, naming each invalid Chapter, and writes nothing", async () => {
    const result = await save([
      { chapter_id: 501, due_date: "2027-04-02", test_date: "2027-03-09" },
      { chapter_id: 502, due_date: null, test_date: "2026-07-01" },
      { chapter_id: 999, due_date: "2026-07-01" },
    ]);

    expect(result).toEqual({
      ok: false,
      status: 400,
      error: "Invalid Curriculum Plan",
      errors: [
        {
          field: "chapters",
          chapterId: 501,
          chapterName: "Motion",
          message: "Chapter Due Date 2027-04-02 is outside academic year 2026-2027",
        },
        {
          field: "chapters",
          chapterId: 501,
          chapterName: "Motion",
          message: "Chapter Test Date 2027-03-09 is after the Plan Closure Date 2027-03-08",
        },
        {
          field: "chapters",
          chapterId: 502,
          chapterName: "Friction",
          message: "Chapter Test Date needs a Chapter Due Date",
        },
        {
          field: "chapters",
          chapterId: 999,
          message: "Chapter 999 is not an in-syllabus Chapter of this plan",
        },
      ],
    });
    expect(db.current.sqlCalls("INSERT INTO lms_curriculum_plan_chapters")).toHaveLength(0);
  });

  it.each([
    [[], [{ field: "chapters", message: "No Chapter dates to save" }]],
    [
      [{ chapter_id: "x" }, { chapter_id: 501 }, { chapter_id: 501 }, null],
      [
        { field: "chapters", message: "Each Chapter must appear once with a valid id" },
        { field: "chapters", message: "Each Chapter must appear once with a valid id" },
        { field: "chapters", message: "Each Chapter must appear once with a valid id" },
      ],
    ],
    [
      [{ chapter_id: 501, due_date: "2026-02-30" }, { chapter_id: 502, test_date: 20260701 }],
      [
        { field: "chapters", chapterId: 501, message: "Dates must be valid YYYY-MM-DD dates" },
        { field: "chapters", chapterId: 502, message: "Dates must be valid YYYY-MM-DD dates" },
      ],
    ],
  ])("rejects malformed input %j before opening a transaction", async (chapters, errors) => {
    await expect(save(chapters)).resolves.toMatchObject({ ok: false, status: 400, errors });
    expect(db.current.transactions).toEqual([]);
  });

  it("is not found for a missing plan or a bad id", async () => {
    await expect(
      saveCurriculumPlanChapterDates({ id: 0, adminEmail: ADMIN_EMAIL, body: { chapters: [] } })
    ).resolves.toMatchObject({ status: 404 });
    db.current.on("FOR UPDATE", []);
    await expect(save([{ chapter_id: 501, due_date: "2026-07-10" }])).resolves.toMatchObject({ status: 404 });
  });

  it("returns the schema-unavailable result", async () => {
    mockCheckSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);
    await expect(save([{ chapter_id: 501 }])).resolves.toEqual(SCHEMA_UNAVAILABLE);
  });
});
