import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import JSZip from "jszip";

import {
  getStudentAdditionUploadColumns,
  getStudentAdditionRejectedRowMetadataColumns,
  validateStudentAdditionInput,
  type LmsStudentAdditionRow,
  type StudentAdditionInput,
  type StudentAdditionValidationResult,
} from "./student-addition-fields";
import {
  ACTIVE_REGISTRATION_MODE,
  PHONE_REGISTRATION_MODE,
  type RegistrationMode,
} from "./registration-mode";

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

export interface StudentAdditionIgnoredExampleRow {
  row_number: number;
  matched_fields: string[];
  message: string;
}

export type StudentAdditionUploadParseResult =
  | {
      ok: true;
      rows: LmsStudentAdditionRow[];
      rejectedResults: StudentAdditionUploadRowResult[];
      ignoredRows: StudentAdditionIgnoredExampleRow[];
      totalRows: number;
      originalRows: Map<number, Record<string, string>>;
    }
  | { ok: false; error: string };

interface ParseUploadInput {
  filename: string;
  data: Buffer;
  today?: Date;
  academicYear?: string;
  mode?: RegistrationMode;
}

// These marker values mirror the example rows in the checked-in Approved and
// HQ Phone workbooks. Phone mode intentionally has no restricted-field
// markers because those columns are not part of its schema.
const APPROVED_EXAMPLE_ROW_MARKERS = [
  { column: "Student Name", field: "Student Name", value: "Example Student" },
  { column: "PEN Number", field: "PEN", value: "12345678910" },
  { column: "Grade 10 Roll no", field: "Grade 10 Roll No", value: "11111111" },
  { column: "Parents Phone Number", field: "Phone", value: "9999999999" },
] as const;

const PHONE_EXAMPLE_ROW_MARKERS = [
  { column: "Student Name", field: "Student Name", value: "Example Student" },
  { column: "Parents Phone Number", field: "Phone", value: "9999999999" },
] as const;

const PHONE_EXAMPLE_PHONE = "9999999999";
const PHONE_EXAMPLE_PHONE_ERROR =
  "Phone number matches the example row. Please replace it with the student's actual phone number";

function exampleRowMarkers(mode: RegistrationMode) {
  if (mode !== PHONE_REGISTRATION_MODE) return APPROVED_EXAMPLE_ROW_MARKERS;

  // In Phone mode, only the named template row is ignored. A real student's
  // row that reuses the example phone must remain visible as a rejected row.
  return PHONE_EXAMPLE_ROW_MARKERS.filter((marker) => marker.column === "Student Name");
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

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function missingColumns(headers: string[], columns = getStudentAdditionUploadColumns()) {
  const headerSet = new Set(headers.map(normalizeHeader));
  return columns
    .map((column) => column.label)
    .filter((label) => !headerSet.has(normalizeHeader(label)));
}

function phoneModeSchemaError() {
  return "This upload does not match the active Phone Registration Mode template. Download the current template and upload it again.";
}

function validateUploadSchema(headers: string[], mode: RegistrationMode) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const columns = getStudentAdditionUploadColumns(mode);
  const duplicateCanonicalHeaders = columns.filter((column) =>
    normalizedHeaders.filter((header) => header === normalizeHeader(column.label)).length !== 1,
  );

  if (mode !== PHONE_REGISTRATION_MODE) {
    if (
      normalizedHeaders.includes(normalizeHeader("APAAR ID")) ||
      !normalizedHeaders.includes(normalizeHeader("PEN Number"))
    ) {
      return {
        ok: false as const,
        error: "This workbook uses the old APAAR template. Download the latest PEN-based template and upload it again.",
      };
    }
    const missing = missingColumns(headers, columns);
    if (missing.length > 0) {
      return {
        ok: false as const,
        error: `Missing required columns: ${missing.join(", ")}. Download the latest template and upload it again`,
      };
    }
    if (duplicateCanonicalHeaders.length > 0) {
      return {
        ok: false as const,
        error: `Duplicate columns: ${duplicateCanonicalHeaders.map((column) => column.label).join(", ")}. Download the latest template and upload it again`,
      };
    }
    return { ok: true as const };
  }

  const rejectedRowMetadataColumns = new Set(
    getStudentAdditionRejectedRowMetadataColumns(mode).map(normalizeHeader),
  );
  const expected = new Set(columns.map((column) => normalizeHeader(column.label)));
  const nonBlankHeaders = normalizedHeaders.filter(Boolean);
  const missing = columns.filter((column) =>
    !normalizedHeaders.includes(normalizeHeader(column.label)),
  );
  const unexpected = nonBlankHeaders.filter((header) =>
    !expected.has(header) && !rejectedRowMetadataColumns.has(header),
  );

  if (missing.length > 0 || duplicateCanonicalHeaders.length > 0 || unexpected.length > 0) {
    return { ok: false as const, error: phoneModeSchemaError() };
  }

  return { ok: true as const };
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

function uploadRowRejectedResult(
  validation: StudentAdditionValidationResult,
  original: Record<string, string>,
  mode: RegistrationMode,
) {
  if (
    mode === PHONE_REGISTRATION_MODE &&
    original["Parents Phone Number"] === PHONE_EXAMPLE_PHONE
  ) {
    return validationToRejectedResult({
      ok: false,
      row: validation.row,
      generatedStudentId: validation.generatedStudentId,
      fieldErrors: {
        ...validation.fieldErrors,
        phone: PHONE_EXAMPLE_PHONE_ERROR,
      },
      rowErrors: [...validation.rowErrors],
    }, original);
  }

  return validation.ok ? null : validationToRejectedResult(validation, original);
}

function parseRowsFromAoA(
  rows: unknown[][],
  today?: Date,
  academicYear?: string,
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
): StudentAdditionUploadParseResult {
  const headers = (rows[0] ?? []).map(text);
  const schema = validateUploadSchema(headers, mode);
  if (!schema.ok) return schema;

  const columns = getStudentAdditionUploadColumns(mode);
  const headerIndex = new Map(headers.map((header, index) => [normalizeHeader(header), index]));
  const originalRowNumberIndex = headerIndex.get(normalizeHeader("Original Row Number"));
  const acceptedRows: LmsStudentAdditionRow[] = [];
  const rejectedResults: StudentAdditionUploadRowResult[] = [];
  const originalRows = new Map<number, Record<string, string>>();
  const dataRows = rows.slice(1).map((sourceRow, index) => ({ sourceRow, index }));
  const ignoredRows = dataRows.flatMap(({ sourceRow, index }) => {
    const matchedFields = exampleRowMarkers(mode)
      .filter((marker) =>
        text(sourceRow[headerIndex.get(normalizeHeader(marker.column)) ?? -1]) === marker.value,
      )
      .map((marker) => marker.field);
    if (matchedFields.length === 0) return [];
    const rowNumber = index + 2;
    return [{
      row_number: rowNumber,
      matched_fields: matchedFields,
      message: `Row ${rowNumber} was ignored as the example row. Matched: ${matchedFields.join(", ")}.`,
    }];
  });
  const ignoredIndexes = new Set(ignoredRows.map((row) => row.row_number - 2));
  const nonBlankRows = dataRows.filter(
    ({ sourceRow, index }) =>
      !ignoredIndexes.has(index) &&
      columns.some((column) =>
        text(sourceRow[headerIndex.get(normalizeHeader(column.label)) ?? -1]),
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

    for (const column of columns) {
      const value = text(sourceRow[headerIndex.get(normalizeHeader(column.label)) ?? -1]);
      original[column.label] = value;
      input[column.key] = column.key === "student_name" ? value.replace(/\./g, " ") : value;
    }

    const parsedOriginalRowNumber =
      originalRowNumberIndex == null ? NaN : Number(text(sourceRow[originalRowNumberIndex]));
    const rowNumber = Number.isInteger(parsedOriginalRowNumber) && parsedOriginalRowNumber > 0
      ? parsedOriginalRowNumber
      : index + 2;

    const validation = validateStudentAdditionInput(input, {
      today,
      rowNumber,
      academicYear,
      bulkUpload: true,
      mode,
    });
    originalRows.set(rowNumber, original);

    const rejectedResult = uploadRowRejectedResult(validation, original, mode);
    if (rejectedResult) {
      rejectedResults.push(rejectedResult);
      return;
    }

    acceptedRows.push(validation.row as LmsStudentAdditionRow);
  });

  return {
    ok: true,
    rows: acceptedRows,
    rejectedResults,
    ignoredRows,
    totalRows: acceptedRows.length + rejectedResults.length,
    originalRows,
  };
}

function parseCsv(
  data: Buffer,
  today?: Date,
  academicYear?: string,
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
) {
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
  return parseRowsFromAoA(rows, today, academicYear, mode);
}

async function removeBlankXlsxFormatting(data: Buffer) {
  const archive = await JSZip.loadAsync(data);
  const worksheetEntries = Object.values(archive.files).filter(
    (entry) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name),
  );

  await Promise.all(worksheetEntries.map(async (entry) => {
    const xml = await entry.async("string");
    const compacted = xml
      .replace(/<c\b[^>]*\/>/g, "")
      .replace(/<row\b[^>]*>\s*<\/row>/g, "")
      .replace(/<row\b[^>]*\/>/g, "");
    if (compacted !== xml) archive.file(entry.name, compacted);
  }));

  return archive.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 1 },
  });
}

async function parseXlsx(
  data: Buffer,
  today?: Date,
  academicYear?: string,
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
) {
  const workbook = new ExcelJS.Workbook();
  try {
    const compacted = await removeBlankXlsxFormatting(data);
    await workbook.xlsx.load(compacted as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { ok: false, error: "Upload a valid .xlsx file or rejected-row .csv file" } as const;
  }
  const sheet = workbook.getWorksheet("Template");
  if (!sheet) {
    return {
      ok: false,
      error: "Workbook must include a Template sheet. Download the latest template and upload it again.",
    } as const;
  }

  const rows: unknown[][] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: unknown[] = [];
    for (let columnNumber = 1; columnNumber <= sheet.columnCount; columnNumber += 1) {
      values.push(row.getCell(columnNumber).value ?? "");
    }
    rows.push(values);
  }
  return parseRowsFromAoA(rows, today, academicYear, mode);
}

export async function parseStudentAdditionUpload({
  filename,
  data,
  today,
  academicYear,
  mode = ACTIVE_REGISTRATION_MODE,
}: ParseUploadInput): Promise<StudentAdditionUploadParseResult> {
  if (filename.toLowerCase().endsWith(".xls")) {
    return {
      ok: false,
      error: "Save the file as .xlsx and upload again. Legacy .xls files are not supported.",
    };
  }

  if (filename.toLowerCase().endsWith(".csv")) {
    return parseCsv(data, today, academicYear, mode);
  }

  if (filename.toLowerCase().endsWith(".xlsx")) {
    return parseXlsx(data, today, academicYear, mode);
  }

  return {
    ok: true,
    rows: [],
    rejectedResults: [],
    ignoredRows: [],
    totalRows: 0,
    originalRows: new Map(),
  };
}
