import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

import {
  ANNUAL_FAMILY_INCOME_OPTIONS,
  BOARD_STREAM_OPTIONS,
  CATEGORY_OPTIONS,
  G10_BOARD_OPTIONS,
  GENDER_OPTIONS,
  STREAM_OPTIONS,
  STUDENT_ADDITION_UPLOAD_COLUMNS,
  validateStudentAdditionInput,
  type LmsStudentAdditionRow,
  type StudentAdditionInput,
  type StudentAdditionValidationResult,
} from "./student-addition-fields";

export interface StudentAdditionUploadRowResult {
  row_number: number;
  status: "rejected";
  generated_student_id: string | null;
  normalized: {
    student_name: string;
    g10_roll_no: string;
    student_id: string | null;
  };
  field_errors: Record<string, string>;
  row_errors: string[];
  existing_match: null;
  original: Record<string, string>;
}

export type StudentAdditionUploadParseResult =
  | {
      ok: true;
      rows: LmsStudentAdditionRow[];
      rejectedResults: StudentAdditionUploadRowResult[];
      totalRows: number;
      originalRows: Map<number, Record<string, string>>;
    }
  | { ok: false; error: string };

interface ParseUploadInput {
  filename: string;
  data: Buffer;
  selectedGrade: 11 | 12;
  today?: Date;
  academicYear?: string;
}

function text(value: unknown): string {
  if (value instanceof Date) {
    return [
      value.getFullYear(),
      String(value.getMonth() + 1).padStart(2, "0"),
      String(value.getDate()).padStart(2, "0"),
    ].join("-");
  }
  if (value && typeof value === "object") {
    const candidate = value as {
      text?: unknown;
      result?: unknown;
      richText?: Array<{ text?: unknown }>;
    };
    if (candidate.text != null) return text(candidate.text);
    if (candidate.result != null) return text(candidate.result);
    if (Array.isArray(candidate.richText)) {
      return candidate.richText.map((part) => text(part.text)).join("").trim();
    }
  }
  return value == null ? "" : String(value).trim();
}

function missingColumns(headers: string[]) {
  const headerSet = new Set(headers.map((header) => header.trim()));
  return STUDENT_ADDITION_UPLOAD_COLUMNS
    .map((column) => column.label)
    .filter((label) => !headerSet.has(label));
}

function validationToRejectedResult(
  validation: StudentAdditionValidationResult,
  original: Record<string, string>,
): StudentAdditionUploadRowResult {
  return {
    row_number: validation.row.row_number ?? 1,
    status: "rejected",
    generated_student_id: validation.generatedStudentId,
    normalized: {
      student_name: validation.row.student_name ?? "",
      g10_roll_no: validation.row.g10_roll_no ?? "",
      student_id: validation.generatedStudentId,
    },
    field_errors: validation.fieldErrors,
    row_errors: validation.rowErrors,
    existing_match: null,
    original,
  };
}

function parseRowsFromAoA(
  rows: unknown[][],
  selectedGrade: 11 | 12,
  today?: Date,
  academicYear?: string,
): StudentAdditionUploadParseResult {
  const headers = (rows[0] ?? []).map(text);
  const missing = missingColumns(headers);
  if (missing.length > 0) {
    return { ok: false, error: `Missing required columns: ${missing.join(", ")}` };
  }

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const originalRowNumberIndex = headerIndex.get("Original Row Number");
  const acceptedRows: LmsStudentAdditionRow[] = [];
  const rejectedResults: StudentAdditionUploadRowResult[] = [];
  const originalRows = new Map<number, Record<string, string>>();
  const dataRows = rows.slice(1).map((sourceRow, index) => ({ sourceRow, index }));
  const nonBlankRows = dataRows.filter(({ sourceRow }) =>
    STUDENT_ADDITION_UPLOAD_COLUMNS.some((column) =>
      text(sourceRow[headerIndex.get(column.label) ?? -1]),
    ),
  );

  if (nonBlankRows.length > 200) {
    return {
      ok: false,
      error: `Upload has ${nonBlankRows.length} rows. Upload at most 200 rows at a time.`,
    };
  }

  nonBlankRows.forEach(({ sourceRow, index }) => {
    const original: Record<string, string> = {};
    const input: StudentAdditionInput = {};

    for (const column of STUDENT_ADDITION_UPLOAD_COLUMNS) {
      const value = text(sourceRow[headerIndex.get(column.label) ?? -1]);
      original[column.label] = value;
      input[column.key] = value;
    }

    const parsedOriginalRowNumber =
      originalRowNumberIndex == null ? NaN : Number(text(sourceRow[originalRowNumberIndex]));
    const rowNumber = Number.isInteger(parsedOriginalRowNumber) && parsedOriginalRowNumber > 0
      ? parsedOriginalRowNumber
      : index + 2;

    const validation = validateStudentAdditionInput(input, { today, rowNumber, academicYear });
    originalRows.set(rowNumber, original);

    if (!validation.ok) {
      rejectedResults.push(validationToRejectedResult(validation, original));
      return;
    }

    if (validation.row.grade !== selectedGrade) {
      rejectedResults.push(
        validationToRejectedResult(
          {
            ok: false,
            row: validation.row,
            generatedStudentId: validation.generatedStudentId,
            fieldErrors: {
              grade: `Grade must match the selected upload grade ${selectedGrade}`,
            },
            rowErrors: [],
          },
          original,
        ),
      );
      return;
    }

    acceptedRows.push(validation.row);
  });

  return {
    ok: true,
    rows: acceptedRows,
    rejectedResults,
    totalRows: acceptedRows.length + rejectedResults.length,
    originalRows,
  };
}

function parseCsv(data: Buffer, selectedGrade: 11 | 12, today?: Date, academicYear?: string) {
  let rows: unknown[][];
  try {
    rows = parse(data.toString("utf8"), {
      bom: true,
      relax_column_count: true,
      skip_empty_lines: false,
    }) as unknown[][];
  } catch {
    return { ok: false, error: "Upload a valid .xlsx file or rejected-row .csv file" } as const;
  }
  return parseRowsFromAoA(rows, selectedGrade, today, academicYear);
}

async function parseXlsx(data: Buffer, selectedGrade: 11 | 12, today?: Date, academicYear?: string) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { ok: false, error: "Upload a valid .xlsx file or rejected-row .csv file" } as const;
  }
  const sheet = workbook.getWorksheet("Template") ?? workbook.worksheets[0];
  if (!sheet) return { ok: false, error: "Workbook has no sheets" } as const;

  const rows: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: unknown[] = [];
    for (let columnNumber = 1; columnNumber <= sheet.columnCount; columnNumber += 1) {
      values.push(row.getCell(columnNumber).value ?? "");
    }
    rows.push(values);
  }
  return parseRowsFromAoA(rows, selectedGrade, today, academicYear);
}

export async function parseStudentAdditionUpload({
  filename,
  data,
  selectedGrade,
  today,
  academicYear,
}: ParseUploadInput): Promise<StudentAdditionUploadParseResult> {
  if (filename.toLowerCase().endsWith(".xls")) {
    return {
      ok: false,
      error: "Save the file as .xlsx and upload again. Legacy .xls files are not supported.",
    };
  }

  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(data, selectedGrade, today, academicYear);
  }

  if (filename.toLowerCase().endsWith(".xlsx")) {
    return parseXlsx(data, selectedGrade, today, academicYear);
  }

  return { ok: true, rows: [], rejectedResults: [], totalRows: 0, originalRows: new Map() };
}

export async function buildStudentAdditionTemplateWorkbook(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const template = workbook.addWorksheet("Template");
  template.addRow(STUDENT_ADDITION_UPLOAD_COLUMNS.map((column) => column.label));
  template.getColumn(3).numFmt = "dd/mm/yyyy";
  template.getColumn(7).numFmt = "@";
  template.getColumn(9).numFmt = "@";

  const options = workbook.addWorksheet("Options");
  options.addRows([
    ["Field", "Allowed values"],
    ["Gender", GENDER_OPTIONS.join(" | ")],
    ["Category", CATEGORY_OPTIONS.join(" | ")],
    ["Physical Handicapped / Vikalang", "Yes | No"],
    ["G10 board", G10_BOARD_OPTIONS.join(" | ")],
    ["Board Stream", BOARD_STREAM_OPTIONS.join(" | ")],
    ["Primary Exam preparing for", STREAM_OPTIONS.join(" | ")],
    ["Yearly / Annual Family Income", ANNUAL_FAMILY_INCOME_OPTIONS.join(" | ")],
  ]);

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
