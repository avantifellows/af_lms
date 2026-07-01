import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/student-addition-access", () => ({
  requireStudentAdditionStudentAccess: vi.fn(),
}));
vi.mock("@/lib/lms-enrollment-date", () => ({
  deriveLmsEnrollmentPeriod: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { PATCH } from "./route";
import { requireStudentAdditionStudentAccess } from "@/lib/student-addition-access";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import {
  jsonRequest,
  routeParams,
  NO_SESSION,
  ADMIN_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockRequireStudentAdditionStudentAccess = vi.mocked(requireStudentAdditionStudentAccess);
const mockDeriveLmsEnrollmentPeriod = vi.mocked(deriveLmsEnrollmentPeriod);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DB_SERVICE_URL = "https://db.example.test";
  process.env.DB_SERVICE_TOKEN = "test-token";
  vi.stubGlobal("fetch", mockFetch);
  mockRequireStudentAdditionStudentAccess.mockResolvedValue({
    ok: true,
    programId: 64,
    actor: {
      user_id: 501,
      email: "pm@example.org",
      login_type: "google",
      role: "program_manager",
    },
    school: { code: "JNV001", udise_code: "12345678901" },
  });
  mockDeriveLmsEnrollmentPeriod.mockReturnValue({
    start_date: "2026-07-01",
    academic_year: "2026-2027",
  });
});

const params = routeParams({ id: "100" });

describe("PATCH /api/student/[id]", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "John" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(401);
  });

  it("proxies PRD-safe edits to the atomic LMS student update endpoint", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ status: "updated" }), { status: 200 }),
    );

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: {
        first_name: "Ravi Kumar",
        last_name: "",
        gender: "Others",
        grade: 12,
        stream: "medical",
        g10_board: "CENTRAL BOARD OF SECONDARY EDUCATION",
        batch_group_id: "locked-client-value",
        student_id: "locked-client-value",
      },
    });

    const res = await PATCH(req as never, params);

    expect(res.status).toBe(200);
    expect(mockRequireStudentAdditionStudentAccess).toHaveBeenCalledWith(ADMIN_SESSION, "100");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://db.example.test/api/lms/students/100/update-with-enrollments",
      expect.objectContaining({
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
      }),
    );

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload).toEqual({
      actor: {
        user_id: 501,
        email: "pm@example.org",
        login_type: "google",
        role: "program_manager",
      },
      school: { code: "JNV001", udise_code: "12345678901" },
      program_id: 64,
      start_date: "2026-07-01",
      academic_year: "2026-2027",
      first_name: "Ravi Kumar",
      last_name: "",
      gender: "Others",
      grade: 12,
      stream: "medical",
      g10_board: "CENTRAL BOARD OF SECONDARY EDUCATION",
    });
  });

  it("returns 403 and does not proxy when the shared student addition gate denies", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockRequireStudentAdditionStudentAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane" },
    });

    const res = await PATCH(req as never, params);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe("Forbidden");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when only locked legacy enrollment fields are provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { group_id: "g1", batch_group_id: "bg1", user_id: "u1", student_id: "S1" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("No editable fields provided");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when id param is empty", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/student/", {
      method: "PATCH",
      body: { first_name: "Jane" },
    });
    const res = await PATCH(req as never, routeParams({ id: "" }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Student ID is required");
  });

  it("maps DB Service field errors for the edit modal", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "invalid_g10_roll_for_board",
            message: "CBSE Grade 10 Roll no must be exactly 8 digits",
            fields: ["g10_board"],
          },
        }),
        { status: 422 },
      ),
    );

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { g10_board: "CENTRAL BOARD OF SECONDARY EDUCATION" },
    });
    const res = await PATCH(req as never, params);

    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({
      error: "CBSE Grade 10 Roll no must be exactly 8 digits",
      code: "invalid_g10_roll_for_board",
      field_errors: {
        g10_board: "CBSE Grade 10 Roll no must be exactly 8 digits",
      },
      details: {
        error: {
          code: "invalid_g10_roll_for_board",
          message: "CBSE Grade 10 Roll no must be exactly 8 digits",
          fields: ["g10_board"],
        },
      },
    });
  });

  it("surfaces non-json DB Service errors with their upstream status", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response("Student not found", { status: 404 }));
    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane" },
    });

    const res = await PATCH(req as never, params);

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Student not found");
    expect(json.field_errors).toEqual({});
  });

  it("returns 500 on fetch exception", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockRejectedValue(new Error("network error"));

    const req = jsonRequest("http://localhost/api/student/100", {
      method: "PATCH",
      body: { first_name: "Jane" },
    });
    const res = await PATCH(req as never, params);
    expect(res.status).toBe(500);
  });
});
