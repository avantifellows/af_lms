import path from "path";

import {
  ACTIVE_REGISTRATION_MODE,
  APPROVED_REGISTRATION_MODE,
  getRegistrationModeHandshake,
  isRegistrationModeMismatchResponse,
  PHONE_REGISTRATION_MODE,
  REGISTRATION_MODE_MISMATCH_MESSAGE,
  type RegistrationMode,
} from "@/lib/registration-mode";
import { getDbServiceConfig } from "@/lib/db-service-config";
import {
  type LmsStudentAdditionRow,
  type StudentAdditionValidationResult,
} from "@/lib/student-addition-fields";
import type { StudentAdditionSchool } from "@/lib/student-addition-access";
import type { StudentAdditionUploadRowResult } from "@/lib/student-addition-bulk";

export interface StudentAdditionActor {
  user_id: number | null;
  email: string;
  login_type: "google";
  role: string;
}

export interface StudentAdditionProxyAccess {
  programId: number;
  actor: StudentAdditionActor;
}

export type StudentAdditionResultStatus =
  | "created"
  | "duplicate_in_file"
  | "already_exists"
  | "rejected";

interface StudentAdditionServiceResult {
  row_number: number;
  status: StudentAdditionResultStatus;
  original?: Record<string, string>;
}

export interface StudentAdditionProxyResult {
  status: number;
  body: Record<string, unknown>;
}

const EMPTY_STUDENT_ADDITION_TOTALS = {
  total: 0,
  created: 0,
  duplicate_in_file: 0,
  already_exists: 0,
  rejected: 0,
} as const;

export const MAX_STUDENT_ADDITION_UPLOAD_BYTES = 5 * 1024 * 1024;

export const STUDENT_ADDITION_TEMPLATE_FILENAMES: Record<RegistrationMode, string> = {
  [PHONE_REGISTRATION_MODE]: "NVS_Lakshya_Data_Template_updated_19th_August_2026.xlsx",
  [APPROVED_REGISTRATION_MODE]: "nvs-student-addition-template.xlsx",
};

export function studentAdditionTemplatePath(
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
) {
  return path.join(
    process.cwd(),
    process.env.NODE_ENV === "production" ? ".next/server/assets" : "src/assets",
    STUDENT_ADDITION_TEMPLATE_FILENAMES[mode],
  );
}

function safeFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    keys.filter((key) => key in record).map((key) => [key, record[key]]),
  );
}

const PHONE_RESTRICTED_RESULT_KEYS = new Set([
  "pen_number",
  "g10_roll_no",
  "annual_family_income",
  "apaar_id",
]);

function safePhoneResultFields(value: unknown, mode: RegistrationMode) {
  if (
    mode !== PHONE_REGISTRATION_MODE ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PHONE_RESTRICTED_RESULT_KEYS.has(key)),
  );
}

function safeStudentAdditionServiceResults(
  value: unknown,
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
) {
  if (!Array.isArray(value)) return undefined;
  return value.map((result) => {
    const safe = safeFields(result, [
      "row_number",
      "status",
      "generated_student_id",
      "field_errors",
      "row_errors",
    ]) ?? {};
    const record = result as Record<string, unknown>;
    const duplicateIdentifiers = Array.isArray(record.duplicate_identifiers)
      ? record.duplicate_identifiers.filter(
        (identifier): identifier is string =>
          typeof identifier === "string" &&
          (mode !== PHONE_REGISTRATION_MODE ||
            !/pen|grade\s*10\s*roll|annual\s*family\s*income/i.test(identifier)),
      )
      : undefined;
    const normalized = safePhoneResultFields(
      safeFields(record.normalized, [
        "student_id",
        "pen_number",
        "student_name",
        "g10_roll_no",
      ]),
      mode,
    );
    const existingMatch = safePhoneResultFields(
      safeFields(record.existing_match, [
        "matched_identifier",
        "student_id",
        "pen_number",
        "apaar_id",
        "student_name",
        "school_name",
        "school_code",
        "udise_code",
        "district",
        "state",
        "grade",
        "program",
        "stream",
      ]),
      mode,
    );
    const fieldErrors = safePhoneResultFields(safe.field_errors, mode);
    return {
      ...safe,
      ...(fieldErrors ? { field_errors: fieldErrors } : {}),
      ...(duplicateIdentifiers ? { duplicate_identifiers: duplicateIdentifiers } : {}),
      ...(normalized ? { normalized } : {}),
      ...(existingMatch ? { existing_match: existingMatch } : {}),
    };
  });
}

export function countStudentAdditionTotals(
  results: Array<{ status: StudentAdditionResultStatus }>,
) {
  type Totals = {
    total: number;
    created: number;
    duplicate_in_file: number;
    already_exists: number;
    rejected: number;
  };
  return results.reduce<Totals>(
    (totals, result) => ({
      ...totals,
      total: totals.total + 1,
      [result.status]: totals[result.status] + 1,
    }),
    { ...EMPTY_STUDENT_ADDITION_TOTALS },
  );
}

export function studentAdditionValidationBody(result: StudentAdditionValidationResult) {
  return {
    error: "Validation failed",
    totals: { total: 1, created: 0, duplicate_in_file: 0, already_exists: 0, rejected: 1 },
    results: [
      {
        row_number: 1,
        status: "rejected" as const,
        generated_student_id: result.generatedStudentId,
        normalized: {
          student_name: result.row.student_name ?? "",
          g10_roll_no: result.row.g10_roll_no ?? "",
          student_id: result.generatedStudentId,
        },
        field_errors: result.fieldErrors,
        row_errors: result.rowErrors,
        existing_match: null,
      },
    ],
  };
}

export async function proxyStudentAdditionRows({
  access,
  school,
  rows,
  upload,
  period,
}: {
  access: StudentAdditionProxyAccess;
  school: StudentAdditionSchool;
  rows: LmsStudentAdditionRow[];
  upload: { id: string; filename: string };
  period: { academic_year: string; start_date: string };
}): Promise<StudentAdditionProxyResult> {
  const dbService = getDbServiceConfig();
  if (!dbService) {
    return { status: 500, body: { error: "DB Service is not configured" } };
  }

  const response = await fetch(`${dbService.baseUrl}/lms/students/bulk-create-with-enrollments`, {
    method: "POST",
    headers: dbService.headers,
    body: JSON.stringify({
      actor: access.actor,
      school: { code: school.code, udise_code: school.udise_code },
      program_id: access.programId,
      ...getRegistrationModeHandshake(),
      upload,
      ...period,
      rows,
    }),
  });

  if (!response.ok) {
    const upstream = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (isRegistrationModeMismatchResponse(upstream)) {
      return {
        status: 503,
        body: { error: REGISTRATION_MODE_MISMATCH_MESSAGE },
      };
    }
    return {
      status: response.status,
      body: {
        error: "Student could not be created",
        ...(upstream?.field_errors ? { field_errors: upstream.field_errors } : {}),
        ...(upstream?.row_errors ? { row_errors: upstream.row_errors } : {}),
        ...(upstream?.results
          ? { results: safeStudentAdditionServiceResults(upstream.results) }
          : {}),
      },
    };
  }

  const body = await response.json() as Record<string, unknown>;
  return {
    status: response.status,
    body: {
      ...body,
      ...(Array.isArray(body.results)
        ? { results: safeStudentAdditionServiceResults(body.results) }
        : {}),
    },
  };
}

export function mergeStudentAdditionResults({
  body,
  parsedRejectedResults,
  originalRows,
  ignoredRows,
}: {
  body: Record<string, unknown>;
  parsedRejectedResults: StudentAdditionUploadRowResult[];
  originalRows: Map<number, Record<string, string>>;
  ignoredRows: unknown[];
}) {
  if (!Array.isArray(body.results)) return body;

  const serviceResults = body.results.map((result) => {
    const record = result as StudentAdditionServiceResult;
    return {
      ...record,
      original: originalRows.get(record.row_number) ?? {},
    };
  });
  const results = [...serviceResults, ...parsedRejectedResults].sort(
    (a, b) => (a.row_number ?? 0) - (b.row_number ?? 0),
  );

  return {
    ...body,
    totals: countStudentAdditionTotals(results),
    results,
    ...(ignoredRows.length > 0 ? { ignored_rows: ignoredRows } : {}),
  };
}
