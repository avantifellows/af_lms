import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { POST } from "./route";
import { jsonRequest, NO_SESSION, ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mockFetch);
});

const validBody = {
  student_id: "S123",
  start_date: "2026-01-01",
  academic_year: "2025-26",
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

  it("returns 400 when neither student_id nor apaar_id provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: { start_date: "2026-01-01", academic_year: "2025-26" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("student_id or apaar_id");
  });

  it("returns 400 when start_date is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: { student_id: "S123", academic_year: "2025-26" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("start_date");
  });

  it("returns 400 when academic_year is missing", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: { student_id: "S123", start_date: "2026-01-01" },
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("academic_year");
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

  it("uses apaar_id when student_id is not provided", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockFetch.mockResolvedValue(new Response("", { status: 200 }));

    const req = jsonRequest("http://localhost/api/student/dropout", {
      method: "POST",
      body: { apaar_id: "AP123", start_date: "2026-01-01", academic_year: "2025-26" },
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
