import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return {
    getAccessibleSchoolCodes: vi.fn(),
    getResolvedPermission: vi.fn(),
    getCentreConfinement: vi.fn(),
    // The real shared fragment, so the assertions see the SQL PMU search runs.
    hasCurrentNvsBatchSql: actual.hasCurrentNvsBatchSql,
  };
});
vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { getServerSession } from "next-auth";
import {
  getAccessibleSchoolCodes,
  getCentreConfinement,
  getResolvedPermission,
} from "@/lib/permissions";
import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { GET } from "./route";
import {
  NO_SESSION,
  ADMIN_SESSION,
  PMU_MANAGER_SESSION,
  PMU_GOVT_SESSION,
} from "../../__test-utils__/api-test-helpers";

const mockSession = vi.mocked(getServerSession);
const mockGetCodes = vi.mocked(getAccessibleSchoolCodes);
const mockGetPermission = vi.mocked(getResolvedPermission);
const mockConfinement = vi.mocked(getCentreConfinement);
const mockQuery = vi.mocked(query);

beforeEach(() => {
  vi.resetAllMocks();
  mockGetPermission.mockResolvedValue(null);
  mockConfinement.mockReturnValue({ confined: false, centreIds: [] });
});

describe("GET /api/students/search", () => {
  it("returns 401 when not authenticated", async () => {
    mockSession.mockResolvedValue(NO_SESSION);
    const req = new Request("http://localhost/api/students/search?q=test");
    const res = await GET(req as never);
    expect(res.status).toBe(401);
  });

  it("returns empty array when query is too short", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    const req = new Request("http://localhost/api/students/search?q=a");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
    expect(mockGetCodes).not.toHaveBeenCalled();
  });

  it("returns empty array when user has no school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue([]);
    const req = new Request("http://localhost/api/students/search?q=john");
    const res = await GET(req as never);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it("searches all schools when user has all-school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue("all" as never);
    const results = [{ user_id: "1", first_name: "John", last_name: "Doe" }];
    mockQuery.mockResolvedValue(results);

    const req = new Request("http://localhost/api/students/search?q=john");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(results);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("af_school_category = 'JNV'"),
      ["%john%", CURRENT_ACADEMIC_YEAR],
    );
    // Visibility scope mirrors the dashboard/school-page: JNV OR active-centre-
    // linked, so students at the non-JNV centre schools (Punjab CoE / EMRS) are
    // searchable too — not silently filtered by a JNV-only WHERE.
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("FROM centres c WHERE c.school_id = sch.id AND c.is_active");
    // Current-cohort rule shared with the canonical roster: results are
    // restricted to students enrolled for the current academic year.
    expect(sql).toContain("er.academic_year = $2");
    expect(sql).not.toContain("s.grade_id");
  });

  it("searches specific schools when user has limited access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue(["70705", "70706"] as never);
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/students/search?q=test");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("sch.code = ANY($3)"),
      ["%test%", CURRENT_ACADEMIC_YEAR, ["70705", "70706"]],
    );
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain("er.academic_year = $2");
    // Scoped branch carries the same JNV-OR-active-centre visibility scope, so a
    // user seated at a centre school can search its students within their codes.
    expect(sql).toContain("FROM centres c WHERE c.school_id = sch.id AND c.is_active");
  });

  // A centre seat grants parent-school access so school-linked actions (visits)
  // work. Before this, that made every student at the school searchable by a
  // confined user — name, student id, grade and phone included.
  it("restricts a centre-confined user to their own centres' students", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue(["70705"] as never);
    mockConfinement.mockReturnValue({ confined: true, centreIds: [8, 11] });
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/students/search?q=test");
    const res = await GET(req as never);
    expect(res.status).toBe(200);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // Scoped to seat centres via the membership view, so search results and the
    // roster the user can actually open agree.
    expect(sql).toContain("FROM centre_students cs");
    expect(sql).toContain("cs.centre_id = ANY($3::int[])");
    expect(sql).toContain("JOIN scoped ON scoped.user_id = u.id");
    expect(params).toEqual(["%test%", CURRENT_ACADEMIC_YEAR, [8, 11]]);
    // The scope is resolved first as a MATERIALIZED CTE — without it the planner
    // drives from the ILIKEs over every user and a no-match term runs 40s on
    // prod (past the 15s statement_timeout). The CTE must precede the SELECT.
    expect(sql).toMatch(/^\s*WITH scoped AS MATERIALIZED \(/);
    expect(sql.indexOf("WITH scoped")).toBeLessThan(sql.indexOf("SELECT DISTINCT"));
    // The school-code predicate must NOT also be applied — it would be the wider
    // scope, and leaving it in invites reading this as school-scoped.
    expect(sql).not.toContain("sch.code = ANY");
  });

  // Confinement outranks all-school access: a seated admin is still seat-scoped.
  it("restricts a confined user even when they have all-school access", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetCodes.mockResolvedValue("all" as never);
    mockConfinement.mockReturnValue({ confined: true, centreIds: [8] });
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/students/search?q=test");
    await GET(req as never);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("cs.centre_id = ANY($3::int[])");
    expect(sql).toContain("JOIN scoped ON scoped.user_id = u.id");
    expect(params).toEqual(["%test%", CURRENT_ACADEMIC_YEAR, [8]]);
  });

  // PMU roles are pinned to JNV NVS: at a mixed School they must not see the
  // CoE / Nodal Students, nor Students with no batch at all.
  it("narrows a region-scoped PMU user's search to Students with a current NVS batch", async () => {
    mockSession.mockResolvedValue(PMU_GOVT_SESSION);
    mockGetPermission.mockResolvedValue({
      email: PMU_GOVT_SESSION.user.email,
      level: 2,
      role: "pmu_govt_school_user",
      regions: ["north"],
      school_codes: null,
      program_ids: [64],
      read_only: false,
    } as never);
    mockGetCodes.mockResolvedValue(["70705"] as never);
    const results = [{ user_id: "7", first_name: "Nia", last_name: "V" }];
    mockQuery.mockResolvedValue(results);

    const req = new Request("http://localhost/api/students/search?q=nia");
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(results);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("sch.code = ANY($3)");
    expect(sql).toMatch(/AND EXISTS \(\s*SELECT 1\s*FROM enrollment_record er_nvs/);
    expect(sql).toContain("er_nvs.user_id = u.id");
    expect(sql).toContain("er_nvs.is_current = true");
    expect(sql).toContain("b_nvs.program_id = 64");
    expect(params).toEqual(["%nia%", CURRENT_ACADEMIC_YEAR, ["70705"]]);
  });

  it("narrows a level-3 PMU Manager's all-school search to NVS Students", async () => {
    mockSession.mockResolvedValue(PMU_MANAGER_SESSION);
    mockGetPermission.mockResolvedValue({
      email: PMU_MANAGER_SESSION.user.email,
      level: 3,
      role: "pmu_manager",
      regions: null,
      school_codes: null,
      program_ids: [64],
      read_only: false,
    } as never);
    mockGetCodes.mockResolvedValue("all" as never);
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/students/search?q=nia");
    await GET(req as never);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("er_nvs.user_id = u.id");
    expect(sql).toContain("b_nvs.program_id = 64");
    expect(params).toEqual(["%nia%", CURRENT_ACADEMIC_YEAR]);
  });

  it("does not add the NVS predicate for non-PMU roles", async () => {
    mockSession.mockResolvedValue(ADMIN_SESSION);
    mockGetPermission.mockResolvedValue({
      email: ADMIN_SESSION.user.email,
      level: 3,
      role: "admin",
      regions: null,
      school_codes: null,
      program_ids: [1, 2, 64],
      read_only: false,
    } as never);
    mockGetCodes.mockResolvedValue("all" as never);
    mockQuery.mockResolvedValue([]);

    const req = new Request("http://localhost/api/students/search?q=nia");
    await GET(req as never);

    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).not.toContain("er_nvs");
  });
});
