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

describe("getCumulativeALData", () => {
  it("aggregates AL counts + per-test progression per student, sorts students by mode AL rank", async () => {
    // Asha (PCM): M1 on s1, M2 on s2, M1 on s3 → al_counts {M1:2, M2:1}, mode M1
    // Bilal (PCM): M2 on s1, M1 on s2 → al_counts {M1:1, M2:1}, mode M1 (tie broken by rank — M1 > M2)
    // Chen (PCB): B2 on c1, B1 on c2, B1 on c3 → mode B1
    const rows = [
      { student_id: "asha", student_name: "Asha", student_stream: "PCM", session_id: "s1", test_name: "T1", start_date: "2025-01-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "asha", student_name: "Asha", student_stream: "PCM", session_id: "s2", test_name: "T2", start_date: "2025-02-10", test_stream: "pcm", academic_level: "M2" },
      { student_id: "asha", student_name: "Asha", student_stream: "PCM", session_id: "s3", test_name: "T3", start_date: "2025-03-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "bilal", student_name: "Bilal", student_stream: "PCM", session_id: "s1", test_name: "T1", start_date: "2025-01-10", test_stream: "pcm", academic_level: "M2" },
      { student_id: "bilal", student_name: "Bilal", student_stream: "PCM", session_id: "s2", test_name: "T2", start_date: "2025-02-10", test_stream: "pcm", academic_level: "M1" },
      { student_id: "chen", student_name: "Chen", student_stream: "PCB", session_id: "c1", test_name: "C1", start_date: "2025-01-10", test_stream: "pcb", academic_level: "B2" },
      { student_id: "chen", student_name: "Chen", student_stream: "PCB", session_id: "c2", test_name: "C2", start_date: "2025-02-10", test_stream: "pcb", academic_level: "B1" },
      { student_id: "chen", student_name: "Chen", student_stream: "PCB", session_id: "c3", test_name: "C3", start_date: "2025-03-10", test_stream: "pcb", academic_level: "B1" },
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

    expect(byId.asha.al_counts).toEqual({ M1: 2, M2: 1 });
    expect(byId.asha.total_major_tests).toBe(3);
    expect(byId.asha.mode_al).toBe("M1");
    expect(byId.asha.stream).toBe("PCM");
    expect(byId.asha.progression.map((p) => p.academic_level)).toEqual(["M1", "M2", "M1"]);

    expect(byId.bilal.mode_al).toBe("M1"); // tie broken by rank (M1 > M2)
    expect(byId.bilal.progression.map((p) => p.academic_level)).toEqual(["M2", "M1"]);

    expect(byId.chen.mode_al).toBe("B1");
    expect(byId.chen.progression.map((p) => p.academic_level)).toEqual(["B2", "B1", "B1"]);

    // Mode AL rank ordering: B1, M1 are tier 3 (tie) → tie broken by total tests desc
    // asha (3 tests) and chen (3 tests) before bilal (2 tests)
    expect(result.students[result.students.length - 1].student_id).toBe("bilal");
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
    expect(call.query).toContain("LOWER(section) = 'overall'");
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
