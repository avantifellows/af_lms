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

  it("returns empty array on error", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getAvailableGrades } = await import("./bigquery");
    const result = await getAvailableGrades("11223344");

    expect(result).toEqual([]);
  });
});

describe("getBatchOverviewData", () => {
  it("returns tests, totalEnrolled, and enrolledByStream from BigQuery", async () => {
    const testRows = [
      { session_id: "s1", test_name: "Quiz 1", start_date: "2025-01-15", student_count: 30, stream_student_count: 25, test_format: "full_test", test_stream: "engineering" },
    ];
    const enrolledRows = [
      { stream: "engineering", total: 35 },
      { stream: "medical", total: 10 },
    ];
    mocks.mockQueryFn
      .mockResolvedValueOnce([testRows])
      .mockResolvedValueOnce([enrolledRows]);

    const { getBatchOverviewData } = await import("./bigquery");
    const result = await getBatchOverviewData("11223344", 10);

    expect(result.tests).toEqual(testRows);
    expect(result.totalEnrolled).toBe(45);
    expect(result.enrolledByStream).toEqual({ engineering: 35, medical: 10 });
  });

  it("returns empty on error", async () => {
    mocks.mockQueryFn.mockRejectedValueOnce(new Error("BQ error"));

    const { getBatchOverviewData } = await import("./bigquery");
    const result = await getBatchOverviewData("11223344", 10);

    expect(result).toEqual({ tests: [], totalEnrolled: null, enrolledByStream: {} });
  });

  it("returns null totalEnrolled when no enrollment rows", async () => {
    mocks.mockQueryFn
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);

    const { getBatchOverviewData } = await import("./bigquery");
    const result = await getBatchOverviewData("11223344", 10);

    expect(result.totalEnrolled).toBeNull();
    expect(result.enrolledByStream).toEqual({});
  });
});
