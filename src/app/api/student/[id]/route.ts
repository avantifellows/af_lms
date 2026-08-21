import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import {
  getPhoneRegistrationStudentFacts,
  isPhoneRegistrationStudent,
  requireStudentAdditionStudentAccess,
  requireStudentEditAccess,
} from "@/lib/student-addition-access";
import { canonicalizeStudentEditPayload } from "@/lib/student-addition-fields";
import {
  ACTIVE_REGISTRATION_MODE,
  APPROVED_REGISTRATION_MODE,
  getRegistrationModeHandshake,
  isRegistrationModeMismatchResponse,
  PHONE_REGISTRATION_MODE,
  REGISTRATION_MODE_MISMATCH_MESSAGE,
} from "@/lib/registration-mode";

const PHONE_MODE_RESTRICTED_EDIT_FIELDS = {
  pen_number: "PEN Number is not accepted in Phone Registration Mode",
  g10_roll_no: "Grade 10 Roll no is not accepted in Phone Registration Mode",
  annual_family_income: "Annual Family Income is not accepted in Phone Registration Mode",
} as const;

function phoneModeRestrictedFieldErrors(body: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(PHONE_MODE_RESTRICTED_EDIT_FIELDS)
      .filter(([field]) => Object.prototype.hasOwnProperty.call(body, field)),
  );
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

  const existingSchoolCode = typeof existingMatch?.school_code === "string"
    ? existingMatch.school_code
    : undefined;
  const sameSchool =
    (existingSchoolCode && schoolCode && existingSchoolCode === schoolCode) ||
    /same.?school/.test(normalizedCode);
  if (sameSchool) {
    return "This phone number is already linked to a Student in this school.";
  }

  const otherSchool =
    (existingSchoolCode && schoolCode && existingSchoolCode !== schoolCode) ||
    /other.?school|different.?school|school.?conflict/.test(normalizedCode);
  if (otherSchool) {
    return "This phone number is already linked to a Student in another school and cannot be transferred.";
  }

  return message;
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

// fallow-ignore-next-line complexity
async function dbServiceError(response: Response, schoolCode?: string) {
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (isRegistrationModeMismatchResponse(parsed)) {
    return NextResponse.json(
      { error: REGISTRATION_MODE_MISMATCH_MESSAGE },
      { status: 503 },
    );
  }

  const error =
    parsed &&
    typeof parsed === "object" &&
    "error" in parsed &&
    parsed.error &&
    typeof parsed.error === "object"
      ? parsed.error as {
        code?: string;
        message?: string;
        fields?: string[];
        existing_match?: unknown;
      }
      : null;
  const fields = Array.isArray(error?.fields) ? error.fields : [];
  const existingMatch = safeExistingPhoneMatch(error?.existing_match ??
    (parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).existing_match
      : undefined));
  const message = phoneDuplicateMessage(
    error?.code,
    error?.message || "Failed to update student",
    existingMatch,
    schoolCode,
    fields,
  );
  const fieldErrors = Object.fromEntries(fields.map((field) => [field, message]));
  if (isPhoneDuplicateError(error?.code, error?.message || "", fields)) {
    fieldErrors.phone = message;
  }

  return NextResponse.json(
    {
      error: message,
      code: error?.code,
      field_errors: fieldErrors,
      ...(existingMatch ? { existing_match: existingMatch } : {}),
    },
    { status: response.status },
  );
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Student ID is required" },
      { status: 400 }
    );
  }

  try {
    // Authorization runs before anything else that could leak state (DB-service
    // config, body-shape validation); the body must still be parsed first
    // because the program being edited under comes from it.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Request body must be an object" }, { status: 400 });
    }
    const bodyObject = body as Record<string, unknown>;

    // The client sends the program the student is being edited under (the
    // enrollment view's selected program). Access is authorized against that
    // program; db-service also verifies the student is currently enrolled in it.
    const rawProgramId = bodyObject.program_id;
    const programId =
      typeof rawProgramId === "number"
        ? rawProgramId
        : typeof rawProgramId === "string" && rawProgramId.trim() !== ""
          ? Number(rawProgramId)
          : null;

    const access = await requireStudentEditAccess(session, id, programId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const phoneRegistrationFacts = await getPhoneRegistrationStudentFacts(id);
    const isPhoneStudent = isPhoneRegistrationStudent(phoneRegistrationFacts);
    const isPhoneCorrection =
      isPhoneStudent && Object.prototype.hasOwnProperty.call(bodyObject, "phone");

    let writeAccess = access;
    if (isPhoneCorrection) {
      const correctionAccess = await requireStudentAdditionStudentAccess(session, id);
      if (!correctionAccess.ok) {
        return NextResponse.json(
          { error: correctionAccess.error },
          { status: correctionAccess.status },
        );
      }
      writeAccess = correctionAccess;
    }

    if (ACTIVE_REGISTRATION_MODE === PHONE_REGISTRATION_MODE && isPhoneStudent) {
      const restrictedFieldErrors = phoneModeRestrictedFieldErrors(bodyObject);
      if (Object.keys(restrictedFieldErrors).length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Restricted fields are not accepted for Phone Registration Mode Students",
            field_errors: restrictedFieldErrors,
          },
          { status: 422 },
        );
      }
    }

    const dbService = getDbServiceConfig();
    if (!dbService) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const canonical = canonicalizeStudentEditPayload(bodyObject, {
      mode: isPhoneStudent ? PHONE_REGISTRATION_MODE : APPROVED_REGISTRATION_MODE,
    });
    if (!canonical.ok) {
      return NextResponse.json(canonical, { status: 422 });
    }
    const { fields } = canonical;
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
    }

    const response = await fetch(
      `${dbService.baseUrl}/lms/students/${id}/update-with-enrollments`,
      {
        method: "PATCH",
        headers: dbService.headers,
        body: JSON.stringify({
          actor: writeAccess.actor,
          school: writeAccess.school,
          program_id: writeAccess.programId,
          ...deriveLmsEnrollmentPeriod(),
          ...getRegistrationModeHandshake(),
          ...fields,
        }),
      },
    );

    if (!response.ok) {
      return dbServiceError(response, writeAccess.school.code);
    }

    return NextResponse.json(await response.json());
  } catch (error) {
    console.error("Error updating student:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
