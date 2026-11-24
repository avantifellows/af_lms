import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { TABLE_FIELDS, filterTable, loadAlumniTable, type AlumniTableRow } from "@/lib/alumni/table";
import { readTableRequest } from "@/lib/alumni/table-request";

// The "missing data" table as an Excel file: every row matching the same
// filters as the table (not just one page), with phone numbers for calling.
// AFIDs and phones are written as text, so Excel keeps their leading zeros and
// never shows them in scientific notation.

const HEADERS = [
  "Name", "AFID", "Phone", "WhatsApp", "School", "School code", "Pass-out year", "Program", "Record",
  ...TABLE_FIELDS.map((f) => f.label), "Filled %", "Last updated",
];
const TEXT_COLUMNS = [2, 3, 4, 6]; // AFID, Phone, WhatsApp, School code (1-based)

function rowValues(r: AlumniTableRow) {
  return [
    r.name, r.afid, r.phone, r.whatsapp, r.schoolName || "No school on record", r.schoolCode, r.cohortYear, r.program,
    r.kind === "alumnus" ? "Added" : "Not added",
    ...TABLE_FIELDS.map((f) => r.values[f.key] || (r.missing.includes(f.key) ? "" : "n/a")), r.filledPct, r.updatedAt,
  ];
}

export async function GET(request: Request) {
  const { school, filters } = readTableRequest(request.url);
  const auth = await authorizeAlumni(school ? { schoolCode: school } : {});
  if (!auth.ok) return auth.response;

  try {
    const rows = filterTable(await loadAlumniTable(auth.permission, school), filters);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Alumni", { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.addRow(HEADERS);
    for (const id of TEXT_COLUMNS) sheet.getColumn(id).numFmt = "@";
    rows.forEach((r) => sheet.addRow(rowValues(r)));
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
    });
    sheet.columns.forEach((column, i) => {
      column.width = i === 0 || i === 4 ? 26 : 16;
    });
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEADERS.length } };
    const data = await workbook.xlsx.writeBuffer();
    const name = `alumni-${school ?? "all-schools"}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]/g, "_")}"`,
      },
    });
  } catch (error) {
    console.error("[alumni/table/export]", error);
    return NextResponse.json({ error: "Couldn't build the download." }, { status: 500 });
  }
}
