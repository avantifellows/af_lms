import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/student-addition-access", () => ({
  requireStudentAdditionStudentAccess: vi.fn(),
}));
vi.mock("@/lib/lms-enrollment-date", () => ({
  deriveLmsEnrollmentPeriod: vi.fn(),
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { requireStudentAdditionStudentAccess } from "@/lib/student-addition-access";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { POST } from "./route";
import { jsonRequest, NO_SESSION, ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockRequireStudentAdditionStudentAccess = vi.mocked(requireStudentAdditionStudentAccess);
const mockDeriveLmsEnrollmentPeriod = vi.mocked(deriveLmsEnrollmentPeriod);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  process.env.DB_SERVICE_URL = "https://db.example.test";
  process.env.DB_SERVICE_TOKEN = "test-token";
  vi.stubGlobal("fetch", mockFetch);
  mockQuery.mockResolvedValue([
    {
      id: 100,
      student_id: "S123",
      apaar_id: "AP123",
      status: "enrolled",
    },
  ]);
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

const validBody = {
  student_pk_id: 100,
};

describe("POST /api/student/dropout", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(401);
  });

  it("returns 400 when student_pk_id is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: {},
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("student_pk_id");
  });

  it("marks student as dropout successfully", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response("", { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  it("resolves the authorized student before proxying the dropout", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response("", { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: {
        student_pk_id: 100,
        student_id: "CLIENT-SHOULD-NOT-WIN",
        apaar_id: "CLIENT-SHOULD-NOT-WIN",
        start_date: "2020-01-01",
        academic_year: "2019-2020",
      },
    });

    const res = await POST(req as never);

    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("FROM student"),
      [100],
    );
    expect(mockRequireStudentAdditionStudentAccess).toHaveBeenCalledWith(ADMIN_SESSION, 100);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://db.example.test/dropout",
      expect.objectContaining({ method: "PATCH" }),
    );
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload).toEqual({
      student_id: "S123",
      apaar_id: "AP123",
      start_date: "2026-07-01",
      academic_year: "2026-2027",
      actor: {
        user_id: 501,
        email: "pm@example.org",
        login_type: "google",
        role: "program_manager",
      },
      school: { code: "JNV001", udise_code: "12345678901" },
      program_id: 64,
    });
  });

  it("returns 403 and does not proxy when the shared student gate denies", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockRequireStudentAdditionStudentAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: "Forbidden",
    });

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Forbidden" });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 404 and does not proxy when the identifier is not found", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([]);

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Student not found with the provided identifier" });
    expect(mockRequireStudentAdditionStudentAccess).toHaveBeenCalledWith(ADMIN_SESSION, 100);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the authorized student has no dropout identifier", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([
      { id: 100, student_id: null, apaar_id: null, status: "enrolled" },
    ]);

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Student has no dropout identifier" });
    expect(mockRequireStudentAdditionStudentAccess).toHaveBeenCalledWith(ADMIN_SESSION, 100);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns already-dropout before proxying", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([
      { id: 100, student_id: "S123", apaar_id: "AP123", status: "dropout" },
    ]);

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });

    const res = await POST(req as never);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Student is already marked as dropout" });
    expect(mockRequireStudentAdditionStudentAccess).toHaveBeenCalledWith(ADMIN_SESSION, 100);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("uses the authorized row apaar_id when student_id is not present", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockQuery.mockResolvedValue([
      {
        id: 100,
        student_id: null,
        apaar_id: "AP123",
        status: "enrolled",
      },
    ]);
    mockFetch.mockResolvedValue(new Response("", { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(200);
    // Verify fetch body uses apaar_id
    const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(fetchBody.apaar_id).toBe("AP123");
    expect(fetchBody.student_id).toBeUndefined();
  });

  it("returns 400 when student is already dropout", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ errors: "Student is already marked as dropout" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("already marked as dropout");
  });

  it("returns 400 with DB service error message for other 400 errors", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ errors: "Some validation error" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 with duplicate student error", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(
      new Response("expected at most one result but got 2", { status: 500 })
    );

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Multiple students found");
  });

  it("forwards non-400 error status from DB service", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response("Server error", { status: 503 }));

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(503);
  });

  it("returns 500 on fetch exception", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockRejectedValue(new Error("network error"));

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: validBody,
    });
    const res = await POST(req as never);
    expect(res.status).toBe(500);
  });
});
