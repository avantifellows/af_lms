import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";

import { parseStudentAdditionUpload as parseStudentAdditionUploadForMode } from "./student-addition-bulk";
import {
  buildRejectedRowsCsv as buildRejectedRowsCsvForMode,
  CBSE_BOARD,
  type StudentAdditionCsvResult,
} from "./student-addition-fields";
import { APPROVED_REGISTRATION_MODE, PHONE_REGISTRATION_MODE } from "./registration-mode";

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

const phoneUploadHeaders = [
  "Grade",
  "Student Name",
  "Date of Birth",
  "Gender",
  "Category",
  "CWSN",
  "G10 board",
  "Board Stream",
  "Primary Exam preparing for",
  "Father Name",
  "Parents Phone Number",
];

function variantHeaders(headers: readonly string[]) {
  return headers.map((header, index) =>
    index % 2 === 0 ? ` ${header.toLowerCase()} ` : ` ${header.toUpperCase()} `,
  );
}

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

const validPhoneRowValues: unknown[] = [
  "12",
  "asha kumar",
  "02/01/2010",
  "Female",
  "Gen",
  "No",
  "Others",
  "PCM",
  "Engineering",
  "ravi kumar",
  "6876543210",
];

const csvHeaders = csvLine(uploadHeaders);
const validCsvRow = csvLine(validRowValues);

async function parseStudentAdditionUpload(
  options: Parameters<typeof parseStudentAdditionUploadForMode>[0],
) {
  return parseStudentAdditionUploadForMode({
    ...options,
    mode: options.mode ?? APPROVED_REGISTRATION_MODE,
  });
}

function buildRejectedRowsCsv(
  results: StudentAdditionCsvResult[],
  schoolCode?: string,
  mode: Parameters<typeof buildRejectedRowsCsvForMode>[2] = APPROVED_REGISTRATION_MODE,
) {
  return buildRejectedRowsCsvForMode(results, schoolCode, mode);
}

async function workbookBuffer(sheets: Record<string, unknown[][]>) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    workbook.addWorksheet(name).addRows(rows);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("parseStudentAdditionUpload", () => {
  it("rejects a full-mode workbook before processing it in Phone Registration Mode", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [uploadHeaders, validRowValues] }),
      mode: PHONE_REGISTRATION_MODE,
    });

    expect(result).toEqual({
      ok: false,
      error:
        "This upload does not match the active Phone Registration Mode template. Download the current template and upload it again.",
      templateMismatch: {
        missing: [],
        unexpected: ["PEN Number", "Grade 10 Roll no", "Yearly / Annual Family Income"],
        duplicate: [],
      },
    });
  });

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

  it("parses the exact 11-column Phone Registration Mode schema", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({ Template: [phoneUploadHeaders, validPhoneRowValues] }),
      mode: PHONE_REGISTRATION_MODE,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid Phone-mode upload");
    expect(result.rejectedResults).toEqual([]);
    expect(result.rows).toEqual([
      expect.objectContaining({
        row_number: 2,
        grade: 12,
        student_name: "Asha Kumar",
        phone: "6876543210",
        student_id: "6876543210",
      }),
    ]);
    expect(result.originalRows.get(2)).toEqual(
      Object.fromEntries(phoneUploadHeaders.map((header, index) => [header, String(validPhoneRowValues[index])])),
    );
  });

  it.each([
    {
      mode: APPROVED_REGISTRATION_MODE,
      headers: uploadHeaders,
      values: validRowValues,
      expected: { student_name: "Asha K Kumar", pen_number: "12345678901", phone: "9876543210" },
    },
    {
      mode: PHONE_REGISTRATION_MODE,
      headers: phoneUploadHeaders,
      values: validPhoneRowValues,
      expected: { student_name: "Asha Kumar", phone: "6876543210", student_id: "6876543210" },
    },
  ])("matches trimmed, case-insensitive headers and maps row values in $mode", async ({ mode, headers, values, expected }) => {
    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvLine(variantHeaders(headers))}\n${csvLine(values)}`),
      mode,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected normalized-header upload");
    expect(result.rows).toEqual([expect.objectContaining({ row_number: 2, ...expected })]);
    expect(result.originalRows.get(2)).toEqual(
      Object.fromEntries(headers.map((header, index) => [header, String(values[index]).trim()])),
    );
  });

  it.each([
    { mode: APPROVED_REGISTRATION_MODE, headers: uploadHeaders, values: validRowValues },
    { mode: PHONE_REGISTRATION_MODE, headers: phoneUploadHeaders, values: validPhoneRowValues },
  ])("matches case-insensitive retry metadata headers in $mode", async ({ mode, headers, values }) => {
    const original = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    const rejectedCsv = buildRejectedRowsCsv([
      { row_number: 47, status: "rejected", original, row_errors: ["Retry this row"] },
    ], "JNV001", mode);
    const [canonicalHeaders, row] = rejectedCsv.split("\n");
    const normalizedMetadataHeaders = canonicalHeaders
      .split(",")
      .map((header, index) => index < 2 || index >= 2 + headers.length
        ? ` ${header.toLowerCase()} `
        : header)
      .join(",");

    const result = await parseStudentAdditionUpload({
      filename: "student-addition-rejected-rows.csv",
      data: Buffer.from(`${normalizedMetadataHeaders}\n${row}`),
      mode,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected normalized retry metadata");
    expect(result.rows).toEqual([expect.objectContaining({ row_number: 47 })]);
  });

  it("detects the legacy APAAR template regardless of header case or outer spaces", async () => {
    const oldHeaders = [...uploadHeaders];
    oldHeaders[5] = " physical handicapped / vikalang ";
    oldHeaders[6] = "  apaar id  ";

    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvLine(oldHeaders)}\n${validCsvRow}`),
    });

    expect(result).toEqual({
      ok: false,
      error: "This workbook uses the old APAAR template. Download the latest PEN-based template and upload it again.",
      templateMismatch: {
        missing: ["CWSN", "PEN Number"],
        unexpected: [],
        duplicate: [],
        legacy_apaar: true,
      },
    });
  });

  it("reports a missing PEN column instead of the legacy APAAR template when APAAR is absent", async () => {
    const headers = uploadHeaders.filter((header) => header !== "PEN Number");
    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from(`${csvLine(headers)}\n${csvLine(validRowValues.slice(0, 6).concat(validRowValues.slice(7)))}`),
    });

    expect(result).toEqual({
      ok: false,
      error: "Missing required columns: PEN Number. Download the latest template and upload it again",
      templateMismatch: {
        missing: ["PEN Number"],
        unexpected: [],
        duplicate: [],
      },
    });
  });

  it.each([
    {
      mode: APPROVED_REGISTRATION_MODE,
      headers: uploadHeaders,
      values: validRowValues,
      duplicateHeader: "  pen number  ",
      duplicateValue: "12345678902",
      error: "Duplicate columns: PEN Number. Download the latest template and upload it again",
    },
    {
      mode: PHONE_REGISTRATION_MODE,
      headers: phoneUploadHeaders,
      values: validPhoneRowValues,
      duplicateHeader: "  grade  ",
      duplicateValue: "11",
      error: "This upload does not match the active Phone Registration Mode template. Download the current template and upload it again.",
    },
  ])("rejects $mode headers that normalize to duplicate columns", async ({ mode, headers, values, duplicateHeader, duplicateValue, error }) => {
    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from([
        csvLine([...headers, duplicateHeader]),
        csvLine([...values, duplicateValue]),
      ].join("\n")),
      mode,
    });

    expect(result).toEqual({
      ok: false,
      error,
      templateMismatch: {
        missing: [],
        unexpected: [],
        duplicate: [mode === APPROVED_REGISTRATION_MODE ? "PEN Number" : "Grade"],
      },
    });
  });

  it("rejects unknown Phone-mode columns instead of silently dropping them", async () => {
    const result = await parseStudentAdditionUpload({
      filename: "students.csv",
      data: Buffer.from([
        csvLine([...phoneUploadHeaders, "  unapproved extra column  "]),
        csvLine([...validPhoneRowValues, "restricted value"]),
      ].join("\n")),
      mode: PHONE_REGISTRATION_MODE,
    });

    expect(result).toEqual({
      ok: false,
      error:
        "This upload does not match the active Phone Registration Mode template. Download the current template and upload it again.",
      templateMismatch: {
        missing: [],
        unexpected: ["unapproved extra column"],
        duplicate: [],
      },
    });
  });

  it("parses the checked-in HQ Phone workbook with x14 validations after compaction", async () => {
    const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as {
      load: (...args: unknown[]) => unknown;
    };
    const loadSpy = vi.spyOn(xlsxPrototype, "load");

    try {
      const result = await parseStudentAdditionUpload({
        filename: "NVS_Lakshya_Data_Template_updated_19th_August_2026.xlsx",
        data: await readFile("src/assets/NVS_Lakshya_Data_Template_updated_19th_August_2026.xlsx"),
        mode: PHONE_REGISTRATION_MODE,
        today: new Date("2026-08-21T00:00:00Z"),
      });

      expect(result).toEqual(expect.objectContaining({
        ok: true,
        totalRows: 0,
        ignoredRows: [expect.objectContaining({
          row_number: 2,
          matched_fields: ["Student Name"],
        })],
      }));
      const loadedArchive = await JSZip.loadAsync(
        Buffer.from(loadSpy.mock.calls[0][0] as Buffer),
      );
      const templateXml = await loadedArchive.file("xl/worksheets/sheet1.xml")!.async("string");
      expect(templateXml).toContain('<x14:dataValidations count="7"');
    } finally {
      loadSpy.mockRestore();
    }
  });

  it("removes blank formatted cells before loading xlsx", async () => {
    const sourceWorkbook = new ExcelJS.Workbook();
    const sourceSheet = sourceWorkbook.addWorksheet("Template");
    sourceSheet.addRow(uploadHeaders);
    validRowValues.forEach((value, index) => {
      sourceSheet.getCell(47, index + 1).value = value as ExcelJS.CellValue;
    });
    for (let rowNumber = 2; rowNumber <= 1_000; rowNumber += 1) {
      sourceSheet.getCell(rowNumber, 26).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFFFF" },
      };
    }
    const data = Buffer.from(await sourceWorkbook.xlsx.writeBuffer());
    const xlsxPrototype = Object.getPrototypeOf(new ExcelJS.Workbook().xlsx) as {
      load: (...args: unknown[]) => unknown;
    };
    const loadSpy = vi.spyOn(xlsxPrototype, "load");

    try {
      const result = await parseStudentAdditionUpload({
        filename: "students.xlsx",
        data,
        today: new Date("2026-07-01T00:00:00Z"),
      });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected valid upload");
      expect(result.rows[0].row_number).toBe(47);
      expect(loadSpy).toHaveBeenCalledOnce();
      const loadedArchive = await JSZip.loadAsync(
        Buffer.from(loadSpy.mock.calls[0][0] as Buffer),
      );
      const templateXml = await loadedArchive
        .file("xl/worksheets/sheet1.xml")!
        .async("string");
      expect(templateXml).not.toContain('r="Z1000"');
    } finally {
      loadSpy.mockRestore();
    }
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

  it("rejects a real Phone-mode row that reuses the example phone", async () => {
    const reusedExamplePhone = [...validPhoneRowValues];
    reusedExamplePhone[1] = "Real Student";
    reusedExamplePhone[10] = "9999999999";

    const result = await parseStudentAdditionUpload({
      filename: "students.xlsx",
      data: await workbookBuffer({
        Template: [
          phoneUploadHeaders,
          [
            "11", "Example Student", "13/02/2011", "Female", "OBC", "Yes",
            "CBSE", "PCMB", "Engineering", "Father ABC", "9999999999",
          ],
          reusedExamplePhone,
          validPhoneRowValues,
        ],
      }),
      mode: PHONE_REGISTRATION_MODE,
      today: new Date("2026-08-24T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid Phone-mode upload");
    expect(result.totalRows).toBe(2);
    expect(result.ignoredRows).toEqual([
      expect.objectContaining({ row_number: 2, matched_fields: ["Student Name"] }),
    ]);
    expect(result.rows).toEqual([
      expect.objectContaining({ row_number: 4, phone: "6876543210" }),
    ]);
    expect(result.rejectedResults).toEqual([
      expect.objectContaining({
        row_number: 3,
        status: "rejected",
        field_errors: {
          phone:
            "Phone number matches the example row. Please replace it with the student's actual phone number",
        },
        original: expect.objectContaining({
          "Student Name": "Real Student",
          "Parents Phone Number": "9999999999",
        }),
      }),
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
      templateMismatch: {
        missing: ["CWSN", "PEN Number"],
        unexpected: [],
        duplicate: [],
        legacy_apaar: true,
      },
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
      templateMismatch: {
        missing: ["Gender", "Parents Phone Number"],
        unexpected: [],
        duplicate: [],
      },
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

  it("keeps Approved-mode rejected existing-match presentation unchanged", () => {
    const csv = buildRejectedRowsCsv([{
      row_number: 2,
      status: "rejected",
      original: { "Student Name": "Conflict" },
      existing_match: { student_id: "202812345678", school_code: "JNV001" },
    }], "JNV001");

    expect(csv).not.toContain("This student identifier is already part of this school");
    expect(csv).not.toContain(",Same school,");
  });

  it("builds Phone-mode rejected rows with only the canonical phone columns", () => {
    const csv = buildRejectedRowsCsv([
      {
        row_number: 2,
        status: "rejected",
        original: Object.fromEntries(phoneUploadHeaders.map((header) => [header, "value"])),
        field_errors: {
          phone: "Enter a valid phone number",
          pen_number: "01234567890",
          g10_roll_no: "12345678",
          annual_family_income: "secret income",
        },
        existing_match: {
          student_id: "9999999999",
          school_code: "JNV001",
          pen_number: "01234567890",
          apaar_id: "legacy-id",
        },
      },
    ], "JNV001", PHONE_REGISTRATION_MODE);

    expect(csv.split("\n", 1)[0]).toBe([
      "Original Row Number",
      "Row Status",
      ...phoneUploadHeaders,
      "Field Errors",
      "Row Errors",
      "Issue",
      "Existing School Relationship",
      "Matched Identifier",
      "Existing Student ID",
      "Existing Student Name",
      "Existing School Name",
      "Existing School Code",
      "Existing UDISE",
      "Existing District",
      "Existing State",
      "Existing Grade",
      "Existing Program",
      "Existing Stream",
    ].join(","));
    expect(csv).not.toContain(",PEN Number,");
    expect(csv).not.toContain(",Grade 10 Roll no,");
    expect(csv).not.toContain(",Yearly / Annual Family Income,");
    expect(csv).not.toContain("PEN");
    expect(csv).not.toContain("01234567890");
    expect(csv).not.toContain("legacy-id");
    expect(csv).toContain("This student identifier is already part of this school.");
  });

  it("uses the original phone in Phone-mode rejected CSV match messages", () => {
    const csv = buildRejectedRowsCsv([{
      row_number: 6,
      status: "already_exists",
      original: {
        "Student Name": "Existing Student",
        "Parents Phone Number": "6876543210",
      },
      existing_match: { school_code: "JNV001" },
    }], "JNV001", PHONE_REGISTRATION_MODE);

    expect(csv).toContain("Student ID / Phone Number: 6876543210");
    expect(csv).not.toContain("Student ID / Phone Number: blank");
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

  it("round-trips a Phone-mode rejected CSV with its original row number", async () => {
    const original = Object.fromEntries(
      phoneUploadHeaders.map((header, index) => [header, validPhoneRowValues[index]]),
    );
    const csv = buildRejectedRowsCsv([{
      row_number: 47,
      status: "rejected",
      original,
      row_errors: ["Temporary upstream rejection"],
    }], "JNV001", PHONE_REGISTRATION_MODE);

    const result = await parseStudentAdditionUpload({
      filename: "student-addition-rejected-rows.csv",
      data: Buffer.from(csv),
      mode: PHONE_REGISTRATION_MODE,
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected retryable Phone-mode csv");
    expect(result.rows).toEqual([
      expect.objectContaining({ row_number: 47, phone: "6876543210", student_id: "6876543210" }),
    ]);
    expect(result.originalRows.get(47)).toEqual(
      Object.fromEntries(phoneUploadHeaders.map((header, index) => [header, String(validPhoneRowValues[index])])),
    );
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
