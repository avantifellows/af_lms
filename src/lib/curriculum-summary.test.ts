import { beforeEach, describe, it, expect, vi } from "vitest";

const { mockQuery, mockCheckSchema, mockCheckPlansSchema, mockLoadSessions } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCheckSchema: vi.fn(),
  mockCheckPlansSchema: vi.fn(),
  mockLoadSessions: vi.fn(),
}));

vi.mock("./db", () => ({ query: mockQuery, withTransaction: vi.fn() }));
vi.mock("./curriculum-schema", () => ({
  checkCurriculumSchema: mockCheckSchema,
  checkCurriculumPlansSchema: mockCheckPlansSchema,
}));
vi.mock("./curriculum-chapter-tests", () => ({ loadChapterTestSessions: mockLoadSessions }));

import {
  getChapterTimeline,
  getCurriculumSummary,
  normalizeCurriculumSummarySearchParams,
  type CurriculumSummaryQuery,
} from "./curriculum-summary";
import { PHYSICAL_CENTRE_PROGRAM_IDS as P, type UserPermission } from "./permissions";

const TODAY = "2026-10-19";

describe("normalizeCurriculumSummarySearchParams", () => {
  it("defaults to Grade 11, today, page 1 and 20 rows", () => {
    expect(normalizeCurriculumSummarySearchParams({}, TODAY)).toEqual({
      regions: [],
      schoolSearch: "",
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: false,
      page: 1,
      pageSize: 20,
    });
  });

  it("keeps a valid Grade 12, as-of date, page and page size", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { grade: "12", as_of: "2026-08-15", page: "3", limit: "50" },
        TODAY
      )
    ).toEqual({
      regions: [],
      schoolSearch: "",
      grade: 12,
      asOf: "2026-08-15",
      onlyBehind: false,
      page: 3,
      pageSize: 50,
    });
  });

  it("falls back for an unknown Grade, an impossible date, a bad page and an unsupported page size", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { grade: "10", as_of: "2026-02-30", page: "-2", limit: "15" },
        TODAY
      )
    ).toEqual({
      regions: [],
      schoolSearch: "",
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: false,
      page: 1,
      pageSize: 20,
    });
  });

  it("ignores removed filters", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { programs: "2", subjects: "4", exam_tracks: "neet", preset: "all", flagged: "true", sort: "school" },
        TODAY
      )
    ).toEqual({
      regions: [],
      schoolSearch: "",
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: false,
      page: 1,
      pageSize: 20,
    });
  });

  it("reads Regions from repeated or comma-separated values, a trimmed School search and Only behind", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        { regions: ["NORTH", "SOUTH, NORTH", " "], q: "  Bhuj ", only_behind: "1" },
        TODAY
      )
    ).toEqual({
      regions: ["NORTH", "SOUTH"],
      schoolSearch: "Bhuj",
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: true,
      page: 1,
      pageSize: 20,
    });
  });

  it("falls back to today for an as-of year too far out to name an academic year", () => {
    for (const asOf of ["0999-06-01", "9999-06-01", "1000-02-01"]) {
      expect(normalizeCurriculumSummarySearchParams({ as_of: asOf }, TODAY).asOf).toBe(TODAY);
    }
    expect(normalizeCurriculumSummarySearchParams({ as_of: "9998-06-01" }, TODAY).asOf).toBe(
      "9998-06-01"
    );
  });
});

const AS_OF = "2026-08-15";

const ADMIN: UserPermission = {
  email: "admin@avantifellows.org",
  level: 3,
  role: "admin",
  program_ids: [1, 2],
};

const SCHEMA_UNAVAILABLE = {
  ok: false,
  status: 503,
  error: "LMS curriculum schema unavailable",
  details: ["lms_curriculum_plans.id"],
};

type RawChapter = Record<string, unknown>;

function chapter(id: number, overrides: RawChapter = {}): RawChapter {
  return {
    chapterId: id,
    code: `C${id}`,
    name: `Chapter ${id}`,
    subject: "Physics",
    sequence: id,
    tracks: ["jee_main", "neet"],
    prescribedMinutes: { jee_main: 90, neet: 60 },
    dueDate: null,
    testDate: null,
    completedOn: null,
    ...overrides,
  };
}

// Shared JEE Main + NEET class on an Active plan, as of 15 Aug:
// Physics: 1 done on time, 2 due 31 Jul and open (test overdue); Chemistry: 3 done late;
// Biology: 4 due 10 Aug and open (test not yet overdue), 5 undated; no Maths content.
const PLAN_CHAPTERS = [
  chapter(1, { dueDate: "2026-06-30", completedOn: "2026-06-28" }),
  chapter(2, { dueDate: "2026-07-31", tracks: ["jee_main"], prescribedMinutes: { jee_main: 120 } }),
  chapter(3, { subject: "Chemistry", dueDate: "2026-07-15", completedOn: "2026-07-20", tracks: ["neet"] }),
  chapter(4, { subject: "Biology", dueDate: "2026-08-10", tracks: ["neet"], prescribedMinutes: { neet: 60 } }),
  chapter(5, { subject: "Biology", tracks: ["neet"], sequence: 9, prescribedMinutes: { neet: 30 } }),
];

function raw(id: number, overrides: Record<string, unknown> = {}) {
  return {
    centre_id: id,
    centre_name: `Centre ${id}`,
    school_code: `SC${id}`,
    school_name: `School ${id}`,
    region: "NORTH",
    program_id: 2,
    program_name: "JNV Nodal",
    centre_count: 1,
    mapped_tracks: ["neet", "jee_main"],
    plan_id: 900,
    plan_title: "G11 Plan",
    plan_status: "active",
    plan_closure_date: "2027-03-08",
    chapters: PLAN_CHAPTERS,
    ...overrides,
  };
}

// JEE Main and JEE Advanced both mapped and both with content.
const SETUP_ERROR = {
  mapped_tracks: ["jee_main", "jee_advanced"],
  chapters: [chapter(1, { tracks: ["jee_main", "jee_advanced"] })],
};

function query(overrides: Partial<CurriculumSummaryQuery> = {}): CurriculumSummaryQuery {
  return {
    regions: [],
    schoolSearch: "",
    grade: 11,
    asOf: AS_OF,
    onlyBehind: false,
    page: 1,
    pageSize: 20,
    ...overrides,
  };
}

function routeQueries(routes: {
  summary?: unknown[];
  grades?: unknown[];
  activity?: unknown[];
}) {
  // Routed by the table each read is about; the summary read also joins centre_exam_tracks.
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("lms_curriculum_plan_assignments")) return routes.summary ?? [];
    if (sql.includes(ACTIVITY_TABLE)) return routes.activity ?? [];
    if (sql.includes("centre_exam_tracks")) return routes.grades ?? [];
    return [];
  });
}

const ACTIVITY_TABLE = "lms_curriculum_logs";

beforeEach(() => {
  mockQuery.mockReset();
  mockCheckSchema.mockReset().mockResolvedValue({ ok: true });
  mockCheckPlansSchema.mockReset().mockResolvedValue({ ok: true });
  mockLoadSessions.mockReset().mockResolvedValue(
    new Map([[1, new Map([[1, ["2026-07-02 11:00:00"]], [4, [null]]])]])
  );
});

describe("getCurriculumSummary", () => {
  it.each([
    ["curriculum", mockCheckSchema],
    ["Curriculum Plan", mockCheckPlansSchema],
  ])("returns the %s schema error without reading rows", async (_name, check) => {
    check.mockResolvedValue(SCHEMA_UNAVAILABLE);

    await expect(getCurriculumSummary(ADMIN, query())).resolves.toEqual(SCHEMA_UNAVAILABLE);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("measures a plan row: pills, PCM / PCB Behind, Tests overdue and the plan", async () => {
    routeQueries({ summary: [raw(1)] });

    const result = await getCurriculumSummary(ADMIN, query());

    if (!result.ok) throw new Error("expected rows");
    expect(result.rows).toEqual([
      {
        centreId: 1,
        centreName: "Centre 1",
        schoolCode: "SC1",
        schoolName: "School 1",
        region: "NORTH",
        programId: 2,
        programName: "JNV Nodal",
        tracksLabel: "JEE Main + NEET",
        kind: "plan",
        explanation: null,
        plan: { id: 900, title: "G11 Plan", closed: false },
        subjects: {
          Physics: { due: 2, done: 1, behind: 1, tone: "amber", label: "1 behind" },
          Chemistry: { due: 1, done: 1, behind: 0, tone: "green", label: "On track" },
          Maths: null,
          Biology: { due: 1, done: 0, behind: 1, tone: "amber", label: "1 behind" },
        },
        // PCM = Physics 1 + Chemistry 0; PCB = Physics 1 + Chemistry 0 + Biology 1.
        subjectGroups: {
          PCM: { behind: 1, tone: "amber", label: "1 behind" },
          PCB: { behind: 2, tone: "amber", label: "2 behind" },
        },
        // Chapter 2 (test date 1 Aug) and Chapter 3 (16 Jul) have no session.
        testsOverdue: 2,
        testsConducted: null,
      },
    ]);
    expect(result.header).toEqual({
      centresOnPlan: 1,
      centresTotal: 1,
      chaptersBehind: { PCM: 1, PCB: 2 },
      testsOverdue: 2,
    });
    expect(mockLoadSessions).toHaveBeenCalledWith({
      centreIds: [1],
      grade: 11,
      academicYear: "2026-2027",
      asOf: AS_OF,
    });
  });

  it("marks a plan Closed after its closure date", async () => {
    routeQueries({ summary: [raw(1, { plan_closure_date: "2026-08-01" })] });

    const result = await getCurriculumSummary(ADMIN, query());

    expect(result.ok && result.rows[0].plan).toEqual({ id: 900, title: "G11 Plan", closed: true });
  });

  it.each([
    ["a Draft plan", { plan_status: "draft" }],
    ["no assignment", { plan_id: null, plan_title: null, plan_status: null, plan_closure_date: null }],
  ])("shows conducted tests instead of metrics for %s", async (_name, overrides) => {
    routeQueries({ summary: [raw(1, overrides)] });

    const result = await getCurriculumSummary(ADMIN, query());

    expect(result.ok && result.rows[0]).toMatchObject({
      kind: "no_plan",
      plan: null,
      subjects: null,
      subjectGroups: null,
      testsOverdue: 0,
      testsConducted: 1,
    });
  });

  it.each([
    [
      "another active physical Centre at the School + Program",
      { centre_count: 2 },
      "configuration_error",
      "Multiple active physical Centres are configured for this School and Program",
    ],
    ["JEE Main + JEE Advanced", SETUP_ERROR, "setup_error", "Fix tracks in Centre Management"],
    [
      "JEE Main + JEE Advanced + NEET",
      {
        mapped_tracks: ["jee_main", "jee_advanced", "neet"],
        chapters: [chapter(1, { tracks: ["jee_main", "jee_advanced", "neet"] })],
      },
      "setup_error",
      "Fix tracks in Centre Management",
    ],
    ["only tracks without content", { mapped_tracks: ["cet"] }, "no_content", "Curriculum configuration is unavailable"],
  ])("explains %s instead of measuring", async (_name, overrides, kind, explanation) => {
    routeQueries({ summary: [raw(1, overrides)] });

    const result = await getCurriculumSummary(ADMIN, query());

    expect(result.ok && result.rows[0]).toMatchObject({
      kind,
      explanation,
      plan: null,
      subjects: null,
      subjectGroups: null,
    });
  });

  it("sorts worst first, counts the header over every row and pages the list", async () => {
    routeQueries({
      summary: [
        raw(1, { centre_name: "Zeta" }),
        raw(2, { centre_name: "Alpha", chapters: [chapter(1, { dueDate: "2026-06-30", completedOn: "2026-06-28" })] }),
        raw(3, { centre_name: "Beta", plan_status: "draft" }),
        raw(4, { centre_name: "Gamma", mapped_tracks: ["cet"] }),
        raw(5, { centre_name: "Delta", centre_count: 2 }),
        raw(6, { centre_name: "Epsilon", ...SETUP_ERROR }),
        raw(7, { centre_name: "Beta", chapters: [chapter(1, { dueDate: "2026-06-30", completedOn: "2026-06-28" })] }),
      ],
    });

    const first = await getCurriculumSummary(ADMIN, query({ pageSize: 10 }));
    if (!first.ok) throw new Error("expected rows");
    expect(first.rows.map((row) => row.centreId)).toEqual([1, 2, 7, 3, 6, 4, 5]);
    // Setup-error and no-content rows don't count towards Centres on plan. Centres 2 and 7 have
    // no Chapter Test session, so their one Chapter's test is overdue too.
    expect(first.header).toEqual({
      centresOnPlan: 3,
      centresTotal: 5,
      chaptersBehind: { PCM: 1, PCB: 2 },
      testsOverdue: 4,
    });
    expect(first.pagination).toEqual({ page: 1, pageSize: 10, totalRows: 7, totalPages: 1 });

    const paged = await getCurriculumSummary(ADMIN, query({ pageSize: 2, page: 9 }));
    if (!paged.ok) throw new Error("expected rows");
    expect(paged.pagination).toEqual({ page: 4, pageSize: 2, totalRows: 7, totalPages: 4 });
    expect(paged.rows.map((row) => row.centreId)).toEqual([5]);
  });

  it("filters by Region and School search without changing the Region options", async () => {
    routeQueries({
      summary: [
        raw(1, { region: "NORTH", school_name: "JNV Bhuj", school_code: "BHJ" }),
        raw(2, { region: "SOUTH", school_name: "JNV Anand", school_code: "ANN" }),
        raw(3, { region: null, school_name: null, school_code: "VPI" }),
      ],
    });

    const byRegion = await getCurriculumSummary(ADMIN, query({ regions: ["SOUTH"] }));
    expect(byRegion.ok && byRegion.rows.map((row) => row.centreId)).toEqual([2]);
    expect(byRegion.ok && byRegion.regionOptions).toEqual(["NORTH", "SOUTH"]);

    const byName = await getCurriculumSummary(ADMIN, query({ schoolSearch: "bhuj" }));
    expect(byName.ok && byName.rows.map((row) => row.centreId)).toEqual([1]);

    // A School without a name falls back to its code, which is searchable.
    const byCode = await getCurriculumSummary(ADMIN, query({ schoolSearch: "vpi" }));
    expect(byCode.ok && byCode.rows.map((row) => [row.centreId, row.schoolName])).toEqual([[3, "VPI"]]);
  });

  it("Only behind narrows the listed rows but not the header", async () => {
    routeQueries({
      summary: [raw(1), raw(2, { chapters: [chapter(1, { dueDate: "2026-06-30", completedOn: "2026-06-28" })] })],
    });

    const result = await getCurriculumSummary(ADMIN, query({ onlyBehind: true }));

    if (!result.ok) throw new Error("expected rows");
    expect(result.rows.map((row) => row.centreId)).toEqual([1]);
    expect(result.header.centresOnPlan).toBe(2);
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, totalRows: 1, totalPages: 1 });
  });

  it("reads chapters sent as a JSON string and tolerates missing fields", async () => {
    routeQueries({
      summary: [
        raw(1, {
          chapters: JSON.stringify([
            { chapterId: 8, name: "Sets", subject: "Mathematics", tracks: ["jee_main"], dueDate: "2026-07-01" },
          ]),
          mapped_tracks: ["jee_main"],
        }),
        raw(2, { chapters: null, mapped_tracks: ["jee_main"] }),
      ],
    });

    const result = await getCurriculumSummary(ADMIN, query());

    if (!result.ok) throw new Error("expected rows");
    const rows = Object.fromEntries(result.rows.map((row) => [row.centreId, row]));
    expect(rows[1].subjects?.Maths).toEqual({ due: 1, done: 0, behind: 1, tone: "amber", label: "1 behind" });
    expect(rows[2].kind).toBe("no_content");
  });

  it.each([
    [
      "a level-3 Admin",
      ADMIN,
      [true, null, null, P, true, [1, 2]],
    ],
    [
      "a level-2 PM by region",
      { email: "pm@x.org", level: 2, role: "program_manager", regions: ["NORTH"], program_ids: [2] },
      [false, null, ["NORTH"], P, false, [2]],
    ],
    [
      "a level-1 user by School code",
      { email: "pm@x.org", level: 1, role: "program_manager", school_codes: ["SC1"], program_ids: [1] },
      [false, ["SC1"], null, P, false, [1]],
    ],
    [
      "a seated user by resolved School scope",
      {
        email: "pm@x.org",
        level: 1,
        role: "program_manager",
        program_ids: [1],
        scope: { schools: new Set(["SC9"]), centres: new Set([9]), programs: new Set([1]) },
      },
      [false, ["SC9"], null, P, false, [1]],
    ],
    [
      "a level-2 user with no regions",
      { email: "pm@x.org", level: 2, role: "program_admin", program_ids: [1] },
      [false, null, [], P, false, [1]],
    ],
  ])("scopes the SQL for %s", async (_name, permission, scope) => {
    routeQueries({ summary: [] });

    await getCurriculumSummary(permission as UserPermission, query({ grade: 12 }));

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([...scope, 12, "2026-2027", "2026-04-01", AS_OF, null]);
  });
});

describe("PCM Behind and PCB Behind", () => {
  const ALL_TRACKS = ["jee_main", "jee_advanced", "neet"];

  // A due, uncompleted Chapter; due 14 Aug its test is not yet overdue on 15 Aug, due 1 Jul it is.
  function open(id: number, subject: string, dueDate = "2026-08-14"): RawChapter {
    return chapter(id, { subject, dueDate, tracks: ALL_TRACKS });
  }

  // Physics 1, Maths 1 ("Mathematics" label), Biology 2, English 1 (in neither group).
  const MIXED = [
    open(1, "Physics"),
    open(2, "Mathematics"),
    open(3, "Biology"),
    open(4, "Biology"),
    open(5, "English"),
    chapter(6, { subject: "Chemistry", dueDate: "2026-07-01", completedOn: "2026-07-01", tracks: ALL_TRACKS }),
  ];

  beforeEach(() => mockLoadSessions.mockResolvedValue(new Map()));

  it.each([
    ["a JEE Main row", { mapped_tracks: ["jee_main"] }, { PCM: 2, PCB: null }],
    ["a JEE Advanced row", { mapped_tracks: ["jee_advanced"] }, { PCM: 2, PCB: null }],
    ["a NEET row", { mapped_tracks: ["neet"] }, { PCM: null, PCB: 3 }],
    ["a shared JEE Main + NEET row", { mapped_tracks: ["jee_main", "neet"] }, { PCM: 2, PCB: 3 }],
    ["a shared JEE Advanced + NEET row", { mapped_tracks: ["neet", "jee_advanced", "cet"] }, { PCM: 2, PCB: 3 }],
    ["a No plan row", { plan_status: "draft" }, null],
    ["a setup-error row", { mapped_tracks: ["jee_main", "jee_advanced"] }, null],
    ["a no-content row", { mapped_tracks: ["cet"] }, null],
    ["a configuration-error row", { centre_count: 2 }, null],
  ])("totals %s by subject group", async (_name, overrides, expected) => {
    routeQueries({ summary: [raw(11, { chapters: MIXED, ...overrides })] });

    const result = await getCurriculumSummary(ADMIN, query());

    if (!result.ok) throw new Error("expected rows");
    const groups = result.rows[0].subjectGroups;
    expect(groups && { PCM: groups.PCM?.behind ?? null, PCB: groups.PCB?.behind ?? null }).toEqual(expected);
  });

  it("uses the Behind pill tones and labels", async () => {
    routeQueries({ summary: [raw(11, { chapters: MIXED, mapped_tracks: ["jee_main", "neet"] })] });

    const result = await getCurriculumSummary(ADMIN, query());

    expect(result.ok && result.rows[0].subjectGroups).toEqual({
      PCM: { behind: 2, tone: "amber", label: "2 behind" },
      PCB: { behind: 3, tone: "red", label: "3 behind" },
    });
  });

  // Shared: PCM 2 (Maths ×2), PCB 2 (Biology ×2): larger 2, 0 tests overdue.
  // NEET: PCB 3: larger 3. JEE Main: PCM 2 with 1 test overdue (Physics due 1 Jul).
  // Done: everything due completed, so neither group is behind.
  const SORT_ROWS = [
    raw(11, {
      centre_name: "Shared",
      mapped_tracks: ["jee_main", "neet"],
      chapters: [open(1, "Maths"), open(2, "Maths"), open(3, "Biology"), open(4, "Biology")],
    }),
    raw(12, {
      centre_name: "Neet",
      mapped_tracks: ["neet"],
      chapters: [open(1, "Biology"), open(2, "Biology"), open(3, "Biology")],
    }),
    raw(13, {
      centre_name: "Main",
      mapped_tracks: ["jee_main"],
      chapters: [open(1, "Physics", "2026-07-01"), open(2, "Maths")],
    }),
    raw(14, {
      centre_name: "Done",
      mapped_tracks: ["jee_main", "neet"],
      chapters: [chapter(1, { dueDate: "2026-08-14", completedOn: "2026-08-14", tracks: ALL_TRACKS })],
    }),
    raw(15, { centre_name: "Draft", plan_status: "draft" }),
  ];

  it("sorts plan rows by the larger group total, then Tests overdue", async () => {
    routeQueries({ summary: SORT_ROWS });

    const result = await getCurriculumSummary(ADMIN, query());

    expect(result.ok && result.rows.map((row) => row.centreName)).toEqual(["Neet", "Main", "Shared", "Done", "Draft"]);
  });

  it("sums each group over every row for the header, whatever Only behind lists", async () => {
    routeQueries({ summary: SORT_ROWS });

    const result = await getCurriculumSummary(ADMIN, query({ onlyBehind: true }));

    if (!result.ok) throw new Error("expected rows");
    // A row behind in either group stays; Done (0 / 0) and the No plan row go.
    expect(result.rows.map((row) => row.centreName)).toEqual(["Neet", "Main", "Shared"]);
    // PCM: Shared 2 + Main 2; PCB: Shared 2 + Neet 3.
    expect(result.header.chaptersBehind).toEqual({ PCM: 4, PCB: 5 });
  });

  it("Only behind keeps a row behind in one group only", async () => {
    routeQueries({
      summary: [
        raw(11, { mapped_tracks: ["jee_main"], chapters: [open(1, "Maths")] }),
        raw(12, { mapped_tracks: ["neet"], chapters: [open(1, "Biology")] }),
        raw(13, { mapped_tracks: ["jee_main", "neet"], chapters: [open(1, "Biology")] }),
        raw(14, { mapped_tracks: ["jee_main", "neet"], chapters: [open(1, "English")] }),
      ],
    });

    const result = await getCurriculumSummary(ADMIN, query({ onlyBehind: true }));

    expect(result.ok && result.rows.map((row) => row.centreId)).toEqual([11, 12, 13]);
  });
});

describe("getChapterTimeline", () => {
  const params = { grade: 11 as const, asOf: AS_OF, hoursWindow: "ay" as const };

  it("returns the schema error before anything else", async () => {
    mockCheckPlansSchema.mockResolvedValue(SCHEMA_UNAVAILABLE);

    await expect(getChapterTimeline(ADMIN, 1, params)).resolves.toEqual(SCHEMA_UNAVAILABLE);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([[0], [-1], [Number.NaN], [1.5]])("is not found for Centre id %s", async (centreId) => {
    await expect(getChapterTimeline(ADMIN, centreId, params)).resolves.toEqual({ ok: false, status: 404 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("is not found for a Centre outside the user's rows", async () => {
    routeQueries({ summary: [] });

    await expect(getChapterTimeline(ADMIN, 1, params)).resolves.toEqual({ ok: false, status: 404 });
    const [, sqlParams] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sqlParams.at(-1)).toBe(1);
  });

  it("lists the class's Chapters by due date with statuses, tests, hours and header totals", async () => {
    routeQueries({
      summary: [raw(1)],
      grades: [{ grade: "11" }],
      activity: [
        { chapter_id: "1", taught_minutes: "100", cancellations: "1", doubt_solving_minutes: "30" },
        { chapter_id: 4, taught_minutes: 20, cancellations: 0, doubt_solving_minutes: 0 },
      ],
    });

    const result = await getChapterTimeline(ADMIN, 1, { ...params, hoursWindow: "7d" });

    if (!result.ok) throw new Error("expected a timeline");
    const { timeline } = result;
    expect(timeline.grades).toEqual([11]);
    expect(timeline.hoursWindow).toBe("7d");
    expect(timeline.chapters.map((c) => [c.chapterId, c.status.kind, c.testStatus.kind])).toEqual([
      [1, "done", "conducted"],
      [3, "done_late", "overdue"],
      [2, "overdue", "overdue"],
      [4, "overdue", "scheduled"],
      [5, "not_in_plan", "not_due"],
    ]);
    // Prescribed follows the Primary Exam Track: JEE Main, else NEET (Biology).
    expect(timeline.chapters.map((c) => [c.chapterId, c.prescribedMinutes])).toEqual([
      [1, 90],
      [3, 60],
      [2, 120],
      [4, 60],
      [5, 30],
    ]);
    expect(timeline.chapters[0]).toMatchObject({ taughtMinutes: 100, cancellations: 1, doubtSolvingMinutes: 30 });
    expect(timeline.chapters[1]).toMatchObject({ taughtMinutes: 0, cancellations: 0, doubtSolvingMinutes: 0 });
    expect(timeline.subjects).toEqual([
      { subject: "Physics", progress: { due: 2, done: 1, behind: 1, tone: "amber", label: "1 behind" } },
      { subject: "Chemistry", progress: { due: 1, done: 1, behind: 0, tone: "green", label: "On track" } },
      { subject: "Biology", progress: { due: 1, done: 0, behind: 1, tone: "amber", label: "1 behind" } },
    ]);
    expect(timeline.header).toEqual({
      due: 4,
      done: 2,
      syllabusDone: 2,
      syllabusTotal: 5,
      testsOverdue: 2,
      taughtMinutes: 120,
      prescribedMinutes: 360,
      cancellations: 1,
      doubtSolvingMinutes: 30,
    });
    // Last 7 days to 15 Aug, for the class's tracks and Chapters.
    const activityCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes(ACTIVITY_TABLE));
    expect(activityCall?.[1]).toEqual(["SC1", 2, 11, ["jee_main", "neet"], "2026-08-09", AS_OF, [1, 2, 3, 4, 5]]);
  });

  it("measures a shared JEE Advanced + NEET class once, with JEE Advanced's prescribed time", async () => {
    routeQueries({
      summary: [
        raw(1, {
          mapped_tracks: ["neet", "jee_advanced"],
          chapters: [
            chapter(1, {
              dueDate: "2026-06-30",
              completedOn: "2026-06-28",
              tracks: ["jee_advanced", "neet"],
              prescribedMinutes: { jee_advanced: 150, neet: 60 },
            }),
            chapter(2, { subject: "Biology", dueDate: "2026-07-31", tracks: ["neet"], prescribedMinutes: { neet: 45 } }),
          ],
        }),
      ],
      grades: [{ grade: 11 }],
    });

    const result = await getChapterTimeline(ADMIN, 1, params);

    if (!result.ok) throw new Error("expected a timeline");
    const { timeline } = result;
    expect(timeline.row).toMatchObject({ kind: "plan", tracksLabel: "JEE Advanced + NEET", explanation: null });
    expect(timeline.row.subjectGroups).toMatchObject({ PCM: { behind: 0 }, PCB: { behind: 1 } });
    // JEE Advanced's 150 min, not NEET's 60; Biology falls back to NEET.
    expect(timeline.chapters.map((c) => [c.chapterId, c.prescribedMinutes])).toEqual([
      [1, 150],
      [2, 45],
    ]);
    // Logs under either track of the class count.
    const activityCall = mockQuery.mock.calls.find(([sql]) => String(sql).includes(ACTIVITY_TABLE));
    expect(activityCall?.[1]?.[3]).toEqual(["jee_advanced", "neet"]);
  });

  it("orders undated Chapters in syllabus order: subject column, sequence, then code", async () => {
    routeQueries({
      summary: [
        raw(1, {
          mapped_tracks: ["neet"],
          chapters: [
            chapter(21, { subject: "Zoology", tracks: ["neet"] }),
            chapter(22, { subject: "Biology", tracks: ["neet"], sequence: 2, code: "B2" }),
            chapter(23, { subject: "Biology", tracks: ["neet"], sequence: 2, code: "B1" }),
            chapter(24, { subject: "Biology", tracks: ["neet"], sequence: 1 }),
            chapter(25, { subject: "Anatomy", tracks: ["neet"] }),
            chapter(26, { subject: "Biology", tracks: ["neet"], dueDate: "2026-09-01" }),
            chapter(27, { subject: "Biology", tracks: ["neet"], dueDate: "2026-07-01" }),
            chapter(28, { subject: "Biology", tracks: ["neet"], sequence: 2, code: "B1" }),
          ],
        }),
      ],
      grades: [{ grade: 11 }, { grade: 12 }],
    });

    const result = await getChapterTimeline(ADMIN, 1, params);

    if (!result.ok) throw new Error("expected a timeline");
    expect(result.timeline.chapters.map((c) => c.chapterId)).toEqual([27, 26, 24, 23, 28, 22, 25, 21]);
    expect(result.timeline.subjects.map((tab) => tab.subject)).toEqual(["Biology", "Anatomy", "Zoology"]);
    expect(result.timeline.grades).toEqual([11, 12]);
  });

  it("shows no plan progress for a No plan class", async () => {
    routeQueries({ summary: [raw(1, { plan_status: "draft" })], grades: [{ grade: 11 }] });

    const result = await getChapterTimeline(ADMIN, 1, params);

    if (!result.ok) throw new Error("expected a timeline");
    expect(result.timeline.row.kind).toBe("no_plan");
    expect(result.timeline.subjects.every((tab) => tab.progress === null)).toBe(true);
    expect(result.timeline.chapters).toHaveLength(5);
  });

  it("lists no Chapters and reads no activity for a class it can't measure", async () => {
    routeQueries({ summary: [raw(1, SETUP_ERROR)], grades: [{ grade: 11 }] });

    const result = await getChapterTimeline(ADMIN, 1, params);

    if (!result.ok) throw new Error("expected a timeline");
    expect(result.timeline.row.explanation).toBe("Fix tracks in Centre Management");
    expect(result.timeline.chapters).toEqual([]);
    expect(result.timeline.subjects).toEqual([]);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes(ACTIVITY_TABLE))).toBe(false);
  });
});
