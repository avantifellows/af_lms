import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/api-auth", () => ({
  authorizeSchoolAccess: vi.fn(),
}));
vi.mock("@/lib/bigquery", () => ({
  getAvailableGrades: vi.fn(),
  getAvailablePrograms: vi.fn(),
}));
vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async () => {
  const actual = await vi.importActual<typeof import("@/lib/permissions")>(
    "@/lib/permissions"
  );
  return {
    ...actual,
    getUserPermission: vi.fn(),
  };
});

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { getAvailableGrades, getAvailablePrograms } from "@/lib/bigquery";
import { getServerSession } from "next-auth";
import { getUserPermission } from "@/lib/permissions";
import { GET } from "./route";
import {
  PMU_GOVT_PERMISSION,
  PMU_GOVT_SESSION,
  PMU_MANAGER_PERMISSION,
  PMU_MANAGER_SESSION,
  routeParams,
} from "../../../__test-utils__/api-test-helpers";

const mockAuth = vi.mocked(authorizeSchoolAccess);
const mockGetGrades = vi.mocked(getAvailableGrades);
const mockGetPrograms = vi.mocked(getAvailablePrograms);
const mockSession = vi.mocked(getServerSession);
const mockPermission = vi.mocked(getUserPermission);

beforeEach(() => {
  vi.resetAllMocks();
  mockGetPrograms.mockResolvedValue([]);
  // Default: admin session → no program filtering applied
  mockSession.mockResolvedValue({
    user: { email: "admin@avantifellows.org" },
  } as never);
  mockPermission.mockResolvedValue({
    email: "admin@avantifellows.org",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [1, 2, 64],
    read_only: false,
  });
});

const SCHOOL = { id: "1", code: "70705", name: "Test School", region: "North" };

describe("GET /api/quiz-analytics/[udise]/grades", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 403 when access is denied", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Access denied" });
  });

  it("returns 404 when school not found", async () => {
    mockAuth.mockResolvedValue({
      authorized: false,
      response: NextResponse.json({ error: "School not found" }, { status: 404 }),
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/9999/grades"),
      routeParams({ udise: "9999" })
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "School not found" });
  });

  it("returns grades and programs on success", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([9, 10, 11]);
    mockGetPrograms.mockResolvedValue(["JNV CoE", "JNV Nodal"]);

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      grades: [9, 10, 11],
      programs: ["JNV CoE", "JNV Nodal"],
    });
    expect(mockGetGrades).toHaveBeenCalledWith("1234", undefined);
    expect(mockGetPrograms).toHaveBeenCalledWith("1234");
  });

  it("passes program param to getAvailableGrades", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([10]);
    mockGetPrograms.mockResolvedValue(["JNV CoE"]);

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades?program=JNV+CoE"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    expect(mockGetGrades).toHaveBeenCalledWith("1234", "JNV CoE");
  });

  it("filters programs to those assigned to the user", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([11, 12]);
    mockGetPrograms.mockResolvedValue(["JNV CoE", "JNV Nodal", "JNV NVS"]);
    mockSession.mockResolvedValue({
      user: { email: "teacher@example.com" },
    } as never);
    mockPermission.mockResolvedValue({
      email: "teacher@example.com",
      level: 1,
      role: "teacher",
      school_codes: ["70705"],
      regions: null,
      program_ids: [1], // CoE only
      read_only: false,
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      grades: [11, 12],
      programs: ["JNV CoE"],
    });
  });

  it("admins see every program regardless of program_ids", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([11, 12]);
    mockGetPrograms.mockResolvedValue(["JNV CoE", "JNV NVS"]);
    mockSession.mockResolvedValue({
      user: { email: "admin@example.com" },
    } as never);
    mockPermission.mockResolvedValue({
      email: "admin@example.com",
      level: 3,
      role: "admin",
      school_codes: null,
      regions: null,
      program_ids: [1],
      read_only: false,
    });

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    await expect(res.json()).resolves.toEqual({
      grades: [11, 12],
      programs: ["JNV CoE", "JNV NVS"],
    });
  });

  it("returns empty grades array when none exist", async () => {
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL });
    mockGetGrades.mockResolvedValue([]);
    mockGetPrograms.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ grades: [], programs: [] });
  });
});

// PMU roles are pinned to JNV NVS (ADR 0007). The program list comes from the
// pinned program context, so stray CoE/Nodal ids on the row never widen it.
describe.each([
  ["PMU Manager", PMU_MANAGER_SESSION, PMU_MANAGER_PERMISSION],
  ["PMU Govt School User", PMU_GOVT_SESSION, PMU_GOVT_PERMISSION],
])("GET grades as %s", (_label, session, basePermission) => {
  const permission = { ...basePermission, program_ids: [1, 2, 64] };

  beforeEach(() => {
    mockSession.mockResolvedValue(session as never);
    mockPermission.mockResolvedValue(permission);
    mockAuth.mockResolvedValue({ authorized: true, school: SCHOOL, readOnly: false, permission });
    mockGetGrades.mockResolvedValue([11, 12]);
    mockGetPrograms.mockResolvedValue(["JNV CoE", "JNV Nodal", "JNV NVS"]);
  });

  it("serves JNV NVS grades and only the JNV NVS program when no program is given", async () => {
    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ grades: [11, 12], programs: ["JNV NVS"] });
    expect(mockGetGrades).toHaveBeenCalledWith("1234", "JNV NVS");
  });

  it("serves program=JNV NVS", async () => {
    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades?program=JNV%20NVS"),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(200);
    expect(mockGetGrades).toHaveBeenCalledWith("1234", "JNV NVS");
  });

  it.each(["JNV CoE", "JNV Nodal", "Punjab CoE"])("403s program=%s", async (program) => {
    const res = await GET(
      new Request(`http://localhost/api/quiz-analytics/1234/grades?program=${encodeURIComponent(program)}`),
      routeParams({ udise: "1234" })
    );
    expect(res.status).toBe(403);
    expect(mockGetGrades).not.toHaveBeenCalled();
    expect(mockGetPrograms).not.toHaveBeenCalled();
  });

  it("returns no programs when the School has no JNV NVS results", async () => {
    mockGetPrograms.mockResolvedValue(["JNV CoE"]);
    const res = await GET(
      new Request("http://localhost/api/quiz-analytics/1234/grades"),
      routeParams({ udise: "1234" })
    );
    await expect(res.json()).resolves.toMatchObject({ programs: [] });
  });
});
