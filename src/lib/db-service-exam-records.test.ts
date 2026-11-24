import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DbServiceExamRecordStatusError,
  createExamRecord,
  createExamRecordWithoutPlaintext,
  deleteExamRecord,
  patchExamRecordWithoutPlaintext,
  updateExamRecord,
  type ExamRecordWrite,
} from "./db-service-exam-records";

const mockFetch = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

// The DB Service answers a write with the whole record, legacy password
// included: the plaintext-free writes must send none and never read the answer.
const ANSWER = JSON.stringify({ id: 77, application_password: "do-not-read" });

function answer(status: number) {
  const response = new Response(ANSWER, { status });
  const json = vi.spyOn(response, "json");
  const text = vi.spyOn(response, "text");
  return { response, json, text };
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

describe("plaintext-free exam record writes", () => {
  it("creates with exactly the named fields, even if the caller passes more, and never reads the answer", async () => {
    const reply = answer(201);
    mockFetch.mockResolvedValue(reply.response);

    const input = { student_id: 501, exam_id: 1, exam_year: 2027, application_number: "2703", notes: "not sent" };
    await createExamRecordWithoutPlaintext(input);
    await createExamRecordWithoutPlaintext({ ...input, sessions_applied: [1, 2] });

    expect(mockFetch).toHaveBeenNthCalledWith(1, "http://db/student-exam-record", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ student_id: 501, exam_id: 1, exam_year: 2027, application_number: "2703" }),
    });
    expect(mockFetch.mock.calls[1][1].body).toBe(
      JSON.stringify({ student_id: 501, exam_id: 1, exam_year: 2027, application_number: "2703", sessions_applied: [1, 2] })
    );
    expect(reply.json).not.toHaveBeenCalled();
    expect(reply.text).not.toHaveBeenCalled();
  });

  it("patches only the number (and the year or sessions when given), so the stored password is left as it is", async () => {
    mockFetch.mockImplementation(async () => answer(200).response);

    await patchExamRecordWithoutPlaintext(77, { application_number: "2703" });
    await patchExamRecordWithoutPlaintext(55, { application_number: "2703", exam_year: 2027 });
    await patchExamRecordWithoutPlaintext(77, { application_number: "2703", sessions_applied: [2] });

    expect(mockFetch.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["http://db/student-exam-record/77", "PATCH", JSON.stringify({ application_number: "2703" })],
      [
        "http://db/student-exam-record/55",
        "PATCH",
        JSON.stringify({ application_number: "2703", exam_year: 2027 }),
      ],
      ["http://db/student-exam-record/77", "PATCH", JSON.stringify({ application_number: "2703", sessions_applied: [2] })],
    ]);
  });

  it("sends a ciphertext under its own key, and the legacy plaintext column only as null to clear it", async () => {
    mockFetch.mockImplementation(async () => answer(200).response);

    await createExamRecordWithoutPlaintext({
      student_id: 501,
      exam_id: 1,
      exam_year: 2027,
      application_number: "2703",
      application_password: null,
      application_password_ciphertext: "Q0lQSEVS",
    });
    await patchExamRecordWithoutPlaintext(77, { application_password: null, application_password_ciphertext: "Q0lQSEVS" });

    expect(mockFetch.mock.calls.map(([, init]) => init.body)).toEqual([
      JSON.stringify({
        student_id: 501,
        exam_id: 1,
        exam_year: 2027,
        application_number: "2703",
        application_password: null,
        application_password_ciphertext: "Q0lQSEVS",
      }),
      JSON.stringify({ application_password: null, application_password_ciphertext: "Q0lQSEVS" }),
    ]);
  });

  it("never sends a plaintext value under the legacy key, even if a caller slips one in", async () => {
    mockFetch.mockImplementation(async () => answer(200).response);
    const sneaky = { application_password: "fake-plain-1" } as unknown as { application_password: null };

    await createExamRecordWithoutPlaintext({ student_id: 501, exam_id: 1, exam_year: 2027, application_number: "2703", ...sneaky });
    await patchExamRecordWithoutPlaintext(77, { application_number: "2703", ...sneaky });

    for (const [, init] of mockFetch.mock.calls) {
      expect(init.body).not.toContain("fake-plain-1");
      expect(JSON.parse(init.body).application_password).toBeNull();
    }
  });

  it("throws only the status on a refusal, without reading the body", async () => {
    const reply = answer(422);
    mockFetch.mockResolvedValue(reply.response);

    const error = await patchExamRecordWithoutPlaintext(77, { application_number: "2703" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbServiceExamRecordStatusError);
    expect(error).toMatchObject({ status: 422, message: "patchExamRecordWithoutPlaintext failed (422)" });
    expect(reply.text).not.toHaveBeenCalled();
    expect(reply.json).not.toHaveBeenCalled();
  });
});
