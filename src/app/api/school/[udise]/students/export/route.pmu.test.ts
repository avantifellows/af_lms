import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Download List through the real gate and permission layer: only the session,
// Postgres and the roster loader are mocked, so the matrix, read_only downgrade,
// NVS pin (ADR 0007) and School scope all run as in production.
const { mockQuery, mockGetServerSession, mockGetSchoolRoster } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockGetServerSession: vi.fn(),
  mockGetSchoolRoster: vi.fn(),
}));
vi.mock("next-auth", () => ({ getServerSession: mockGetServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: mockQuery }));
vi.mock("@/lib/school-students", () => ({ getSchoolRoster: mockGetSchoolRoster }));

import { GET } from "./route";

const email = "pmu@avantifellows.org";

const jnvSchool = {
  id: "9",
  code: "JNV001",
  udise_code: "12345678901",
  region: "South",
  af_school_category: "JNV",
};

const student = (overrides: Record<string, unknown>) => ({
  group_user_id: "1",
  user_id: "10",
  student_pk_id: "100",
  first_name: "Asha",
  last_name: "Kumar",
  grade: 11,
  stream: "engineering",
  status: "enrolled",
  program_id: 64,
  student_program_ids: [64],
  dropout_program_ids: [],
  ...overrides,
});

let permissionRow: Record<string, unknown>;
let school: Record<string, unknown>;

function row(role: string, overrides: Record<string, unknown> = {}) {
  return {
    email,
    level: 1,
    role,
    school_codes: ["JNV001"],
    regions: null,
    program_ids: [1, 64],
    read_only: true,
    user_id: 777,
    ...overrides,
  };
}

async function download() {
  return GET(
    new NextRequest("http://localhost/api/school/12345678901/students/export"),
    { params: Promise.resolve({ udise: "12345678901" }) },
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  school = jnvSchool;
  mockGetServerSession.mockResolvedValue({ user: { email } });
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM user_permission")) return [permissionRow];
    if (sql.includes("FROM school WHERE")) return [school];
    return [];
  });
  mockGetSchoolRoster.mockResolvedValue({
    issues: [],
    students: [
      student({ first_name: "Nvs" }),
      student({
        group_user_id: "2",
        student_pk_id: "101",
        first_name: "Coe",
        program_id: 1,
        student_program_ids: [1],
      }),
    ],
  });
});

describe.each(["pmu_manager", "pmu_govt_school_user"])("read_only %s Download List", (role) => {
  beforeEach(() => {
    permissionRow = row(role);
  });

  it("downloads only NVS Students", async () => {
    const response = await download();

    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const active = workbook.getWorksheet("Active")!;
    expect(active.rowCount).toBe(2);
    expect(active.getRow(2).getCell(2).value).toBe("Nvs Kumar");
  });

  it("is refused at a non-JNV School", async () => {
    school = { ...jnvSchool, af_school_category: "Other" };

    const response = await download();

    expect(response.status).toBe(403);
    expect(mockGetSchoolRoster).not.toHaveBeenCalled();
  });

  it("is refused at a School outside their scope", async () => {
    permissionRow = row(role, { school_codes: ["JNV999"] });

    const response = await download();

    expect(response.status).toBe(403);
    expect(mockGetSchoolRoster).not.toHaveBeenCalled();
  });
});

describe.each(["program_manager", "program_admin"])("read_only %s Download List (unchanged)", (role) => {
  it("is still refused", async () => {
    permissionRow = row(role);

    const response = await download();

    expect(response.status).toBe(403);
    expect(mockGetSchoolRoster).not.toHaveBeenCalled();
  });
});
