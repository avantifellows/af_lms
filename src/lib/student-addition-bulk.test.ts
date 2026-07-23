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
  "CWSN",
  "PEN Number",
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
  "12345678901",
  CBSE_BOARD,
  "12345678",
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
  it("replaces periods in uploaded student names with spaces", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [uploadHeaders, validRowValues] }),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.rows[0].student_name).toBe("Asha K Kumar");
  });

  it("rejects legacy xls uploads with a save-as-xlsx message", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xls",
      data: Buffer.from("legacy excel"),
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

  it("ignores moved example rows by any exact marker before validation and totals", async () => {
    const nameMarker = [...validRowValues];
    nameMarker[1] = " Example Student ";
    nameMarker[2] = "not a date";
    nameMarker[6] = "not a PEN";
    const multipleMarkers = [...validRowValues];
    multipleMarkers[1] = "Another Student";
    multipleMarkers[6] = " 12345678910 ";
    multipleMarkers[8] = "11111111";
    multipleMarkers[12] = "9999999999";

    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({
        Template: [uploadHeaders, nameMarker, validRowValues, multipleMarkers],
      }),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.totalRows).toBe(1);
    expect(result.rows).toEqual([
      expect.objectContaining({ row_number: 3, pen_number: "12345678901" }),
    ]);
    expect(result.rejectedResults).toEqual([]);
    expect(result.ignoredRows).toEqual([
      {
        row_number: 2,
        matched_fields: ["Student Name"],
        message: "Row 2 was ignored as the example row. Matched: Student Name.",
      },
      {
        row_number: 4,
        matched_fields: ["PEN", "Grade 10 Roll No", "Phone"],
        message: "Row 4 was ignored as the example row. Matched: PEN, Grade 10 Roll No, Phone.",
      },
    ]);
  });

  it("ignores example markers in retry CSV uploads", async () => {
    const penMarker = [...validRowValues];
    penMarker[1] = "Moved Example";
    penMarker[6] = "12345678910";

    const result = await parseStudentAdditionUpload({
      filename: "student-addition-rejected-rows.csv",
      data: Buffer.from([
        csvHeaders,
        csvLine(penMarker),
        validCsvRow,
      ].join("\n")),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.totalRows).toBe(1);
    expect(result.rows[0]).toEqual(expect.objectContaining({ row_number: 3 }));
    expect(result.ignoredRows).toEqual([
      expect.objectContaining({ row_number: 2, matched_fields: ["PEN"] }),
    ]);
  });

  it("keeps a leading-zero PEN as text from xlsx parsing", async () => {
    const row = [...validRowValues];
    row[6] = "01234567890";

    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [uploadHeaders, row] }),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.rows[0].pen_number).toBe("01234567890");
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

  it("accepts mixed Grade 11 and 12 rows from the current PEN workbook", async () => {
    const headers = [
      "Grade", "Student Name", "Date of Birth", "Gender", "Category", "CWSN",
      "PEN Number", "G10 board", "Grade 10 Roll no", "Board Stream",
      "Primary Exam preparing for", "Father Name", "Parents Phone Number",
      "Yearly / Annual Family Income",
    ];
    const row = [
      "11", "Asha Kumar", "02/01/2010", "Female", "Gen", "No",
      "12345678901", "CBSE", "12345678", "PCM", "Engineering", "Ravi Kumar",
      "9876543210", "Less than Rs. 1,00,000",
    ];

    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({
        "Do Not Use": [["Grade"], ["12"]],
        Template: [headers, row, ["12", ...row.slice(1, 6), "12345678902", ...row.slice(7, 10), "NDA", ...row.slice(11)]],
      }),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.rejectedResults).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({ grade: 11, pen_number: "12345678901", stream: "engineering" }),
      expect.objectContaining({ grade: 12, pen_number: "12345678902", stream: "nda" }),
    ]);
  });

  it("rejects old APAAR-based workbooks with latest-template guidance", async () => {
    const oldHeaders = [...uploadHeaders];
    oldHeaders[5] = "Physical Handicapped / Vikalang";
    oldHeaders[6] = "APAAR ID";
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [oldHeaders, validRowValues] }),
    });

    expect(result).toEqual({
      ok: false,
      error: "This workbook uses the old APAAR template. Download the latest PEN-based template and upload it again.",
    });
  });

  it("requires the Template sheet instead of parsing helper sheets", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Students: [uploadHeaders, validRowValues] }),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result).toEqual({
      ok: false,
      error: "Workbook must include a Template sheet. Download the latest template and upload it again.",
    });
  });

  it("lists missing columns with latest-template guidance", async () => {
    const headers = uploadHeaders.filter((header) =>
      !["Gender", "Parents Phone Number"].includes(header)
    );
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [headers] }),
    });

    expect(result).toEqual({
      ok: false,
      error:
        "Missing required columns: Gender, Parents Phone Number. Download the latest template and upload it again",
    });
  });

  it("parses real xlsx date cells without rejecting valid DOB values", async () => {
    const row = [...validRowValues];
    row[2] = new Date(2010, 0, 2);

    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [uploadHeaders, row] }),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid upload");
    expect(result.rows[0].date_of_birth).toBe("2010-01-02");
  });

  it.each(["2.1.2010", "02.01.2010", "2/1/10", "02-01-10", "2.1.10"])(
    "accepts bulk DOB format %s",
    async (dateOfBirth) => {
      const row = [...validRowValues];
      row[2] = dateOfBirth;
      const result = await parseStudentAdditionUpload({
        filename: "students.xlsx",
        data: await workbookBuffer({ Template: [uploadHeaders, row] }),
        today: new Date("2026-07-01T00:00:00Z"),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected valid upload");
      expect(result.rows[0].date_of_birth).toBe("2010-01-02");
    },
  );

  it("rejects leading-zero phone and CBSE roll numbers in bulk uploads", async () => {
    const row = [...validRowValues];
    row[8] = "02345678";
    row[12] = "0876543210";
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [uploadHeaders, row] }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parsed upload");
    expect(result.rejectedResults[0].field_errors.g10_roll_no).toContain("cannot start with zero");
    expect(result.rejectedResults[0].field_errors.phone).toBe("Enter a valid phone number");
  });

  it("returns a validation error for corrupt xlsx uploads", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: Buffer.from("not a workbook"),
    });

    expect(result).toEqual({
      ok: false,
      error: "Upload a valid .xlsx file or rejected-row .csv file",
    });
  });

  it("returns a validation error for malformed csv uploads", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "rejected-rows.csv",
      data: Buffer.from(`${csvHeaders}\n"unterminated`),
    });

    expect(result).toEqual({
      ok: false,
      error: "Upload a valid .xlsx file or rejected-row .csv file",
    });
  });

  it("allows exactly 200 non-blank rows and rejects 201", async () => {
    const twoHundredRows = Array.from({ length: 200 }, () => validCsvRow).join("\n");
    const exampleRow = [...validRowValues];
    exampleRow[1] = "Example Student";
    const allowed = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${csvLine(exampleRow)}\n${twoHundredRows}`),
    });

    expect(allowed.ok).toBe(true);
    if (!allowed.ok) throw new Error("expected valid upload");
    expect(allowed.totalRows).toBe(200);
    expect(allowed.ignoredRows).toEqual([
      expect.objectContaining({ row_number: 2, matched_fields: ["Student Name"] }),
    ]);

    const tooMany = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${twoHundredRows}\n${validCsvRow}`),
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
        field_errors: { grade: "Grade must be 11 or 12" },
        row_errors: ["PEN or Grade 10 Roll no is required"],
        existing_match: {
          student_id: "202812345678",
          pen_number: "12345678901",
          apaar_id: "123456789012",
          school_code: "JNV001",
        },
      },
      {
        row_number: 4,
        status: "already_exists",
        original: { "Student Name": "Already Present Row" },
        existing_match: {
          student_id: "202812345679",
          student_name: "Existing Student",
          school_name: "JNV Other",
          school_code: "JNV999",
        },
      },
      {
        row_number: 5,
        status: "duplicate_in_file",
        original: { "Student Name": "Duplicate Student" },
        duplicate_identifiers: ["PEN Number", "Grade 10 Roll no"],
      },
    ], "JNV001");

    expect(csv).toContain("Original Row Number,Row Status");
    expect(csv).toContain("Bad Student");
    expect(csv).toContain("Grade: Grade must be 11 or 12");
    expect(csv).toContain("PEN or Grade 10 Roll no is required");
    expect(csv).toContain("202812345678");
    expect(csv).toContain("Existing PEN Number,Existing APAAR ID");
    expect(csv).toContain("12345678901,123456789012");
    expect(csv).not.toContain("Created Student");
    expect(csv).toContain("Already Present Row");
    expect(csv).toContain("Duplicate Student");
    expect(csv).toContain("Existing School Relationship");
    expect(csv).toContain("Different school");
    expect(csv).toContain("This identifier already belongs to Existing Student at JNV Other (JNV999)");
    expect(csv).toContain("Duplicate in uploaded file: PEN Number, Grade 10 Roll no");
  });

  it("round-trips a PEN-based rejected CSV with its original row number", async () => {
    const original = Object.fromEntries(uploadHeaders.map((header, index) => [header, validRowValues[index]]));
    const csv = buildRejectedRowsCsv([{
      row_number: 47,
      status: "rejected",
      original,
      row_errors: ["Temporary upstream rejection"],
    }]);

    const result = await parseStudentAdditionUpload({
      filename: "student-addition-rejected-rows.csv",
      data: Buffer.from(csv),
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected retryable csv");
    expect(result.rows).toEqual([
      expect.objectContaining({ row_number: 47, pen_number: "12345678901" }),
    ]);
  });

  it("neutralizes formula-like values in rejected-row csv cells", () => {
    const csv = buildRejectedRowsCsv([
      {
        row_number: 2,
        status: "rejected",
        original: { "Student Name": "=cmd", Grade: "+11" },
      },
    ]);

    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'+11");
  });

  it("returns all local row errors and keeps 200-row validation lightweight", async () => {
    const badRows = [
      csvLine([...validRowValues.slice(0, 10), "Not A Stream", ...validRowValues.slice(11)]),
      csvLine(["10", ...validRowValues.slice(1)]),
      csvLine([...validRowValues.slice(0, 2), "2099-01-01", ...validRowValues.slice(3)]),
    ].join("\n");

    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${badRows}`),
      today: new Date("2026-07-01T00:00:00Z"),
      academicYear: "2027-2028",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parsed upload");
    expect(result.rows).toEqual([]);
    expect(result.rejectedResults.map((row) => row.field_errors)).toEqual([
      { stream: "Primary Exam preparing for is not valid" },
      { grade: "Grade must be 11 or 12" },
      { date_of_birth: "Date of Birth must be between 2000 and 2015" },
    ]);
    expect(result.rejectedResults[0].generated_student_id).toBe("202912345678");

    const rows = Array.from({ length: 200 }, () => validCsvRow).join("\n");
    const start = performance.now();
    const perfResult = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvHeaders}\n${rows}`),
    });
    expect(perfResult.ok).toBe(true);
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
