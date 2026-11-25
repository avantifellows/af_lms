import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ADMIN_SESSION,
  jsonRequest,
  routeParams,
} from "@/app/api/__test-utils__/api-test-helpers";
import {
  examRecordsPermissionRow as permissionRow,
  queueExamRecordsGate,
} from "@/app/api/__test-utils__/exam-records-gate";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/student-exam-records", () => ({
  listExamOptions: vi.fn(),
  listStudentExamRecords: vi.fn(),
  attachAcknowledgements: vi.fn(),
}));
vi.mock("@/lib/db-service-exam-records", () => ({
  createExamRecord: vi.fn(),
  updateExamRecord: vi.fn(),
  deleteExamRecord: vi.fn(),
}));
vi.mock("@/lib/exam-password-crypto", () => ({ encryptExamPassword: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import {
  attachAcknowledgements,
  listExamOptions,
  listStudentExamRecords,
} from "@/lib/student-exam-records";
import {
  createExamRecord,
  deleteExamRecord,
  updateExamRecord,
} from "@/lib/db-service-exam-records";
import { encryptExamPassword } from "@/lib/exam-password-crypto";
import { GET, PUT } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockListExams = vi.mocked(listExamOptions);
const mockListRecords = vi.mocked(listStudentExamRecords);
const mockAttach = vi.mocked(attachAcknowledgements);
const mockCreate = vi.mocked(createExamRecord);
const mockUpdate = vi.mocked(updateExamRecord);
const mockDelete = vi.mocked(deleteExamRecord);
const mockEncrypt = vi.mocked(encryptExamPassword);

const JEE = { id: 1, name: "JEE Mains" };
const NEET = { id: 2, name: "NEET" };

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks leaves queued `mockResolvedValueOnce` values in place; a gate
  // that short-circuits (read-only, PMU) leaves its unused rows behind and
  // shifts the next test's queue, so the query queue is reset outright.
  mockQuery.mockReset();
  // Same for the DB Service writes: a test that queues a one-off rejection
  // but stops before using it must not fail whichever test runs next.
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockDelete.mockReset();
  mockListExams.mockResolvedValue([JEE, NEET]);
  mockListRecords.mockResolvedValue([]);
  mockAttach.mockImplementation(async (_studentId, records) => ({
    records: records.map((record) => ({ ...record, acknowledgements: [] })),
    acknowledgementsAvailable: true,
  }));
  mockEncrypt.mockImplementation(async (plaintext, studentId) => `enc(${plaintext}|${studentId})`);
});

/** Sign in and pass (or stop) the Exams tab gate — see `queueExamRecordsGate`. */
function authorize(options: { readOnly?: boolean; pmuOnly?: boolean } = {}) {
  queueExamRecordsGate(mockSession, mockQuery, options);
}

function putRequest(body: unknown) {
  return jsonRequest("http://test/api/students/7/exam-records", { method: "PUT", body });
}

describe("GET /api/students/[id]/exam-records", () => {
  it("refuses an unauthenticated caller", async () => {
    mockSession.mockResolvedValue(null);

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    expect(res.status).toBe(401);
    expect(mockListRecords).not.toHaveBeenCalled();
  });

  it("rejects a student id that is not an integer", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);

    const res = await GET(new Request("http://test"), routeParams({ id: "7abc" }));

    expect(res.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("refuses a read-only user, because the response carries passwords", async () => {
    authorize({ readOnly: true });

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    expect(res.status).toBe(403);
    expect(mockListRecords).not.toHaveBeenCalled();
  });

  it("refuses a PMU (JNV NVS) Student — exams are physical-centre only", async () => {
    authorize({ pmuOnly: true });

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "Exam registrations are not collected for JNV NVS Students",
    });
    expect(mockListRecords).not.toHaveBeenCalled();
  });

  it("returns the registrations with whether a password is stored, never the password", async () => {
    authorize();
    // `exam_passwords` is read from the permission row once the gate passes.
    mockQuery.mockResolvedValueOnce([permissionRow()]);
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "JEE123",
        has_password: true,
        sessions_applied: [1],
      },
    ]);

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exams).toEqual([JEE, NEET]);
    expect(body.records[0]).toEqual({
      id: 10,
      exam_id: 1,
      exam_name: "JEE Mains",
      application_number: "JEE123",
      has_password: true,
      sessions_applied: [1],
      acknowledgements: [],
    });
    expect(body.can_reveal_password).toBe(true);
    expect(body.acknowledgements_available).toBe(true);
    expect(mockAttach).toHaveBeenCalledWith(7, expect.any(Array));
  });

  it("returns each registration's acknowledgements, and says when they can't be read", async () => {
    authorize();
    mockQuery.mockResolvedValueOnce([permissionRow()]);
    const record = {
      id: 10,
      exam_id: 1,
      exam_name: "JEE Mains",
      application_number: "JEE123",
      has_password: false,
      sessions_applied: [1, 2],
    };
    mockListRecords.mockResolvedValue([record]);
    const ack = {
      id: 501,
      exam_session: 2,
      pages: [{ page_number: 1, mime_type: "application/pdf" }],
      uploaded_by: "teacher@avantifellows.org",
      uploaded_at: "2026-11-25T10:00:00.000Z",
    };
    mockAttach.mockResolvedValueOnce({
      records: [{ ...record, acknowledgements: [ack] }],
      acknowledgementsAvailable: false,
    });

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    const body = await res.json();
    expect(body.records[0].acknowledgements).toEqual([ack]);
    expect(body.acknowledgements_available).toBe(false);
  });

  it("tells a role without exam_passwords that it cannot reveal", async () => {
    authorize();
    mockQuery.mockResolvedValueOnce([permissionRow({ role: "holistic_mentorship_admin" })]);

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    expect(res.status).toBe(200);
    expect((await res.json()).can_reveal_password).toBe(false);
  });
});

/** PUT one registration and expect a 403 that never reached the DB Service. */
async function expectRefusedBeforeWriting() {
  const res = await PUT(
    putRequest({ exams: [{ exam_id: 1, application_number: "JEE123" }] }),
    routeParams({ id: "7" }),
  );
  expect(res.status).toBe(403);
  expect(mockCreate).not.toHaveBeenCalled();
}

describe("PUT /api/students/[id]/exam-records", () => {
  it("refuses a PMU (JNV NVS) Student, so the UI gate can't be walked around", async () => {
    authorize({ pmuOnly: true });

    await expectRefusedBeforeWriting();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses a read-only user before touching the DB Service", async () => {
    authorize({ readOnly: true });

    await expectRefusedBeforeWriting();
  });

  it("creates a registration for an exam the Student has none for", async () => {
    authorize();

    const res = await PUT(
      putRequest({
        exams: [
          {
            exam_id: 1,
            application_number: " JEE123 ",
            application_password: "secret",
            sessions_applied: [2, 1, 2],
          },
        ],
      }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(200);
    expect(mockEncrypt).toHaveBeenCalledWith("secret", 7);
    expect(mockCreate).toHaveBeenCalledWith({
      student_id: 7,
      exam_id: 1,
      application_number: "JEE123",
      sessions_applied: [1, 2],
      application_password: null,
      application_password_ciphertext: "enc(secret|7)",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("never sends a plaintext password to the DB Service", async () => {
    authorize();

    await PUT(
      putRequest({ exams: [{ exam_id: 1, application_number: "JEE123", application_password: "secret" }] }),
      routeParams({ id: "7" }),
    );

    expect(JSON.stringify(mockCreate.mock.calls)).not.toContain('"secret"');
  });

  it("fails a registration whose password cannot be encrypted, and sends nothing for it", async () => {
    authorize();
    mockEncrypt.mockRejectedValueOnce(
      new Error("User arn:aws:iam::123:user/x is not authorized on arn:aws:kms:ap-south-1:123:key/k"),
    );

    const res = await PUT(
      putRequest({
        exams: [
          { exam_id: 1, application_number: "JEE123", application_password: "secret" },
          { exam_id: 2, application_number: "NEET9" },
        ],
      }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).warnings).toEqual([
      "Could not save JEE Mains: the password could not be encrypted; try again later",
    ]);
    expect(JSON.stringify(mockCreate.mock.calls)).not.toContain("arn:aws");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({ exam_id: 2 });
  });

  it("updates a changed registration and leaves an unchanged one alone", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "JEE123",
        has_password: true,
        sessions_applied: [1],
      },
      {
        id: 11,
        exam_id: 2,
        exam_name: "NEET",
        application_number: "NEET9",
        has_password: false,
        sessions_applied: null,
      },
    ]);

    // JEE Mains leaves the password out — the tab never has the stored one —
    // so it keeps it and nothing else changed.
    const res = await PUT(
      putRequest({
        exams: [
          { exam_id: 1, application_number: "JEE123", sessions_applied: [1] },
          { exam_id: 2, application_number: "NEET9", application_password: "np" },
        ],
      }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(11, {
      student_id: 7,
      exam_id: 2,
      application_number: "NEET9",
      sessions_applied: null,
      application_password: null,
      application_password_ciphertext: "enc(np|7)",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("keeps a stored password when only the registration changes", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "JEE123",
        has_password: true,
        sessions_applied: [1],
      },
    ]);

    await PUT(
      putRequest({ exams: [{ exam_id: 1, application_number: "JEE123", sessions_applied: [1, 2] }] }),
      routeParams({ id: "7" }),
    );

    expect(mockEncrypt).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(10, {
      student_id: 7,
      exam_id: 1,
      application_number: "JEE123",
      sessions_applied: [1, 2],
    });
  });

  it("clears a stored password, and skips clearing one that is not stored", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "JEE123",
        has_password: true,
        sessions_applied: null,
      },
      {
        id: 11,
        exam_id: 2,
        exam_name: "NEET",
        application_number: "NEET9",
        has_password: false,
        sessions_applied: null,
      },
    ]);

    await PUT(
      putRequest({
        exams: [
          { exam_id: 1, application_number: "JEE123", application_password: null },
          { exam_id: 2, application_number: "NEET9", application_password: "" },
        ],
      }),
      routeParams({ id: "7" }),
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith(10, {
      student_id: 7,
      exam_id: 1,
      application_number: "JEE123",
      sessions_applied: null,
      application_password: null,
      application_password_ciphertext: null,
    });
  });

  it("deletes a removed registration before writing the rest", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "SHARED1",
        has_password: false,
        sessions_applied: null,
      },
    ]);
    const order: string[] = [];
    mockDelete.mockImplementation(async () => {
      order.push("delete");
    });
    mockCreate.mockImplementation(async () => {
      order.push("create");
    });

    // The application number moves from JEE Mains to NEET — only safe because
    // the old row goes first.
    const res = await PUT(
      putRequest({
        exams: [{ exam_id: 2, application_number: "SHARED1" }],
        removed_record_ids: [10],
      }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(200);
    expect(order).toEqual(["delete", "create"]);
    expect(mockDelete).toHaveBeenCalledWith(10);
  });

  it("ignores a removal for a record the Student does not have", async () => {
    authorize();

    const res = await PUT(
      putRequest({ exams: [], removed_record_ids: [999] }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(200);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses an application number already stored against another exam", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "SHARED1",
        has_password: false,
        sessions_applied: null,
      },
    ]);

    const res = await PUT(
      putRequest({
        exams: [
          { exam_id: 1, application_number: "SHARED1" },
          { exam_id: 2, application_number: "shared1" },
        ],
      }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Application number shared1 is used for two exams",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses an exam that is not on the competitive list", async () => {
    authorize();

    const res = await PUT(
      putRequest({ exams: [{ exam_id: 23, application_number: "X1" }] }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports a partial failure as a warning and still returns the records", async () => {
    authorize();
    mockCreate
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("upstream exploded"));

    const res = await PUT(
      putRequest({
        exams: [
          { exam_id: 1, application_number: "JEE123" },
          { exam_id: 2, application_number: "NEET9" },
        ],
      }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings).toEqual(["Could not save NEET: upstream exploded"]);
  });

  it("fails the save when every write fails", async () => {
    authorize();
    mockCreate.mockRejectedValue(new Error("upstream exploded"));

    const res = await PUT(
      putRequest({ exams: [{ exam_id: 1, application_number: "JEE123" }] }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("upstream exploded");
  });
});
