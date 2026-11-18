import ExcelJS from "exceljs";
import { NextRequest, NextResponse } from "next/server";

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { loadTestAttendance } from "@/lib/test-attendance";
import { parseTestAttendanceExport, testAttendanceSheet } from "@/lib/test-attendance-export";

// Test Attendance export (#517): the list on screen as one Excel sheet. The
// same gate as the read route, in the same order, before any data read:
// signed in (401), School exists (404), School access + `test_attendance` view
// (403), School is JNV (403 for every role). Not the Download List gate:
// anyone who can see the tab can download, read_only included.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise, { feature: "test_attendance" });
  if (!auth.authorized) return auth.response;
  if (auth.school.af_school_category !== "JNV") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const parsed = parseTestAttendanceExport(request.nextUrl.searchParams);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  let sheet;
  try {
    sheet = testAttendanceSheet(await loadTestAttendance(auth.school.id), parsed.request);
  } catch (error) {
    // Error message only — never Student names or ids.
    console.error("Test Attendance export failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Failed to export Test Attendance" }, { status: 500 });
  }
  if (!sheet) return NextResponse.json({ error: "Monthly Test not found" }, { status: 404 });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheet.name, { views: [{ state: "frozen", ySplit: 1 }] });
  worksheet.addRow(sheet.header);
  sheet.rows.forEach((values) => worksheet.addRow(values));
  worksheet.getRow(1).font = { bold: true };
  worksheet.columns.forEach((column, index) => {
    column.width = index === 0 || index === sheet.header.length - 1 ? 28 : 16;
  });
  const data = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="test-attendance-${auth.school.code}-${sheet.periodSlug}.xlsx"`,
    },
  });
}
