import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/permissions", () => ({
  getAccessibleSchoolCodes: vi.fn(),
  getResolvedPermission: vi.fn(),
  getCentreConfinement: vi.fn(),
}));
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
import { NO_SESSION, ADMIN_SESSION } from "../../__test-utils__/api-test-helpers";

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
});
