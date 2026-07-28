import ExcelJS from "exceljs";
import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { PROGRAM_IDS } from "@/lib/constants";
import { query } from "@/lib/db";
import { studentDroppedFromProgram, studentHasCurrentProgram } from "@/lib/enrollment-stats";
import { getSchoolRoster } from "@/lib/school-students";
import { requireStudentAdditionAccess } from "@/lib/student-addition-access";
import type { Student } from "@/components/StudentTable";

interface SchoolRow {
  id: string;
  code: string;
  udise_code: string | null;
  region: string | null;
  af_school_category: string | null;
}

const HEADERS = [
  "Grade",
  "Student Name",
  "Date of Birth",
  "Gender",
  "Category",
  "CWSN",
  "PEN Number",
  "G10 board",
  "Grade 10 Roll no",
  "Board Stream",
  "Primary Exam preparing for",
  "Father Name",
  "Parents Phone Number",
  "Yearly / Annual Family Income",
  "APAAR ID",
  "Student ID",
];

function categoryAndCwsn(student: Student) {
  const pwd = Boolean(student.physically_handicapped || student.category?.startsWith("PWD-"));
  const raw = student.category?.replace(/^PWD-/, "") ?? "";
  const category = raw === "EWS" ? "Gen-EWS" : raw === "General" ? "Gen" : raw;
  return { category, cwsn: pwd ? "Yes" : "No" };
}

function displayStream(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return ({ engineering: "Engineering", medical: "Medical", ca: "CA", clat: "CLAT", nda: "NDA" } as Record<string, string>)[normalized] ?? value ?? "";
}

function valueOrBlank<T>(value: T | null | undefined): T | "" {
  return value ?? "";
}

function displayDob(value: unknown): Date | "" {
  if (value instanceof Date) return value;
  if (typeof value !== "string" || !value) return "";
  return new Date(`${value.slice(0, 10)}T00:00:00Z`);
}

function displayBoard(value: string | null | undefined) {
  if (value?.includes("CENTRAL BOARD")) return "CBSE";
  return valueOrBlank(value);
}

function rowValues(student: Student) {
  const { category, cwsn } = categoryAndCwsn(student);
  return [
    valueOrBlank(student.grade),
    [student.first_name, student.last_name].filter(Boolean).join(" "),
    displayDob(student.date_of_birth),
    valueOrBlank(student.gender),
    category,
    cwsn,
    valueOrBlank(student.pen_number),
    displayBoard(student.g10_board),
    valueOrBlank(student.g10_roll_no),
    valueOrBlank(student.board_stream),
    displayStream(student.stream),
    valueOrBlank(student.father_name),
    valueOrBlank(student.phone),
    valueOrBlank(student.annual_family_income),
    valueOrBlank(student.apaar_id),
    valueOrBlank(student.student_id),
  ];
}

function addSheet(workbook: ExcelJS.Workbook, name: string, students: Student[]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.addRow(HEADERS);
  students.forEach((student) => sheet.addRow(rowValues(student)));
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  });
  sheet.columns.forEach((column, index) => {
    column.width = index === 1 || index === 11 ? 24 : index === 2 ? 16 : 14;
  });
  sheet.getColumn(3).numFmt = "dd/mm/yyyy";
  sheet.autoFilter = { from: "A1", to: "P1" };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { udise } = await params;
  const [school] = await query<SchoolRow>(
    `SELECT id, code, udise_code, region, af_school_category
     FROM school WHERE udise_code = $1 OR code = $1 LIMIT 1`,
    [udise],
  );
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  const access = await requireStudentAdditionAccess(session, school);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const gradeParam = request.nextUrl.searchParams.get("grade");
  const grade = gradeParam ? Number(gradeParam) : null;
  if (grade != null && grade !== 11 && grade !== 12) {
    return NextResponse.json({ error: "Grade must be 11 or 12" }, { status: 400 });
  }
  const stream = request.nextUrl.searchParams.get("stream")?.trim().toLowerCase() || null;

  const { students } = await getSchoolRoster(school.id);
  const active = students.filter((student) =>
    student.status !== "dropout" &&
    studentHasCurrentProgram(student, PROGRAM_IDS.NVS) &&
    (grade == null || student.grade === grade) &&
    (stream == null || student.stream?.trim().toLowerCase() === stream),
  );
  const dropout = students.filter((student) =>
    studentDroppedFromProgram(student, PROGRAM_IDS.NVS),
  );

  const workbook = new ExcelJS.Workbook();
  addSheet(workbook, "Active", active);
  addSheet(workbook, "Dropout", dropout);
  const data = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="nvs-students-${school.code}.xlsx"`,
    },
  });
}
