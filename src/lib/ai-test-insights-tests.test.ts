import { beforeEach, describe, expect, it, vi } from "vitest";

// The AI Summary card's test picker (#559) reads one Student's tests from the
// warehouse. BigQuery is stubbed by a fake that answers the read as the
// warehouse would, from hand-written `fact_student_test_results_overall`
// sittings: it keeps the rows the read's conditions and parameters select and
// returns them one per sitting, so the reader's own grouping, ordering and
// id handling decide what the picker shows.
const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));
vi.mock("@/lib/bigquery", () => ({
  getBigQueryClient: () => ({ query: mockQuery }),
  FACT_TABLE: "`fact_student_test_results_overall`",
  SUBMITTED_ONLY: "AND has_quiz_ended IS NOT FALSE",
}));

import { readAiTestInsightsTests } from "./ai-test-insights-tests";

interface Sitting {
  enrollment_user_id: number;
  section: string;
  test_id: string | number | null;
  test_name: string;
  test_format: string;
  academic_year: string;
  start_date: string | { value: string };
  has_quiz_ended: boolean | null;
}

const STUDENT = 5001;

/** One overall, submitted sitting of this year by the Student, unless overridden. */
const sitting = (overrides: Partial<Sitting>): Sitting => ({
  enrollment_user_id: STUDENT,
  section: "overall",
  test_id: "T1",
  test_name: "Major Test 1",
  test_format: "major_test",
  academic_year: "2026-2027",
  start_date: "2026-08-10",
  has_quiz_ended: true,
  ...overrides,
});

type Params = { userId: number; formats: string[]; academicYear: string; yearStart: string };

function warehouse(sittings: Sitting[]) {
  mockQuery.mockImplementation(async ({ query, params }: { query: string; params: Params }) => {
    if (!query.includes("`fact_student_test_results_overall`")) throw new Error(`unexpected read: ${query}`);
    const date = (row: Sitting) => (typeof row.start_date === "string" ? row.start_date : row.start_date.value);
    const rows = sittings
      .filter((row) => !query.includes("enrollment_user_id = @userId") || row.enrollment_user_id === params.userId)
      .filter((row) => !query.includes("section = 'overall'") || row.section === "overall")
      .filter((row) => !query.includes("IN UNNEST(@formats)") || params.formats.includes(row.test_format))
      .filter((row) => !query.includes("academic_year = @academicYear") || row.academic_year === params.academicYear)
      .filter((row) => !query.includes("SAFE_CAST(@yearStart AS DATE)") || date(row) >= params.yearStart)
      .filter((row) => !query.includes("has_quiz_ended IS NOT FALSE") || row.has_quiz_ended !== false)
      .map((row) => ({
        picker_test_id: row.test_id,
        picker_test_name: row.test_name,
        picker_test_format: row.test_format,
        picker_test_date: row.start_date,
      }));
    return [rows];
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("readAiTestInsightsTests", () => {
  it("lists the Student's submitted Major, Full Syllabus and Mock tests of this year, newest first", async () => {
    warehouse([
      sitting({ test_id: "T1", test_name: "Major Test 1", test_format: "major_test", start_date: "2026-08-10" }),
      sitting({ test_id: "T2", test_name: "Full Syllabus Test 1", test_format: "full_syllabus_test", start_date: "2026-10-05" }),
      sitting({ test_id: "T3", test_name: "Mock Test 1", test_format: "mock_test", start_date: "2026-09-14" }),
    ]);

    expect(await readAiTestInsightsTests(STUDENT)).toEqual([
      { id: "T2", name: "Full Syllabus Test 1", date: "2026-10-05", format: "full_syllabus_test" },
      { id: "T3", name: "Mock Test 1", date: "2026-09-14", format: "mock_test" },
      { id: "T1", name: "Major Test 1", date: "2026-08-10", format: "major_test" },
    ]);
  });

  it("leaves out Part and Chapter tests", async () => {
    warehouse([
      sitting({ test_id: "T1", test_name: "Major Test 1" }),
      sitting({ test_id: "P1", test_name: "Part Test 3", test_format: "part_test", start_date: "2026-09-20" }),
      sitting({ test_id: "C1", test_name: "Chapter Test: Kinematics", test_format: "chapter_test", start_date: "2026-09-21" }),
    ]);

    expect((await readAiTestInsightsTests(STUDENT)).map((test) => test.id)).toEqual(["T1"]);
  });

  it("leaves out tests of another academic year and tests dated before 1 April of this one", async () => {
    warehouse([
      sitting({ test_id: "T1", start_date: "2026-04-01" }),
      sitting({ test_id: "OLD", academic_year: "2025-2026", start_date: "2026-02-10" }),
      sitting({ test_id: "EARLY", start_date: "2026-03-28" }),
    ]);

    expect((await readAiTestInsightsTests(STUDENT)).map((test) => test.id)).toEqual(["T1"]);
  });

  it("counts a sitting whose quiz end is unknown as submitted, and leaves out one known not submitted", async () => {
    warehouse([
      sitting({ test_id: "DONE", start_date: "2026-08-10", has_quiz_ended: true }),
      sitting({ test_id: "UNKNOWN", start_date: "2026-08-11", has_quiz_ended: null }),
      sitting({ test_id: "ABANDONED", start_date: "2026-08-12", has_quiz_ended: false }),
    ]);

    expect((await readAiTestInsightsTests(STUDENT)).map((test) => test.id)).toEqual(["UNKNOWN", "DONE"]);
  });

  it("reads only the Student's own overall rows", async () => {
    warehouse([
      sitting({ test_id: "MINE" }),
      sitting({ test_id: "THEIRS", enrollment_user_id: 5002, start_date: "2026-09-01" }),
      sitting({ test_id: "PHYSICS", section: "Physics", start_date: "2026-09-02" }),
    ]);

    expect((await readAiTestInsightsTests(STUDENT)).map((test) => test.id)).toEqual(["MINE"]);
  });

  it("gives one row per test with the Student's newest sitting date, ids as strings, and drops tests with no id", async () => {
    warehouse([
      sitting({ test_id: 42, test_name: "Mock Test 2", test_format: "mock_test", start_date: "2026-09-01" }),
      sitting({ test_id: 42, test_name: "Mock Test 2", test_format: "mock_test", start_date: { value: "2026-11-03" } }),
      sitting({ test_id: 42, test_name: "Mock Test 2", test_format: "mock_test", start_date: "2026-10-01" }),
      sitting({ test_id: null, test_name: "Untracked", start_date: "2026-11-20" }),
      sitting({ test_id: "T1", start_date: "2026-10-20" }),
    ]);

    expect(await readAiTestInsightsTests(STUDENT)).toEqual([
      { id: "42", name: "Mock Test 2", date: "2026-11-03", format: "mock_test" },
      { id: "T1", name: "Major Test 1", date: "2026-10-20", format: "major_test" },
    ]);
  });

  it("orders tests sat on the same day by test id, descending", async () => {
    warehouse([
      sitting({ test_id: "A7", start_date: "2026-10-12" }),
      sitting({ test_id: "B2", start_date: "2026-10-12" }),
      sitting({ test_id: "A9", start_date: "2026-10-12" }),
      sitting({ test_id: "Z1", start_date: "2026-10-11" }),
    ]);

    expect((await readAiTestInsightsTests(STUDENT)).map((test) => test.id)).toEqual(["B2", "A9", "A7", "Z1"]);
  });

  it("answers an empty list when the Student has no such test", async () => {
    warehouse([sitting({ test_id: "P1", test_format: "part_test" })]);

    expect(await readAiTestInsightsTests(STUDENT)).toEqual([]);
  });

  it("passes the Student and the year as parameters, never in the SQL", async () => {
    warehouse([]);

    await readAiTestInsightsTests(STUDENT);

    const [{ query, params }] = mockQuery.mock.calls[0];
    expect(params).toMatchObject({ userId: 5001, academicYear: "2026-2027", yearStart: "2026-04-01" });
    expect(query).not.toContain("5001");
    expect(query).not.toContain("2026-2027");
    expect(query).toMatch(/GROUP BY/);
  });

  it("throws when the warehouse read fails", async () => {
    mockQuery.mockRejectedValue(new Error("BigQuery unavailable"));

    await expect(readAiTestInsightsTests(STUDENT)).rejects.toThrow("BigQuery unavailable");
  });
});
