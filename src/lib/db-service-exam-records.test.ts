import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExamRecord,
  deleteExamRecord,
  updateExamRecord,
  type ExamRecordWrite,
} from "./db-service-exam-records";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const base: ExamRecordWrite = {
  student_id: 7,
  exam_id: 1,
  application_number: "JEE123",
  sessions_applied: null,
};

beforeEach(() => {
  vi.stubEnv("DB_SERVICE_URL", "http://db");
  vi.stubEnv("DB_SERVICE_TOKEN", "token");
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("db-service exam record writes", () => {
  it("accepts a create whose ciphertext came back stored", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ application_password: null, application_password_ciphertext: "QUJD" }, 201),
    );

    await expect(
      createExamRecord({
        ...base,
        application_password: null,
        application_password_ciphertext: "QUJD",
      }),
    ).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://db/student-exam-record",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refuses a DB Service that dropped the ciphertext it was sent", async () => {
    // What a DB Service predating the ciphertext column answers.
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 10, application_password: null }));

    await expect(
      updateExamRecord(10, { ...base, application_password_ciphertext: "QUJD" }),
    ).rejects.toThrow("updateExamRecord did not store the password");
  });

  it("refuses a write that left plaintext behind", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ application_password: "old", application_password_ciphertext: null }),
    );

    await expect(
      updateExamRecord(10, { ...base, application_password_ciphertext: null }),
    ).rejects.toThrow("did not store the password");
  });

  it("refuses an unreadable answer to a password write", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not json", { status: 200 }));

    await expect(
      createExamRecord({ ...base, application_password_ciphertext: "QUJD" }),
    ).rejects.toThrow("did not store the password");
  });

  it("does not inspect the answer to a write that kept the password", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 200 }));

    await expect(updateExamRecord(10, base)).resolves.toBeUndefined();
  });

  it("carries the upstream status on a failed write", async () => {
    mockFetch.mockResolvedValueOnce(new Response("boom", { status: 422 }));

    await expect(deleteExamRecord(10)).rejects.toThrow("deleteExamRecord failed (422)");
  });
});
