import { beforeEach, describe, expect, it, vi } from "vitest";

// The Test Attendance gate through the real School access check and permission
// layer: only the session and the Postgres `query()` boundary are stubbed.
const { mockQuery, mockGetServerSession } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));

import { authorizeTestAttendance } from "./test-attendance-gate";

const email = "viewer@avantifellows.org";

const jnvSchool = { id: "9", code: "JNV001", name: "JNV Test", region: "South", af_school_category: "JNV" };
const otherSchool = { ...jnvSchool, id: "10", code: "GOV001", name: "Govt School", af_school_category: "Government" };

let school: Record<string, unknown> | null;
let permissionRow: Record<string, unknown> | null;

const row = (role: string, overrides: Record<string, unknown> = {}) => ({
  email,
  level: 1,
  role,
  school_codes: [String(school?.code ?? "JNV001")],
  regions: null,
  program_ids: [1, 2, 64],
  read_only: false,
  user_id: 777,
  ...overrides,
});

async function statusFor(udise = "JNV001") {
  const auth = await authorizeTestAttendance(udise);
  return auth.authorized ? "authorized" : auth.response.status;
}

beforeEach(() => {
  vi.resetAllMocks();
  school = jnvSchool;
  permissionRow = row("pmu_govt_school_user");
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM user_permission")) return permissionRow ? [permissionRow] : [];
    if (sql.includes("FROM school WHERE")) return school ? [school] : [];
    return [];
  });
});

describe("authorizeTestAttendance", () => {
  it("lets a viewer with School access and the feature through at a JNV School, with the School", async () => {
    const auth = await authorizeTestAttendance("JNV001");

    expect(auth.authorized).toBe(true);
    expect(auth.authorized && auth.school).toEqual(jnvSchool);
  });

  it("answers 401 when signed out, before reading anything", async () => {
    mockGetServerSession.mockResolvedValue(null);

    expect(await statusFor()).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown School before checking permissions", async () => {
    school = null;

    expect(await statusFor("NOPE")).toBe(404);
    expect(mockQuery.mock.calls.some(([sql]) => String(sql).includes("FROM user_permission"))).toBe(false);
  });

  it("answers 403 without School access", async () => {
    permissionRow = row("pmu_govt_school_user", { school_codes: ["JNV999"] });

    expect(await statusFor()).toBe(403);
  });

  it("answers 403 for a role without the test_attendance feature", async () => {
    permissionRow = row("teacher");

    expect(await statusFor()).toBe(403);
  });

  it("answers 403 at a School that is not a JNV, for an Admin too", async () => {
    school = otherSchool;
    permissionRow = row("admin", { level: 3, school_codes: null });

    const auth = await authorizeTestAttendance("GOV001");

    expect(auth.authorized).toBe(false);
    expect(!auth.authorized && auth.response.status).toBe(403);
    expect(!auth.authorized && (await auth.response.json())).toEqual({ error: "Access denied" });
  });
});
