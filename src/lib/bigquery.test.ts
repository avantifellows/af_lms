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

describe("getSchoolQuizSessions", () => {
  it("returns rows from BigQuery", async () => {
    const rows = [
      { session_id: "s1", test_name: "Quiz 1", start_date: "2025-01-15", student_count: 30 },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getSchoolQuizSessions } = await import("./bigquery");
    const result = await getSchoolQuizSessions("11223344");

    expect(result).toEqual(rows);
    expect(mocks.mockQueryFn).toHaveBeenCalledWith(
      expect.objectContaining({ params: { udise: "11223344" } })
    );
  });

  it("returns empty array on error", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getSchoolQuizSessions } = await import("./bigquery");
    const result = await getSchoolQuizSessions("11223344");

    expect(result).toEqual([]);
  });
});

describe("getQuizResults", () => {
  it("returns rows from BigQuery", async () => {
    const rows = [
      { quiz_id: "q1", student_full_name: "Amit", student_school_udise_code: "112233", attendance_status: "Present", total_marks_obtained: 80, total_marks: 100, percentage_score: 80 },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getQuizResults } = await import("./bigquery");
    const result = await getQuizResults("q1", "112233");

    expect(result).toEqual(rows);
  });

  it("returns empty array on error", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getQuizResults } = await import("./bigquery");
    const result = await getQuizResults("q1", "112233");

    expect(result).toEqual([]);
  });
});

describe("getQuizSubjectResults", () => {
  it("returns rows from BigQuery", async () => {
    const rows = [
      { quiz_id: "q1", student_full_name: "Amit", subject_name: "Physics", subject_marks_obtained: 30, subject_total_marks: 40 },
    ];
    mocks.mockQueryFn.mockResolvedValueOnce([rows]);

    const { getQuizSubjectResults } = await import("./bigquery");
    const result = await getQuizSubjectResults("q1", "112233");

    expect(result).toEqual(rows);
  });

  it("returns empty array on error", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getQuizSubjectResults } = await import("./bigquery");
    const result = await getQuizSubjectResults("q1", "112233");

    expect(result).toEqual([]);
  });
});
