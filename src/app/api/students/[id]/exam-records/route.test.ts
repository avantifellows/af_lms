import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ADMIN_SESSION,
  jsonRequest,
  routeParams,
} from "@/app/api/__test-utils__/api-test-helpers";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/student-exam-records", () => ({
  listExamOptions: vi.fn(),
  listStudentExamRecords: vi.fn(),
}));
vi.mock("@/lib/db-service-exam-records", () => ({
  createExamRecord: vi.fn(),
  updateExamRecord: vi.fn(),
  deleteExamRecord: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { listExamOptions, listStudentExamRecords } from "@/lib/student-exam-records";
import {
  createExamRecord,
  deleteExamRecord,
  updateExamRecord,
} from "@/lib/db-service-exam-records";
import { GET, PUT } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockListExams = vi.mocked(listExamOptions);
const mockListRecords = vi.mocked(listStudentExamRecords);
const mockCreate = vi.mocked(createExamRecord);
const mockUpdate = vi.mocked(updateExamRecord);
const mockDelete = vi.mocked(deleteExamRecord);

const JEE = { id: 1, name: "JEE Mains" };
const NEET = { id: 2, name: "NEET" };

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks leaves queued `mockResolvedValueOnce` values in place; a gate
  // that short-circuits (read-only, PMU) leaves its unused rows behind and
  // shifts the next test's queue, so the query queue is reset outright.
  mockQuery.mockReset();
  mockListExams.mockResolvedValue([JEE, NEET]);
  mockListRecords.mockResolvedValue([]);
});

/**
 * The three queries the gate runs: the Student's school, the permission, then
 * `isPmuOnlyStudent` — which the Student fails by default, being a
 * physical-centre Student with a current non-NVS batch.
 */
function authorize({ readOnly = false, pmuOnly = false } = {}) {
  mockSession.mockResolvedValue(ADMIN_SESSION);
  mockQuery.mockResolvedValueOnce([{ code: "12345", region: "West", program_id: 1 }]);
  mockQuery.mockResolvedValueOnce([
    {
      email: "admin@avantifellows.org",
      level: 3,
      role: readOnly ? "program_admin" : "admin",
      school_codes: null,
      regions: null,
      program_ids: readOnly ? [1] : null,
      read_only: readOnly,
    },
  ]);
  mockQuery.mockResolvedValueOnce([
    pmuOnly ? { nvs: true, other: false } : { nvs: false, other: true },
  ]);
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

  it("returns the picker options and the stored registrations", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "JEE123",
        application_password: "secret",
        sessions_applied: [1],
      },
    ]);

    const res = await GET(new Request("http://test"), routeParams({ id: "7" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.exams).toEqual([JEE, NEET]);
    expect(body.records[0]).toMatchObject({
      id: 10,
      application_number: "JEE123",
      application_password: "secret",
    });
  });
});

describe("PUT /api/students/[id]/exam-records", () => {
  it("refuses a PMU (JNV NVS) Student, so the UI gate can't be walked around", async () => {
    authorize({ pmuOnly: true });

    const res = await PUT(
      putRequest({ exams: [{ exam_id: 1, application_number: "JEE123" }] }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("refuses a read-only user before touching the DB Service", async () => {
    authorize({ readOnly: true });

    const res = await PUT(
      putRequest({ exams: [{ exam_id: 1, application_number: "JEE123" }] }),
      routeParams({ id: "7" }),
    );

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
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
    expect(mockCreate).toHaveBeenCalledWith({
      student_id: 7,
      exam_id: 1,
      application_number: "JEE123",
      application_password: "secret",
      sessions_applied: [1, 2],
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates a changed registration and leaves an unchanged one alone", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "JEE123",
        application_password: "secret",
        sessions_applied: [1],
      },
      {
        id: 11,
        exam_id: 2,
        exam_name: "NEET",
        application_number: "NEET9",
        application_password: null,
        sessions_applied: null,
      },
    ]);

    const res = await PUT(
      putRequest({
        exams: [
          {
            exam_id: 1,
            application_number: "JEE123",
            application_password: "secret",
            sessions_applied: [1],
          },
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
      application_password: "np",
      sessions_applied: null,
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("deletes a removed registration before writing the rest", async () => {
    authorize();
    mockListRecords.mockResolvedValue([
      {
        id: 10,
        exam_id: 1,
        exam_name: "JEE Mains",
        application_number: "SHARED1",
        application_password: null,
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
        application_password: null,
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
