import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DbServiceExamRecordStatusError,
  createExamRecordWithoutPassword,
  patchExamRecordWithoutPassword,
} from "./db-service-exam-records";

// The DB Service answers a write with the whole record, password included:
// the password-free writes must send none and never read the answer.
const ANSWER = JSON.stringify({ id: 77, application_password: "do-not-read" });

function answer(status: number) {
  const response = new Response(ANSWER, { status });
  const json = vi.spyOn(response, "json");
  const text = vi.spyOn(response, "text");
  return { response, json, text };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("DB_SERVICE_URL", "http://db-service.test/api");
  vi.stubEnv("DB_SERVICE_TOKEN", "test-token");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("password-free exam record writes", () => {
  it("creates with exactly the four named fields, even if the caller passes more, and never reads the answer", async () => {
    const reply = answer(201);
    fetchMock.mockResolvedValue(reply.response);

    const input = { student_id: 501, exam_id: 1, exam_year: 2027, application_number: "2703", application_password: "x" };
    await createExamRecordWithoutPassword(input);

    expect(fetchMock).toHaveBeenCalledWith("http://db-service.test/api/student-exam-record", {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ student_id: 501, exam_id: 1, exam_year: 2027, application_number: "2703" }),
    });
    expect(reply.json).not.toHaveBeenCalled();
    expect(reply.text).not.toHaveBeenCalled();
  });

  it("patches only the number (and the year when given), so the stored password is left as it is", async () => {
    fetchMock.mockImplementation(async () => answer(200).response);

    await patchExamRecordWithoutPassword(77, { application_number: "2703" });
    await patchExamRecordWithoutPassword(55, { application_number: "2703", exam_year: 2027 });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ["http://db-service.test/api/student-exam-record/77", "PATCH", JSON.stringify({ application_number: "2703" })],
      [
        "http://db-service.test/api/student-exam-record/55",
        "PATCH",
        JSON.stringify({ application_number: "2703", exam_year: 2027 }),
      ],
    ]);
  });

  it("throws only the status on a refusal, without reading the body", async () => {
    const reply = answer(422);
    fetchMock.mockResolvedValue(reply.response);

    const error = await patchExamRecordWithoutPassword(77, { application_number: "2703" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DbServiceExamRecordStatusError);
    expect(error).toMatchObject({ status: 422, message: "patchExamRecordWithoutPassword failed (422)" });
    expect(reply.text).not.toHaveBeenCalled();
    expect(reply.json).not.toHaveBeenCalled();
  });
});
