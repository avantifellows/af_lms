import { beforeEach, describe, expect, it, vi } from "vitest";

// Add Student for the PMU roles through the real student-addition access module
// and permission layer. Only the session, Postgres and the DB Service are mocked.
const { mockGetServerSession, mockQuery } = vi.hoisted(() => ({
  mockGetServerSession: vi.fn(),
  mockQuery: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/registration-mode", async () => {
  const actual = await vi.importActual<typeof import("@/lib/registration-mode")>(
    "@/lib/registration-mode",
  );
  return {
    ...actual,
    ACTIVE_REGISTRATION_MODE: actual.APPROVED_REGISTRATION_MODE,
    getRegistrationModeHandshake: () =>
      actual.getRegistrationModeHandshake(actual.APPROVED_REGISTRATION_MODE),
  };
});

import { POST } from "./route";
import { jsonRequest, routeParams } from "../../../__test-utils__/api-test-helpers";

const email = "pmu@avantifellows.org";

const jnvSchool = {
  id: "school-1",
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  af_school_category: "JNV",
};

const validBody = {
  grade: "11",
  student_name: "Asha Kumar",
  date_of_birth: "02/01/2010",
  gender: "Female",
  category: "Gen",
  physically_handicapped: "No",
  pen_number: "01234567890",
  g10_board: "CBSE",
  g10_roll_no: "12345678",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: "Ravi Kumar",
  phone: "9876543210",
  annual_family_income: "Less than Rs. 1,00,000",
};

let school: Record<string, unknown>;
let permissionRow: Record<string, unknown>;

function pmuRow(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: 1,
    role,
    school_codes: ["JNV001"],
    regions: null,
    program_ids: [64],
    read_only: false,
    user_id: 777,
    ...overrides,
  };
}

function addStudent() {
  return POST(
    jsonRequest("http://localhost/api/school/12345678901/students", {
      method: "POST",
      body: validBody,
    }) as never,
    routeParams({ udise: "12345678901" }),
  );
}

describe.each(["pmu_manager", "pmu_govt_school_user"])("POST add Student as %s", (role) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T03:00:00Z"));
    vi.resetAllMocks();
    process.env.DB_SERVICE_URL = "https://db.example.test/api";
    process.env.DB_SERVICE_TOKEN = "token";
    vi.stubGlobal("fetch", vi.fn());
    school = jnvSchool;
    permissionRow = pmuRow(role);
    mockGetServerSession.mockResolvedValue({ user: { email }, expires: "2099-01-01" });
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM user_permission")) return [permissionRow];
      if (sql.includes("FROM school sch")) return [school];
      return [];
    });
  });

  it("proxies to the DB Service with the PMU role as the audit actor", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totals: { total: 1, created: 1 }, results: [] }), {
        status: 200,
      }),
    );

    const response = await addStudent();

    expect(response.status).toBe(200);
    const payload = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(payload).toMatchObject({
      actor: { user_id: 777, email, login_type: "google", role },
      school: { code: "JNV001", udise_code: "12345678901" },
      program_id: 64,
    });
  });

  it("refuses a read_only PMU user without calling the DB Service", async () => {
    permissionRow = pmuRow(role, { read_only: true });

    const response = await addStudent();

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a non-JNV School without calling the DB Service", async () => {
    school = { ...jnvSchool, af_school_category: "Other" };

    const response = await addStudent();

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a JNV School outside the PMU scope without calling the DB Service", async () => {
    permissionRow = pmuRow(role, { school_codes: ["JNV999"] });

    const response = await addStudent();

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
