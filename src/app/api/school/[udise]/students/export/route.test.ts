import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/school-students", () => ({ getSchoolRoster: vi.fn() }));
vi.mock("@/lib/student-addition-access", () => ({ requireStudentAdditionAccess: vi.fn() }));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { getSchoolRoster } from "@/lib/school-students";
import { requireStudentAdditionAccess } from "@/lib/student-addition-access";
import { GET } from "./route";

const student = (overrides: Record<string, unknown> = {}) => ({
  group_user_id: "1",
  user_id: "10",
  student_pk_id: "100",
  first_name: "Asha",
  last_name: "Kumar",
  phone: "9876543210",
  email: null,
  date_of_birth: "2010-01-02",
  student_id: "202812345678",
  pen_number: "12345678901",
  apaar_id: "123456789012",
  category: "PWD-EWS",
  physically_handicapped: true,
  stream: "engineering",
  gender: "Female",
  g10_board: "CBSE",
  g10_roll_no: "12345678",
  board_stream: "PCM",
  father_name: "Ravi Kumar",
  annual_family_income: "Less than Rs. 1,00,000",
  program_name: "JNV NVS",
  program_id: 64,
  student_program_ids: [64],
  dropout_program_ids: [],
  grade: 11,
  grade_id: "11",
  status: "enrolled",
  updated_at: null,
  ...overrides,
});

describe("GET NVS student export", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getServerSession).mockResolvedValue({ user: { email: "pm@example.org" } } as never);
    vi.mocked(query).mockResolvedValue([{
      id: "9",
      code: "JNV001",
      udise_code: "12345678901",
      region: "R1",
      af_school_category: "JNV",
    }]);
    vi.mocked(requireStudentAdditionAccess).mockResolvedValue({
      ok: true,
      programId: 64,
      permission: {} as never,
      actor: {} as never,
    });
    vi.mocked(getSchoolRoster).mockResolvedValue({
      issues: [],
      students: [
        student({ date_of_birth: new Date("2010-01-02T00:00:00Z") }),
        student({ group_user_id: "2", student_pk_id: "101", first_name: "Meera", grade: 12, stream: "medical" }),
        student({
          group_user_id: "3",
          student_pk_id: "102",
          first_name: "Dropped",
          grade: 12,
          stream: "medical",
          status: "dropout",
          student_program_ids: [],
          dropout_program_ids: [64],
        }),
      ] as never,
    });
  });

  it("filters Active but always includes every NVS dropout", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/school/123/students/export?grade=11&stream=engineering"),
      { params: Promise.resolve({ udise: "123" }) },
    );

    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
    const active = workbook.getWorksheet("Active")!;
    const dropout = workbook.getWorksheet("Dropout")!;

    expect(active.getRow(2).getCell(2).value).toBe("Asha Kumar");
    expect(active.rowCount).toBe(2);
    expect(dropout.getRow(2).getCell(2).value).toBe("Dropped Kumar");
    expect(dropout.rowCount).toBe(2);
    expect(active.getRow(1).values).toEqual([
      undefined,
      "Grade", "Student Name", "Date of Birth", "Gender", "Category", "CWSN",
      "PEN Number", "G10 board", "Grade 10 Roll no", "Board Stream",
      "Primary Exam preparing for", "Father Name", "Parents Phone Number",
      "Yearly / Annual Family Income", "APAAR ID", "Student ID",
    ]);
    expect(active.getRow(2).getCell(5).value).toBe("Gen-EWS");
    expect(active.getRow(2).getCell(6).value).toBe("Yes");
  });
});
