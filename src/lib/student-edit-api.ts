import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { getDbServiceConfig } from "@/lib/db-service-config";
import {
  ACTIVE_REGISTRATION_MODE,
  APPROVED_REGISTRATION_MODE,
  getRegistrationModeHandshake,
  isRegistrationModeMismatchResponse,
  PHONE_REGISTRATION_MODE,
  REGISTRATION_MODE_MISMATCH_MESSAGE,
  type RegistrationMode,
} from "@/lib/registration-mode";
import {
  canonicalizeStudentEditPayload,
} from "@/lib/student-addition-fields";
import type { PhoneRegistrationStudentFacts } from "@/lib/student-addition-access";

const PHONE_MODE_RESTRICTED_EDIT_FIELDS = {
  pen_number: "PEN Number is not accepted in Phone Registration Mode",
  g10_roll_no: "Grade 10 Roll no is not accepted in Phone Registration Mode",
  annual_family_income: "Annual Family Income is not accepted in Phone Registration Mode",
} as const;

const PHONE_COHORT_BACKFILL_FIELDS = [
  "pen_number",
  "g10_roll_no",
  "annual_family_income",
] as const;

const PHONE_BACKFILL_REQUIRED_ERROR =
  "PEN or Grade 10 Roll no is required for phone-cohort backfill";

export type StudentEditPreparation =
  | { ok: true; fields: Record<string, unknown> }
  | { ok: false; status: 400 | 422; body: Record<string, unknown> };

export interface StudentEditProxyAccess {
  actor: {
    user_id: number | null;
    email: string;
    login_type: "google";
    role: string;
  };
  school: { code: string; udise_code: string | null };
  programId: number;
}

export interface StudentEditProxyResult {
  status: number;
  body: unknown;
}

function hasOwnField(body: Record<string, unknown>, field: string) {
  return Object.prototype.hasOwnProperty.call(body, field);
}

function hasValue(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function hasPhoneCohortBackfillInput(body: Record<string, unknown>) {
  return PHONE_COHORT_BACKFILL_FIELDS.some((field) => hasOwnField(body, field));
}

export function hasPhoneCorrectionInput(body: Record<string, unknown>) {
  return hasOwnField(body, "phone");
}

function backfillLockError(
  facts: PhoneRegistrationStudentFacts,
  body: Record<string, unknown>,
) {
  const fieldErrors: Record<string, string> = {};
  if (hasOwnField(body, "pen_number") && hasValue(facts.pen_number)) {
    fieldErrors.pen_number = "PEN can only be filled once and is already set";
  }
  if (hasOwnField(body, "g10_roll_no") && hasValue(facts.g10_roll_no)) {
    fieldErrors.g10_roll_no = "Grade 10 Roll no can only be filled once and is already set";
  }
  return fieldErrors;
}

function phoneModeRestrictedFieldErrors(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(PHONE_MODE_RESTRICTED_EDIT_FIELDS)
      .filter(([field]) => hasOwnField(body, field)),
  );
}

function restrictedPhoneModePreparationError(
  body: Record<string, unknown>,
  mode: RegistrationMode,
  isPhoneStudent: boolean,
): StudentEditPreparation | null {
  if (mode !== PHONE_REGISTRATION_MODE || !isPhoneStudent) return null;

  const fieldErrors = phoneModeRestrictedFieldErrors(body);
  return Object.keys(fieldErrors).length === 0
    ? null
    : {
      ok: false,
      status: 422,
      body: {
        ok: false,
        error: "Restricted fields are not accepted for Phone Registration Mode Students",
        field_errors: fieldErrors,
      },
    };
}

function backfillRequiredIdentifierError(
  facts: PhoneRegistrationStudentFacts,
  body: Record<string, unknown>,
): StudentEditPreparation | null {
  const hasExistingIdentifier = hasValue(facts.pen_number) || hasValue(facts.g10_roll_no);
  const hasSubmittedIdentifier = hasValue(body.pen_number) || hasValue(body.g10_roll_no);
  if (hasExistingIdentifier || hasSubmittedIdentifier) return null;

  return {
    ok: false,
    status: 422,
    body: {
      ok: false,
      error: PHONE_BACKFILL_REQUIRED_ERROR,
      field_errors: {
        pen_number: PHONE_BACKFILL_REQUIRED_ERROR,
        g10_roll_no: PHONE_BACKFILL_REQUIRED_ERROR,
      },
    },
  };
}

function phoneBackfillPreparationError(
  facts: PhoneRegistrationStudentFacts,
  body: Record<string, unknown>,
  allowPhoneBackfill: boolean,
): StudentEditPreparation | null {
  if (!allowPhoneBackfill) return null;

  const lockErrors = backfillLockError(facts, body);
  if (Object.keys(lockErrors).length > 0) {
    return {
      ok: false,
      status: 422,
      body: {
        ok: false,
        error: Object.values(lockErrors)[0],
        field_errors: lockErrors,
      },
    };
  }

  return backfillRequiredIdentifierError(facts, body);
}

function prepareCanonicalStudentEditInput(
  body: Record<string, unknown>,
  facts: PhoneRegistrationStudentFacts,
  allowPhoneBackfill: boolean,
) {
  const canonicalInput = { ...body };
  const shouldUseExistingBoard =
    allowPhoneBackfill &&
    hasOwnField(body, "g10_roll_no") &&
    !hasOwnField(body, "g10_board");
  if (shouldUseExistingBoard) canonicalInput.g10_board = facts.g10_board ?? "Others";
  return canonicalInput;
}

function canonicalizePreparedStudentEdit(
  body: Record<string, unknown>,
  facts: PhoneRegistrationStudentFacts,
  isPhoneStudent: boolean,
  allowPhoneBackfill: boolean,
) {
  return canonicalizeStudentEditPayload(
    prepareCanonicalStudentEditInput(body, facts, allowPhoneBackfill),
    {
      mode: isPhoneStudent ? PHONE_REGISTRATION_MODE : APPROVED_REGISTRATION_MODE,
      allowPhoneBackfill,
    },
  );
}

function cleanPreparedBackfillFields(
  fields: Record<string, unknown>,
  body: Record<string, unknown>,
  allowPhoneBackfill: boolean,
) {
  if (!allowPhoneBackfill) return;

  if (!hasOwnField(body, "g10_board")) delete fields.g10_board;
  if (!hasValue(fields.pen_number)) delete fields.pen_number;
  if (!hasValue(fields.g10_roll_no)) delete fields.g10_roll_no;
}

function finishPreparedStudentEdit(
  canonical: ReturnType<typeof canonicalizeStudentEditPayload>,
  body: Record<string, unknown>,
  allowPhoneBackfill: boolean,
): StudentEditPreparation {
  if (!canonical.ok) return { ok: false, status: 422, body: canonical };

  const fields = canonical.fields as Record<string, unknown>;
  cleanPreparedBackfillFields(fields, body, allowPhoneBackfill);
  if (Object.keys(fields).length === 0) {
    return {
      ok: false,
      status: 400,
      body: { error: "No editable fields provided" },
    };
  }

  return { ok: true, fields };
}

export function prepareStudentEditFields({
  body,
  facts,
  isPhoneStudent,
  allowPhoneBackfill,
  mode = ACTIVE_REGISTRATION_MODE,
}: {
  body: Record<string, unknown>;
  facts: PhoneRegistrationStudentFacts;
  isPhoneStudent: boolean;
  allowPhoneBackfill: boolean;
  mode?: RegistrationMode;
}): StudentEditPreparation {
  const restrictedError = restrictedPhoneModePreparationError(body, mode, isPhoneStudent);
  if (restrictedError) return restrictedError;

  const backfillError = phoneBackfillPreparationError(facts, body, allowPhoneBackfill);
  if (backfillError) return backfillError;

  const canonical = canonicalizePreparedStudentEdit(body, facts, isPhoneStudent, allowPhoneBackfill);
  return finishPreparedStudentEdit(canonical, body, allowPhoneBackfill);
}

function safeExistingPhoneMatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const match = value as Record<string, unknown>;
  const safe = Object.fromEntries(
    ["student_id", "school_code", "school_name", "udise_code", "district", "state"]
      .filter((key) => key in match)
      .map((key) => [key, match[key]]),
  );
  return Object.keys(safe).length > 0 ? safe : undefined;
}

function isPhoneDuplicateError(
  code: string | undefined,
  message: string,
  fields: string[],
) {
  const searchable = `${code ?? ""} ${message}`.toLowerCase();
  return (
    fields.includes("phone") || /(phone|student.?id)/.test(searchable)
  ) && /(already|duplicate|conflict|exists|unique|use)/.test(searchable);
}

function phoneDuplicateMessage(
  code: string | undefined,
  message: string,
  existingMatch: Record<string, unknown> | undefined,
  schoolCode: string | undefined,
  fields: string[],
) {
  const normalizedCode = (code ?? "").toLowerCase();
  const isPhoneDuplicate = isPhoneDuplicateError(code, message, fields);
  if (!isPhoneDuplicate) return message;

  const scope = classifyPhoneDuplicateScope(normalizedCode, existingMatch, schoolCode);
  return phoneDuplicateScopeMessage(scope) ?? message;
}

type PhoneDuplicateScope = "same" | "other" | "unknown";

function classifyPhoneDuplicateScope(
  normalizedCode: string,
  existingMatch: Record<string, unknown> | undefined,
  schoolCode: string | undefined,
): PhoneDuplicateScope {
  if (isSameSchoolDuplicate(normalizedCode, existingMatch, schoolCode)) return "same";
  if (isOtherSchoolDuplicate(normalizedCode, existingMatch, schoolCode)) return "other";
  return "unknown";
}

function existingMatchSchoolCode(existingMatch: Record<string, unknown> | undefined) {
  return typeof existingMatch?.school_code === "string"
    ? existingMatch.school_code
    : undefined;
}

function isSameSchoolDuplicate(
  normalizedCode: string,
  existingMatch: Record<string, unknown> | undefined,
  schoolCode: string | undefined,
) {
  if (/same.?school/.test(normalizedCode)) return true;
  const existingSchoolCode = existingMatchSchoolCode(existingMatch);
  return Boolean(existingSchoolCode && schoolCode && existingSchoolCode === schoolCode);
}

function isOtherSchoolDuplicate(
  normalizedCode: string,
  existingMatch: Record<string, unknown> | undefined,
  schoolCode: string | undefined,
) {
  if (/other.?school|different.?school|school.?conflict/.test(normalizedCode)) return true;
  const existingSchoolCode = existingMatchSchoolCode(existingMatch);
  return Boolean(existingSchoolCode && schoolCode && existingSchoolCode !== schoolCode);
}

function phoneDuplicateScopeMessage(scope: PhoneDuplicateScope) {
  if (scope === "same") return "This phone number is already linked to a Student in this school.";
  if (scope === "other") {
    return "This phone number is already linked to a Student in another school and cannot be transferred.";
  }
  return undefined;
}

interface StructuredStudentEditError {
  code?: string;
  message: string;
  fields: string[];
  existingMatch?: unknown;
}

function parseResponseJson(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function extractStudentEditError(parsed: unknown): StructuredStudentEditError {
  const response = objectValue(parsed);
  const error = objectValue(response?.error);
  if (!error) {
    return { message: "Failed to update student", fields: [] };
  }
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : "Failed to update student",
    fields: Array.isArray(error.fields) ? error.fields as string[] : [],
    existingMatch: error.existing_match,
  };
}

function extractExistingPhoneMatch(
  parsed: unknown,
  error: StructuredStudentEditError,
) {
  const response = objectValue(parsed);
  const nestedMatch = error?.existingMatch;
  return safeExistingPhoneMatch(nestedMatch ?? response?.existing_match);
}

function getStudentEditErrorDetails(parsed: unknown) {
  const error = extractStudentEditError(parsed);
  const existingMatch = extractExistingPhoneMatch(parsed, error);
  return {
    error,
    existingMatch,
    fields: error.fields,
    message: error.message,
  };
}

function buildStudentEditFieldErrors(
  fields: string[],
  message: string,
  isPhoneDuplicate: boolean,
) {
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, message]));
  if (isPhoneDuplicate) fieldErrors.phone = message;
  return fieldErrors;
}

function buildStudentEditErrorBody(
  error: StructuredStudentEditError | null,
  existingMatch: Record<string, unknown> | undefined,
  fields: string[],
  message: string,
  isPhoneDuplicate: boolean,
) {
  return {
    error: message,
    code: error?.code,
    field_errors: buildStudentEditFieldErrors(fields, message, isPhoneDuplicate),
    ...(existingMatch ? { existing_match: existingMatch } : {}),
  };
}

async function dbServiceStudentEditError(
  response: Response,
  schoolCode?: string,
): Promise<StudentEditProxyResult> {
  const text = await response.text();
  const parsed = parseResponseJson(text);

  if (isRegistrationModeMismatchResponse(parsed)) {
    return {
      status: 503,
      body: { error: REGISTRATION_MODE_MISMATCH_MESSAGE },
    };
  }

  const details = getStudentEditErrorDetails(parsed);
  const { error, existingMatch, fields, message: upstreamMessage } = details;
  const isPhoneDuplicate = isPhoneDuplicateError(error.code, upstreamMessage, fields);
  const message = phoneDuplicateMessage(
    error.code,
    upstreamMessage,
    existingMatch,
    schoolCode,
    fields,
  );

  return {
    status: response.status,
    body: buildStudentEditErrorBody(error, existingMatch, fields, message, isPhoneDuplicate),
  };
}

export async function proxyStudentEdit({
  id,
  access,
  fields,
}: {
  id: string;
  access: StudentEditProxyAccess;
  fields: Record<string, unknown>;
}): Promise<StudentEditProxyResult> {
  const dbService = getDbServiceConfig();
  if (!dbService) {
    return { status: 500, body: { error: "DB Service is not configured" } };
  }

  const response = await fetch(
    `${dbService.baseUrl}/lms/students/${id}/update-with-enrollments`,
    {
      method: "PATCH",
      headers: dbService.headers,
      body: JSON.stringify({
        actor: access.actor,
        school: access.school,
        program_id: access.programId,
        ...deriveLmsEnrollmentPeriod(),
        ...getRegistrationModeHandshake(),
        ...fields,
      }),
    },
  );

  if (!response.ok) {
    return dbServiceStudentEditError(response, access.school.code);
  }

  return { status: response.status, body: await response.json() };
}
