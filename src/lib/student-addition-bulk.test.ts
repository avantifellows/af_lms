import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { parseStudentAdditionUpload } from "./student-addition-bulk";
import { buildRejectedRowsCsv, CBSE_BOARD } from "./student-addition-fields";

function csvLine(values: unknown[]) {
  return values.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
}

const uploadHeaders = [
  "Grade",
  "Student Name",
  "Date of Birth",
  "Gender",
  "Category",
  "Physical Handicapped / Vikalang",
  "APAAR ID",
  "G10 board",
  "Grade 10 Roll no",
  "Board Stream",
  "Primary Exam preparing for",
  "Father Name",
  "Parents Phone Number",
  "Yearly / Annual Family Income",
];

const validRowValues: unknown[] = [
  "11",
  " asha  k. kumar ",
  "02/01/2010",
  "Female",
  "Gen",
  "No",
  "123456789012",
  CBSE_BOARD,
  "1234 5678",
  "PCM",
  "Engineering",
  "ravi kumar",
  "9876543210",
  "Less than Rs. 1,00,000",
];

const csvHeaders = csvLine(uploadHeaders);
const validCsvRow = csvLine(validRowValues);

async function workbookBuffer(sheets: Record<string, unknown[][]>) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.addWorksheet(name).addRows(rows);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseStudentAdditionUpload", () => {
  it("rejects legacy xls uploads with a save-as-xlsx message", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xls",
      data: Buffer.from("legacy excel"),
      selectedGrade: 11,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: "Save the file as .xlsx and upload again. Legacy .xls files are not supported.",
    });
  });

  it("parses csv retry rows through canonical validation and normalization", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "rejected-rows.csv",
      data: Buffer.from(`${csvHeaders}\n${validCsvRow}`),
      selectedGrade: 11,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.totalRows).toBe(1);
    expect(result.rejectedResults).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        row_number: 2,
        grade: 11,
        student_name: "Asha K Kumar",
        g10_roll_no: "12345678",
        stream: "engineering",
      }),
    ]);
  });

  it("parses the Template xlsx sheet, ignoring extra columns and blank rows", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({
        "Do Not Use": [
          uploadHeaders,
          ["12", "Wrong Sheet"],
        ],
        Template: [
          [...uploadHeaders, "Ignored Extra"],
          [...validRowValues, "ignored"],
          new Array(15).fill(""),
        ],
      }),
      selectedGrade: 11,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.totalRows).toBe(1);
    expect(result.rows).toEqual([
      expect.objectContaining({
        row_number: 2,
        student_name: "Asha K Kumar",
        g10_roll_no: "12345678",
      }),
    ]);
  });

  it("uses the first xlsx sheet when Template is absent and rejects missing columns", async () => {
    const firstSheet = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Students: [uploadHeaders, validRowValues] }),
      selectedGrade: 11,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(firstSheet.ok).toBe(true);
    if (!firstSheet.ok) throw new Error("expected valid upload");
    expect(firstSheet.rows).toHaveLength(1);

    const missingColumn = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Students: [uploadHeaders.filter((header) => header !== "Student Name"), validRowValues] }),
      selectedGrade: 11,
    });

    expect(missingColumn).toEqual({
      ok: false,
      error: "Missing required columns: Student Name",
    });
  });

  it("parses real xlsx date cells without rejecting valid DOB values", async () => {
    const row = [...validRowValues];
    row[2] = new Date(2010, 0, 2);

    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [uploadHeaders, row] }),
      selectedGrade: 11,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.rows[0].date_of_birth).toBe("2010-01-02");
  });

  it("allows exactly 200 non-blank rows and rejects 201", async () => {
    const twoHundredRows = Array.from({ length: 200 }, () => validCsvRow).join("\n");
    const allowed = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${twoHundredRows}`),
      selectedGrade: 11,
    });

    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error("expected valid upload");
    expect(allowed.totalRows).toBe(200);

    const tooMany = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${twoHundredRows}\n${validCsvRow}`),
      selectedGrade: 11,
    });

    expect(tooMany).toEqual({
      ok: false,
      error: "Upload has 201 rows. Upload at most 200 rows at a time.",
    });
  });

  it("builds a rejected-row csv with original fields, errors, and existing-match details", () => {
    const csv = buildRejectedRowsCsv([
      {
        row_number: 2,
        status: "created",
        original: { "Student Name": "Created Student" },
      },
      {
        row_number: 3,
        status: "rejected",
        original: { "Student Name": "Bad Student", Grade: "12" },
        field_errors: { grade: "Grade must match the selected upload grade 11" },
        row_errors: ["APAAR ID or Grade 10 Roll no is required"],
        existing_match: { student_id: "202812345678", school_code: "JNV001" },
      },
      {
        row_number: 4,
        status: "already_exists",
        original: { "Student Name": "Already Present Row" },
      },
      {
        row_number: 5,
        status: "duplicate_in_file",
        original: { "Student Name": "Duplicate Student" },
      },
    ]);

    expect(csv).toContain("Original Row Number,Row Status");
    expect(csv).toContain("Bad Student");
    expect(csv).toContain("Grade: Grade must match the selected upload grade 11");
    expect(csv).toContain("APAAR ID or Grade 10 Roll no is required");
    expect(csv).toContain("202812345678");
    expect(csv).not.toContain("Created Student");
    expect(csv).not.toContain("Already Present Row");
    expect(csv).not.toContain("Duplicate Student");
  });

  it("returns all local row errors and keeps 200-row validation lightweight", async () => {
    const badRows = [
      csvLine([...validRowValues.slice(0, 10), "Not A Stream", ...validRowValues.slice(11)]),
      csvLine(["12", ...validRowValues.slice(1)]),
      csvLine([...validRowValues.slice(0, 2), "2099-01-01", ...validRowValues.slice(3)]),
    ].join("\n");

    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${badRows}`),
      selectedGrade: 11,
      today: new Date("2026-07-01T00:00:00Z"),
      academicYear: "2027-2028",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parsed upload");
    expect(result.rows).toEqual([]);
    expect(result.rejectedResults.map((row) => row.field_errors)).toEqual([
      { stream: "Primary Exam preparing for is not valid" },
      { grade: "Grade must match the selected upload grade 11" },
      { date_of_birth: "Date of Birth cannot be in the future" },
    ]);
    expect(result.rejectedResults[0].generated_student_id).toBe("202912345678");

    const rows = Array.from({ length: 200 }, () => validCsvRow).join("\n");
    const start = performance.now();
    const perfResult = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${rows}`),
      selectedGrade: 11,
    });
    expect(perfResult.ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
