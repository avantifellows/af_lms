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
  sortSummaryRows,
  type CurriculumSummaryQuery,
  type CurriculumSummaryRow,
  type CurriculumSummarySortKey,
  type CurriculumSummarySubjectProgress,
} from "./curriculum-summary";
import { PHYSICAL_CENTRE_PROGRAM_IDS as P, type UserPermission } from "./permissions";

const TODAY = "2026-10-19";

describe("normalizeCurriculumSummarySearchParams", () => {
  it("defaults to Grade 11, today, page 1 and 20 rows", () => {
    expect(normalizeCurriculumSummarySearchParams({}, TODAY)).toEqual({
      regions: [],
      centreIds: [],
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: false,
      sort: null,
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
      centreIds: [],
      grade: 12,
      asOf: "2026-08-15",
      onlyBehind: false,
      sort: null,
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
      centreIds: [],
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: false,
      sort: null,
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
      centreIds: [],
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: false,
      sort: null,
      page: 1,
      pageSize: 20,
    });
  });

  it("reads Regions and Centre ids from repeated or comma-separated values, and Only behind", () => {
    expect(
      normalizeCurriculumSummarySearchParams(
        {
          regions: ["NORTH", "SOUTH, NORTH", " "],
          // Only positive whole ids count; the removed School search `q` is ignored.
          centres: ["9000812", "12, x, 0, -3, 1.5, 012", "12"],
          q: "Bhuj",
          only_behind: "1",
        },
        TODAY
      )
    ).toEqual({
      regions: ["NORTH", "SOUTH"],
      centreIds: [9000812, 12],
      grade: 11,
      asOf: "2026-10-19",
      onlyBehind: true,
      sort: null,
      page: 1,
      pageSize: 20,
    });
  });

  it.each([
    [{ sort: "pcb", dir: "asc" }, { key: "pcb", dir: "asc" }],
    [{ sort: ["centre", "plan"], dir: ["desc", "asc"] }, { key: "centre", dir: "desc" }],
    // Without a valid direction a column starts in its first-click direction.
    [{ sort: "tests_overdue" }, { key: "tests_overdue", dir: "desc" }],
    [{ sort: "physics", dir: "up" }, { key: "physics", dir: "desc" }],
    [{ sort: "region", dir: "DESC" }, { key: "region", dir: "asc" }],
    // Unknown columns mean the default order, whatever the direction.
    [{ sort: "school", dir: "asc" }, null],
    [{ sort: "Centre", dir: "asc" }, null],
    [{ sort: "toString" }, null],
    [{ sort: "", dir: "desc" }, null],
    [{ dir: "asc" }, null],
  ])("reads the sort from %j", (searchParams, sort) => {
    expect(normalizeCurriculumSummarySearchParams(searchParams, TODAY).sort).toEqual(sort);
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
    centreIds: [],
    grade: 11,
    asOf: AS_OF,
    onlyBehind: false,
    sort: null,
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
        // PCM = Physics + Chemistry (2/3 done); PCB = Physics + Chemistry + Biology (2/4 done).
        subjectGroups: {
          PCM: { due: 3, done: 2, behind: 1, tone: "amber", label: "1 behind" },
          PCB: { due: 4, done: 2, behind: 2, tone: "amber", label: "2 behind" },
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

  it("filters by Region and Centre without changing the Region options", async () => {
    routeQueries({
      summary: [
        raw(1, { centre_name: "Bhuj", region: "NORTH" }),
        raw(2, { centre_name: "anand", region: "SOUTH" }),
        raw(3, { centre_name: "Vapi", region: null }),
        raw(4, { centre_name: "Chhapi", region: "SOUTH", chapters: [chapter(1, { dueDate: "2026-06-30", completedOn: "2026-06-28" })] }),
      ],
    });

    const byRegion = await getCurriculumSummary(ADMIN, query({ regions: ["SOUTH"] }));
    if (!byRegion.ok) throw new Error("expected rows");
    expect(byRegion.rows.map((row) => row.centreId)).toEqual([2, 4]);
    expect(byRegion.regionOptions).toEqual(["NORTH", "SOUTH"]);
    // Centre options are the chosen Regions' Centres, A–Z.
    expect(byRegion.centreOptions).toEqual([
      { id: 2, name: "anand" },
      { id: 4, name: "Chhapi" },
    ]);

    // Without a Region every scoped Centre is an option; the Centres narrow the rows.
    const byCentre = await getCurriculumSummary(ADMIN, query({ centreIds: [3, 1] }));
    if (!byCentre.ok) throw new Error("expected rows");
    // Worst first: Centre 1's Alpha test was held (the default sessions), so Vapi has more overdue.
    expect(byCentre.rows.map((row) => row.centreId)).toEqual([3, 1]);
    expect(byCentre.selectedCentreIds).toEqual([1, 3]);
    expect(byCentre.centreOptions.map((option) => option.name)).toEqual(["anand", "Bhuj", "Chhapi", "Vapi"]);
  });

  it("totals the header over the chosen Centres, like Region, and keeps Only-behind rows as options", async () => {
    routeQueries({
      summary: [
        raw(1),
        raw(2, { chapters: [chapter(1, { dueDate: "2026-06-30", completedOn: "2026-06-28" })] }),
        raw(3),
      ],
    });

    const result = await getCurriculumSummary(ADMIN, query({ centreIds: [1, 2], onlyBehind: true }));

    if (!result.ok) throw new Error("expected rows");
    // Centre 2 is on track, so Only behind lists Centre 1 alone, but it stays a chosen option.
    expect(result.rows.map((row) => row.centreId)).toEqual([1]);
    expect(result.selectedCentreIds).toEqual([1, 2]);
    expect(result.centreOptions.map((option) => option.id)).toEqual([1, 2, 3]);
    // Centre 1: PCM 1, PCB 2, 2 tests overdue; Centre 2: its one Chapter's test overdue.
    expect(result.header).toEqual({
      centresOnPlan: 2,
      centresTotal: 2,
      chaptersBehind: { PCM: 1, PCB: 2 },
      testsOverdue: 3,
    });
  });

  it.each([
    ["an id outside the user's rows", [99]],
    ["an id outside the chosen Region", [2]],
  ])("ignores %s and lists every Centre when none is left", async (_name, centreIds) => {
    routeQueries({ summary: [raw(1, { region: "NORTH" }), raw(2, { region: "SOUTH" }), raw(3, { region: "NORTH" })] });

    const result = await getCurriculumSummary(ADMIN, query({ regions: ["NORTH"], centreIds: [...centreIds] }));

    if (!result.ok) throw new Error("expected rows");
    expect(result.selectedCentreIds).toEqual([]);
    // Centre 1 has one test overdue fewer (its Alpha session), so Centre 3 is worse.
    expect(result.rows.map((row) => row.centreId)).toEqual([3, 1]);
  });

  it("keeps a valid Centre id beside a stale one", async () => {
    routeQueries({ summary: [raw(1), raw(2)] });

    const result = await getCurriculumSummary(ADMIN, query({ centreIds: [99, 2] }));

    expect(result.ok && result.rows.map((row) => row.centreId)).toEqual([2]);
    expect(result.ok && result.selectedCentreIds).toEqual([2]);
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

  it("uses the Behind pill tones and labels with done/due", async () => {
    routeQueries({ summary: [raw(11, { chapters: MIXED, mapped_tracks: ["jee_main", "neet"] })] });

    const result = await getCurriculumSummary(ADMIN, query());

    // PCM: Physics, Mathematics, Chemistry (done) due; PCB: Physics, Biology ×2, Chemistry.
    expect(result.ok && result.rows[0].subjectGroups).toEqual({
      PCM: { due: 3, done: 1, behind: 2, tone: "amber", label: "2 behind" },
      PCB: { due: 4, done: 1, behind: 3, tone: "red", label: "3 behind" },
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

describe("sortSummaryRows", () => {
  function progress(behind: number, due: number): CurriculumSummarySubjectProgress {
    return { due, done: due - behind, behind, tone: behind === 0 ? "green" : "amber", label: "" };
  }

  function summaryRow(id: number, centreName: string, overrides: Partial<CurriculumSummaryRow> = {}): CurriculumSummaryRow {
    return {
      centreId: id,
      centreName,
      schoolCode: `SC${id}`,
      schoolName: `School ${id}`,
      region: "NORTH",
      programId: 2,
      programName: "JNV Nodal",
      tracksLabel: "JEE Main + NEET",
      kind: "plan",
      explanation: null,
      plan: { id: 900, title: "G11 Plan", closed: false },
      subjects: { Physics: null, Chemistry: null, Maths: null, Biology: null },
      subjectGroups: { PCM: null, PCB: null },
      testsOverdue: 0,
      testsConducted: null,
      ...overrides,
    };
  }

  const NO_PLAN = { kind: "no_plan", plan: null, subjects: null, subjectGroups: null, testsConducted: 1 } as const;
  const SETUP_ERROR_ROW = {
    kind: "setup_error",
    explanation: "Fix tracks in Centre Management",
    plan: null,
    subjects: null,
    subjectGroups: null,
  } as const;

  const names = (rows: CurriculumSummaryRow[]) => rows.map((row) => row.centreName);

  // Each pill column gets its progress (or "—") from the same place in the row.
  function withPill(key: CurriculumSummarySortKey, value: CurriculumSummarySubjectProgress | null) {
    const subjects = { Physics: null, Chemistry: null, Maths: null, Biology: null };
    const subjectGroups = { PCM: null, PCB: null };
    const subject = { physics: "Physics", chemistry: "Chemistry", maths: "Maths", biology: "Biology" }[key as string];
    if (subject) return { subjects: { ...subjects, [subject]: value }, subjectGroups };
    return { subjects, subjectGroups: { ...subjectGroups, [key.toUpperCase()]: value } };
  }

  it.each(["physics", "chemistry", "maths", "biology", "pcm", "pcb"] as CurriculumSummarySortKey[])(
    "sorts the %s column by behind, then due, then Centre name, with unmeasured rows last",
    (key) => {
      const rows = [
        summaryRow(1, "Vapi", SETUP_ERROR_ROW),
        summaryRow(2, "Surat", NO_PLAN),
        summaryRow(3, "Dahod", withPill(key, null)),
        summaryRow(4, "Chhapi", withPill(key, progress(0, 4))),
        summaryRow(5, "Bhuj", withPill(key, progress(2, 3))),
        summaryRow(6, "Anand", withPill(key, progress(2, 5))),
        summaryRow(7, "Amreli", withPill(key, progress(2, 5))),
      ];

      // On track counts as 0 behind; Amreli and Anand tie on behind and due, so the Centre name
      // decides. "—", No plan and the setup error stay at the bottom in row-kind order.
      expect(names(sortSummaryRows(rows, { key, dir: "desc" }))).toEqual([
        "Amreli",
        "Anand",
        "Bhuj",
        "Chhapi",
        "Dahod",
        "Surat",
        "Vapi",
      ]);
      expect(names(sortSummaryRows(rows, { key, dir: "asc" }))).toEqual([
        "Chhapi",
        "Bhuj",
        "Amreli",
        "Anand",
        "Dahod",
        "Surat",
        "Vapi",
      ]);
    }
  );

  it("keeps every bottom row in row-kind order, then Centre name, in both directions", () => {
    const rows = [
      summaryRow(1, "Navsari", { ...SETUP_ERROR_ROW, kind: "configuration_error" }),
      summaryRow(2, "Valsad", { ...SETUP_ERROR_ROW, kind: "no_content" }),
      summaryRow(3, "Bhuj", SETUP_ERROR_ROW),
      summaryRow(4, "Surat", NO_PLAN),
      summaryRow(5, "Anand", NO_PLAN),
      summaryRow(6, "Dahod"),
      summaryRow(7, "Chhapi", withPill("pcm", progress(1, 1))),
    ];
    const expected = ["Chhapi", "Dahod", "Anand", "Surat", "Bhuj", "Valsad", "Navsari"];

    expect(names(sortSummaryRows(rows, { key: "pcm", dir: "desc" }))).toEqual(expected);
    expect(names(sortSummaryRows(rows, { key: "pcm", dir: "asc" }))).toEqual(expected);
  });

  it.each([
    ["centre", (name: string) => ({ centreName: name })],
    ["program", (name: string) => ({ programName: name })],
    ["tracks", (name: string) => ({ tracksLabel: name })],
    ["region", (name: string) => ({ region: name })],
    ["plan", (name: string) => ({ plan: { id: 1, title: name, closed: false } })],
  ] as const)("sorts the %s column case-insensitively", (key, value) => {
    const rows = [
      summaryRow(1, "Row 1", value("bravo")),
      summaryRow(2, "Row 2", value("Charlie")),
      summaryRow(3, "Row 3", value("alpha")),
    ];
    const values = (sorted: CurriculumSummaryRow[]) => sorted.map((row) => row.centreId);

    expect(values(sortSummaryRows(rows, { key, dir: "asc" }))).toEqual([3, 1, 2]);
    expect(values(sortSummaryRows(rows, { key, dir: "desc" }))).toEqual([2, 1, 3]);
  });

  it("puts blank Regions and rows without a plan last in both directions", () => {
    const regions = [
      summaryRow(1, "Anand", { region: null }),
      summaryRow(2, "Bhuj", { region: "SOUTH" }),
      summaryRow(3, "Chhapi", { region: "  " }),
      summaryRow(4, "Dahod", { region: "north" }),
    ];
    expect(names(sortSummaryRows(regions, { key: "region", dir: "asc" }))).toEqual(["Dahod", "Bhuj", "Anand", "Chhapi"]);
    expect(names(sortSummaryRows(regions, { key: "region", dir: "desc" }))).toEqual(["Bhuj", "Dahod", "Anand", "Chhapi"]);

    const plans = [
      summaryRow(1, "Surat", NO_PLAN),
      summaryRow(2, "Vapi", SETUP_ERROR_ROW),
      summaryRow(3, "Bhuj", { plan: { id: 2, title: "Old Plan", closed: true } }),
      summaryRow(4, "Anand", { plan: { id: 1, title: "G11 Plan", closed: false } }),
    ];
    expect(names(sortSummaryRows(plans, { key: "plan", dir: "asc" }))).toEqual(["Anand", "Bhuj", "Surat", "Vapi"]);
    expect(names(sortSummaryRows(plans, { key: "plan", dir: "desc" }))).toEqual(["Bhuj", "Anand", "Surat", "Vapi"]);
  });

  it("sorts Tests overdue as numbers, with rows that show none last", () => {
    const rows = [
      summaryRow(1, "Surat", NO_PLAN),
      summaryRow(2, "Anand", { testsOverdue: 9 }),
      summaryRow(3, "Bhuj", { testsOverdue: 10 }),
      summaryRow(4, "Vapi", { ...SETUP_ERROR_ROW, testsOverdue: 0 }),
      summaryRow(5, "Chhapi", { testsOverdue: 0 }),
    ];

    expect(names(sortSummaryRows(rows, { key: "tests_overdue", dir: "desc" }))).toEqual([
      "Bhuj",
      "Anand",
      "Chhapi",
      "Surat",
      "Vapi",
    ]);
    expect(names(sortSummaryRows(rows, { key: "tests_overdue", dir: "asc" }))).toEqual([
      "Chhapi",
      "Anand",
      "Bhuj",
      "Surat",
      "Vapi",
    ]);
  });

  it("keeps the worst-first order without a sort and never mutates its input", () => {
    const rows = [
      summaryRow(1, "Surat", NO_PLAN),
      summaryRow(2, "Anand", withPill("pcm", progress(1, 2))),
      summaryRow(3, "Bhuj", { ...withPill("pcb", progress(3, 4)), testsOverdue: 1 }),
    ];

    expect(names(sortSummaryRows(rows, null))).toEqual(["Bhuj", "Anand", "Surat"]);
    expect(names(rows)).toEqual(["Surat", "Anand", "Bhuj"]);
  });

  it("sorts every listed row before paging and keeps a shared class as one row", async () => {
    routeQueries({
      summary: [
        raw(1, { centre_name: "Delta" }),
        raw(2, { centre_name: "alpha", mapped_tracks: ["neet"] }),
        raw(3, { centre_name: "Charlie", plan_status: "draft" }),
        raw(4, { centre_name: "Bravo", mapped_tracks: ["jee_main"] }),
      ],
    });

    const first = await getCurriculumSummary(ADMIN, query({ sort: { key: "centre", dir: "asc" }, pageSize: 2 }));
    const second = await getCurriculumSummary(
      ADMIN,
      query({ sort: { key: "centre", dir: "asc" }, pageSize: 2, page: 2 })
    );

    expect(first.ok && first.rows.map((row) => row.centreName)).toEqual(["alpha", "Bravo"]);
    expect(second.ok && second.rows.map((row) => [row.centreName, row.tracksLabel])).toEqual([
      ["Charlie", "JEE Main + NEET"],
      ["Delta", "JEE Main + NEET"],
    ]);
    expect(second.ok && second.pagination.totalRows).toBe(4);
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
