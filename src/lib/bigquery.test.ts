import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mockQueryFn: vi.fn(),
}));

vi.mock("@google-cloud/bigquery", () => ({
  BigQuery: vi.fn(function () {
    return { query: mocks.mockQueryFn };
  }),
}));

import { BigQuery } from "@google-cloud/bigquery";
const MockBigQuery = vi.mocked(BigQuery);

beforeEach(() => {
  vi.resetModules();
  MockBigQuery.mockClear();
  mocks.mockQueryFn.mockReset();

  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
});

describe("getBigQueryClient", () => {
  it("creates client with parsed JSON credentials when GOOGLE_SERVICE_ACCOUNT_JSON is set", async () => {
    const creds = { project_id: "test-project", client_email: "test@test.iam.gserviceaccount.com" };
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify(creds);

    const { getBigQueryClient } = await import("./bigquery");
    getBigQueryClient();

    expect(MockBigQuery).toHaveBeenCalledWith({
      credentials: creds,
      projectId: "test-project",
    });
  });

  it("throws on invalid GOOGLE_SERVICE_ACCOUNT_JSON", async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON = "not-valid-json";

    const { getBigQueryClient } = await import("./bigquery");
    expect(() => getBigQueryClient()).toThrow("Invalid BigQuery credentials configuration");
  });

  it("creates client with keyFilename when GOOGLE_APPLICATION_CREDENTIALS is set", async () => {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = "/path/to/keyfile.json";

    const { getBigQueryClient } = await import("./bigquery");
    getBigQueryClient();

    expect(MockBigQuery).toHaveBeenCalledWith({
      keyFilename: "/path/to/keyfile.json",
    });
  });

  it("creates client with default projectId when no credentials are set", async () => {
    const { getBigQueryClient } = await import("./bigquery");
    getBigQueryClient();

    expect(MockBigQuery).toHaveBeenCalledWith({
      projectId: "avantifellows",
    });
  });

  it("returns same instance on second call (singleton)", async () => {
    const { getBigQueryClient } = await import("./bigquery");
    const client1 = getBigQueryClient();
    const client2 = getBigQueryClient();

    expect(client1).toBe(client2);
    expect(MockBigQuery).toHaveBeenCalledTimes(1);
  });
});

describe("getAvailableGrades", () => {
  it("returns grade numbers from BigQuery", async () => {
    const rows = [{ student_grade: 9 }, { student_grade: 10 }];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getAvailableGrades } = await import("./bigquery");
    const result = await getAvailableGrades("11223344");

    expect(result).toEqual([9, 10]);
    expect(mocks.mockQueryFn).toHaveBeenCalledWith(
      expect.objectContaining({ params: { udise: "11223344" } })
    );
  });

  it("propagates BQ errors to the caller", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getAvailableGrades } = await import("./bigquery");
    await expect(getAvailableGrades("11223344")).rejects.toThrow("BQ error");
  });
});

describe("getBatchOverviewData", () => {
  it("returns tests with subjects derived from non-overall sections, plus enrolled streams", async () => {
    const testRows = [
      {
        session_id: "s1",
        test_name: "Quiz 1",
        start_date: "2025-01-15",
        student_count: 30,
        stream_student_count: 25,
        test_format: "full_test",
        test_stream: "engineering",
        sections: ["overall", "Physics", "Chemistry"],
      },
      {
        session_id: "s2",
        test_name: "Chapter Test",
        start_date: "2025-01-20",
        student_count: 12,
        stream_student_count: 10,
        test_format: "chapter_test",
        test_stream: "engineering",
        sections: ["Maths"],
      },
    ];
    const enrolledRows = [
      { stream: "Engg", total: 35 },
      { stream: "Med", total: 10 },
    ];
    mocks.mockQueryFn
      .mockResolvedValueOnce([testRows])
      .mockResolvedValueOnce([enrolledRows]);

    const { getBatchOverviewData } = await import("./bigquery");
    const result = await getBatchOverviewData("11223344", 10);

    expect(result.tests).toHaveLength(2);
    expect(result.tests[0].subjects).toEqual(["Physics", "Chemistry"]);
    expect(result.tests[1].subjects).toEqual(["Maths"]);
    expect(result.totalEnrolled).toBe(45);
    expect(result.enrolledByStream).toEqual({ Engg: 35, Med: 10 });
    expect(result.streams).toEqual(["engg", "med"]);
  });

  it("forwards stream filter to both queries (lowercased)", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);

    const { getBatchOverviewData } = await import("./bigquery");
    await getBatchOverviewData("11223344", 10, undefined, "pcm");

    const calls = mocks.mockQueryFn.mock.calls;
    expect(calls[0][0].params).toMatchObject({ udise: "11223344", grade: 10, stream: "pcm" });
    expect(calls[1][0].params).toMatchObject({ stream: "pcm" });
    expect(calls[0][0].query).toContain("LOWER(student_stream) = @stream");
  });

  it("propagates BQ errors to the caller", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getBatchOverviewData } = await import("./bigquery");
    await expect(getBatchOverviewData("11223344", 10)).rejects.toThrow("BQ error");
  });

  it("returns null totalEnrolled when no enrollment rows", async () => {
    mocks.mockQueryFn
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    const { getBatchOverviewData } = await import("./bigquery");
    const result = await getBatchOverviewData("11223344", 10);

    expect(result.totalEnrolled).toBeNull();
    expect(result.enrolledByStream).toEqual({});
    expect(result.streams).toEqual([]);
  });
});

describe("getTestQuestionLevelData", () => {
  it("excludes unsubmitted attempts from the class-wide question breakdown", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]);

    const { getTestQuestionLevelData } = await import("./bigquery");
    await getTestQuestionLevelData("11223344", 11, "sess-1");

    // Walkouts skip every question, so counting them nearly doubles the skip
    // count and a hard question becomes indistinguishable from an absent class.
    expect(mocks.mockQueryFn.mock.calls[0][0].query).toContain("has_quiz_ended IS NOT FALSE");
  });
});

describe("getAvailableGrades / getAvailablePrograms", () => {
  it("does not filter the dropdown queries", async () => {
    // 275 grade/program combos have no submitted attempt at all; filtering here
    // would remove them from the picker and make those schools unreachable.
    mocks.mockQueryFn.mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]);

    const { getAvailableGrades, getAvailablePrograms } = await import("./bigquery");
    await getAvailableGrades("11223344");
    await getAvailablePrograms("11223344");

    for (const call of mocks.mockQueryFn.mock.calls) {
      expect(call[0].query).not.toContain("has_quiz_ended");
    }
  });
});

describe("getCumulativeALData", () => {
  it("takes each student's AL from dim_student and builds the per-test progression, sorting by AL rank", async () => {
    // The per-student AL is whatever dim_student says (student_academic_level),
    // NOT the mode of the per-test values — Bilal's tests are M2, M1 but the
    // warehouse levels him M3 (last-three-tests rule upstream), and that wins.
    // Asha (PCM): tests M1, M2, M1 → dim_student M1
    // Bilal (PCM): tests M2, M1 → dim_student M3
    // Chen (PCB): tests B2, B1, B1 → dim_student B1
    const rows = [
      { student_id: "asha", student_name: "Asha", student_stream: "PCM", student_academic_level: "M1", session_id: "s1", test_name: "T1", start_date: "2025-01-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "asha", student_name: "Asha", student_stream: "PCM", student_academic_level: "M1", session_id: "s2", test_name: "T2", start_date: "2025-02-10", test_stream: "pcm", academic_level: "M2" },
      { student_id: "asha", student_name: "Asha", student_stream: "PCM", student_academic_level: "M1", session_id: "s3", test_name: "T3", start_date: "2025-03-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "bilal", student_name: "Bilal", student_stream: "PCM", student_academic_level: "M3", session_id: "s1", test_name: "T1", start_date: "2025-01-10", test_stream: "pcm", academic_level: "M2" },
      { student_id: "bilal", student_name: "Bilal", student_stream: "PCM", student_academic_level: "M3", session_id: "s2", test_name: "T2", start_date: "2025-02-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "chen", student_name: "Chen", student_stream: "PCB", student_academic_level: "B1", session_id: "c1", test_name: "C1", start_date: "2025-01-10", test_stream: "pcb", academic_level: "B2" },
      { student_id: "chen", student_name: "Chen", student_stream: "PCB", student_academic_level: "B1", session_id: "c2", test_name: "C2", start_date: "2025-02-10", test_stream: "pcb", academic_level: "B1" },
      { student_id: "chen", student_name: "Chen", student_stream: "PCB", student_academic_level: "B1", session_id: "c3", test_name: "C3", start_date: "2025-03-10", test_stream: "pcb", academic_level: "B1" },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getCumulativeALData } = await import("./bigquery");
    const result = await getCumulativeALData("11223344", 11);

    expect(result.tests).toHaveLength(6);
    // Tests are returned in chronological order (s* and c* interleave by date)
    expect(result.tests[0]).toMatchObject({ test_name: "T1", start_date: "2025-01-10", stream: "pcm" });
    // PCB-stream tests carry the canonical "pcb" stream key
    const pcbTests = result.tests.filter((t) => t.stream === "pcb");
    expect(pcbTests).toHaveLength(3);
    expect(pcbTests.map((t) => t.test_name)).toEqual(["C1", "C2", "C3"]);

    const byId: Record<string, (typeof result.students)[number]> = {};
    for (const r of result.students) byId[r.student_id] = r;

    expect(byId.asha.total_major_tests).toBe(3);
    expect(byId.asha.academic_level).toBe("M1");
    expect(byId.asha.stream).toBe("PCM");
    expect(byId.asha.progression.map((p) => p.academic_level)).toEqual(["M1", "M2", "M1"]);

    // Warehouse value wins over any app-side mode of the per-test ALs.
    expect(byId.bilal.academic_level).toBe("M3");
    expect(byId.bilal.progression.map((p) => p.academic_level)).toEqual(["M2", "M1"]);

    expect(byId.chen.academic_level).toBe("B1");
    expect(byId.chen.progression.map((p) => p.academic_level)).toEqual(["B2", "B1", "B1"]);

    // Rank ordering: M1/B1 (tier 3) → tie broken by total tests desc → then M3 (tier 1)
    expect(result.students.map((s) => s.student_id)).toEqual(["asha", "chen", "bilal"]);
    expect(result.students[0]).not.toHaveProperty("al_counts");
    expect(result.students[0]).not.toHaveProperty("mode_al");
  });

  it("keeps students the warehouse has not levelled yet, with a null AL, sorted last", async () => {
    // Dev has three M1 tests but no dim_student AL (post-hook not run / new
    // student). We must not invent an AL for him from the per-test values.
    const rows = [
      { student_id: "dev", student_name: "Dev", student_stream: "PCM", student_academic_level: null, session_id: "s1", test_name: "T1", start_date: "2025-01-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "dev", student_name: "Dev", student_stream: "PCM", student_academic_level: null, session_id: "s2", test_name: "T2", start_date: "2025-02-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "esha", student_name: "Esha", student_stream: "PCM", student_academic_level: "Not Eligible for Academic Level", session_id: "s1", test_name: "T1", start_date: "2025-01-10", test_stream: "pcm", academic_level: "Not Eligible for Academic Level" },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getCumulativeALData } = await import("./bigquery");
    const result = await getCumulativeALData("11223344", 11);

    expect(result.students.map((s) => s.student_id)).toEqual(["esha", "dev"]);
    expect(result.students[1].academic_level).toBeNull();
    expect(result.students[1].total_major_tests).toBe(2);
  });

  it("joins dim_student for the per-student AL instead of recomputing it", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]);

    const { getCumulativeALData } = await import("./bigquery");
    await getCumulativeALData("11223344", 11);

    const sql = mocks.mockQueryFn.mock.calls[0][0].query;
    expect(sql).toContain("production_dbt_final.dim_student");
    expect(sql).toContain("ds.academic_level) AS student_academic_level");
    expect(sql).toContain("ds.pk_student_id = f.fk_student_id");
  });

  it("excludes unsubmitted attempts from the AL matrix", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]);

    const { getCumulativeALData } = await import("./bigquery");
    await getCumulativeALData("11223344", 11);

    const sql = mocks.mockQueryFn.mock.calls[0][0].query;
    // NOT FALSE, never = TRUE: null means unknown, and dropping those rows would
    // silently remove attempts that have no test-level row upstream.
    expect(sql).toContain("has_quiz_ended IS NOT FALSE");
    expect(sql).not.toContain("has_quiz_ended = TRUE");
  });

  it("normalizes BigQuery DATE objects ({value: '...'}) on start_date", async () => {
    const rows = [
      {
        student_id: "asha",
        student_name: "Asha",
        student_stream: "PCM",
        session_id: "s1",
        test_name: "T1",
        start_date: { value: "2025-01-10" },
        test_stream: "pcm",
        academic_level: "M1",
      },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getCumulativeALData } = await import("./bigquery");
    const result = await getCumulativeALData("11223344", 11);

    expect(result.tests[0].start_date).toBe("2025-01-10");
  });

  it("uses major-test format list and AL filter in the query", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]);

    const { getCumulativeALData } = await import("./bigquery");
    await getCumulativeALData("11223344", 11, "JNV", "pcm");

    const call = mocks.mockQueryFn.mock.calls[0][0];
    expect(call.query).toContain("major_test");
    expect(call.query).toContain("mock_test");
    expect(call.query).toContain("part_test");
    expect(call.query).toContain("full_syllabus_test");
    expect(call.query).toContain("LOWER(f.section) = 'overall'");
    expect(call.query).toContain("LOWER(student_stream) = @stream");
    expect(call.query).toContain("session_id IS NOT NULL");
    expect(call.params).toMatchObject({ stream: "pcm", program: "JNV", grade: 11 });
  });

  it("propagates BQ errors to the caller", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getCumulativeALData } = await import("./bigquery");
    await expect(getCumulativeALData("11223344", 11)).rejects.toThrow("BQ error");
  });
});

describe("getTestQuestionLevelData", () => {
  it("aggregates per-question and computes attempt_rate + accuracy", async () => {
    const rows = [
      {
        subject: "Physics",
        chapter_name: "Kinematics",
        chapter_id: "chap-kin",
        question_id: "q1",
        position_index: 1,
        total_students: 10,
        attempted: 8,
        correct: 6,
        wrong: 2,
        skipped: 2,
      },
      {
        subject: "Physics",
        chapter_name: "Kinematics",
        chapter_id: "chap-kin",
        question_id: "q2",
        position_index: 2,
        total_students: 10,
        attempted: 5,
        correct: 1,
        wrong: 4,
        skipped: 5,
      },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getTestQuestionLevelData } = await import("./bigquery");
    const result = await getTestQuestionLevelData("11223344", 11, "sess-1");

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      subject: "Physics",
      chapter_name: "Kinematics",
      chapter_id: "chap-kin",
      question_id: "q1",
      position_index: 1,
      total_students: 10,
      attempted: 8,
      correct: 6,
      wrong: 2,
      skipped: 2,
      attempt_rate: 80,
      accuracy: 75,
    });
    expect(result[1].attempt_rate).toBe(50);
    expect(result[1].accuracy).toBe(20);
  });

  it("handles zero attempts without dividing by zero", async () => {
    const rows = [
      {
        subject: "Maths",
        chapter_name: "Calculus",
        question_id: "q1",
        position_index: 1,
        total_students: 5,
        attempted: 0,
        correct: 0,
        wrong: 0,
        skipped: 5,
      },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getTestQuestionLevelData } = await import("./bigquery");
    const result = await getTestQuestionLevelData("11223344", 11, "sess-1");

    expect(result[0]).toMatchObject({ attempt_rate: 0, accuracy: 0 });
  });

  it("passes filters into the query and binds params", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]);

    const { getTestQuestionLevelData } = await import("./bigquery");
    await getTestQuestionLevelData("11223344", 11, "sess-1", "JNV", "pcm");

    const call = mocks.mockQueryFn.mock.calls[0][0];
    expect(call.query).toContain("fact_student_test_results_question_level");
    expect(call.query).toContain("session_id = @sessionId");
    expect(call.query).toContain("student_program = @program");
    expect(call.query).toContain("LOWER(student_stream) = @stream");
    expect(call.params).toMatchObject({
      udise: "11223344",
      grade: 11,
      sessionId: "sess-1",
      program: "JNV",
      stream: "pcm",
    });
  });

  it("propagates BQ errors to the caller", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ down"));

    const { getTestQuestionLevelData } = await import("./bigquery");
    await expect(
      getTestQuestionLevelData("11223344", 11, "sess-1")
    ).rejects.toThrow("BQ down");
  });
});

describe("getStudentQuestionLevelData", () => {
  it("maps is_answered/is_correct to correct/wrong/skipped status", async () => {
    const rows = [
      // answered + correct -> correct
      { enrollment_user_id: 368592, subject: "Physics", chapter_name: "Kinematics", chapter_id: "c-kin", question_id: "q1", position_index: 0, is_answered: 1, is_correct: 1 },
      // answered + incorrect -> wrong
      { enrollment_user_id: 368592, subject: "Physics", chapter_name: "Kinematics", chapter_id: "c-kin", question_id: "q2", position_index: 1, is_answered: 1, is_correct: 0 },
      // not answered -> skipped (is_correct irrelevant)
      { enrollment_user_id: 368592, subject: "Physics", chapter_name: "Optics", chapter_id: "c-opt", question_id: "q3", position_index: 2, is_answered: 0, is_correct: 0 },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getStudentQuestionLevelData } = await import("./bigquery");
    const result = await getStudentQuestionLevelData("11223344", 12, "sess-1");

    expect(result).toHaveLength(3);
    expect(result[0]).toMatchObject({
      enrollment_user_id: "368592", // stringified for client-side matching
      chapter_id: "c-kin",
      question_id: "q1",
      position_index: 0,
      status: "correct",
    });
    expect(result[1].status).toBe("wrong");
    expect(result[2].status).toBe("skipped");
  });

  it("groups by enrollment_user_id and binds filter params", async () => {
    mocks.mockQueryFn.mockResolvedValueOnce([[]]);

    const { getStudentQuestionLevelData } = await import("./bigquery");
    await getStudentQuestionLevelData("11223344", 12, "sess-1", "JNV", "pcm");

    const call = mocks.mockQueryFn.mock.calls[0][0];
    expect(call.query).toContain("fact_student_test_results_question_level");
    expect(call.query).toContain("GROUP BY enrollment_user_id");
    expect(call.query).toContain("enrollment_user_id IS NOT NULL");
    expect(call.query).toContain("student_program = @program");
    expect(call.query).toContain("LOWER(student_stream) = @stream");
    expect(call.params).toMatchObject({
      udise: "11223344",
      grade: 12,
      sessionId: "sess-1",
      program: "JNV",
      stream: "pcm",
    });
  });

  it("propagates BQ errors to the caller", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ down"));

    const { getStudentQuestionLevelData } = await import("./bigquery");
    await expect(
      getStudentQuestionLevelData("11223344", 12, "sess-1")
    ).rejects.toThrow("BQ down");
  });
});

describe("canonicalStream / streamDisplayLabel", () => {
  it("lowercases and trims stream values", async () => {
    const { canonicalStream } = await import("./bigquery");
    expect(canonicalStream("  PCM  ")).toBe("pcm");
    expect(canonicalStream("Engg")).toBe("engg");
    expect(canonicalStream("")).toBeNull();
    expect(canonicalStream(null)).toBeNull();
    expect(canonicalStream(undefined)).toBeNull();
  });

  it("formats display labels for known canonical keys", async () => {
    const { streamDisplayLabel } = await import("./bigquery");
    expect(streamDisplayLabel("pcm")).toBe("PCM");
    expect(streamDisplayLabel("medical")).toBe("Medical");
    expect(streamDisplayLabel("engineering")).toBe("Engineering");
    expect(streamDisplayLabel("foundation")).toBe("Foundation");
    expect(streamDisplayLabel("unknown")).toBe("Unknown");
  });
});
