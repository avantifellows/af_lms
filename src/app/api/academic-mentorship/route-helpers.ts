import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  getAcademicMentorshipActorUserId,
  isAcademicMentorshipEditableYear,
  isAcademicMentorshipSupportedYear,
  isValidAcademicYear,
  requireAcademicMentorshipAccess,
  type AcademicMentorshipAction,
} from "@/lib/academic-mentorship";

export type ApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

type ApiSession = NonNullable<Awaited<ReturnType<typeof getServerSession>>> & {
  user: { email: string };
  isPasscodeUser?: boolean;
};
export type AcademicMentorshipRouteSession = ApiSession;
type AccessResult = Awaited<ReturnType<typeof requireAcademicMentorshipAccess>>;
type OkAccess = Extract<AccessResult, { ok: true }>;
export type AcademicMentorshipRouteAccess = OkAccess;
export interface AcademicMentorshipActorContext {
  access: AcademicMentorshipRouteAccess;
  actorUserId: number;
}

export function academicMentorshipError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status });
}

export async function getAcademicMentorshipSession(): Promise<ApiResult<ApiSession>> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return { ok: false, response: academicMentorshipError("Unauthorized", 401) };
  }
  return { ok: true, value: session as ApiSession };
}

export async function readAcademicMentorshipJsonBody(
  request: NextRequest
): Promise<ApiResult<Record<string, unknown>>> {
  try {
    return { ok: true, value: (await request.json()) as Record<string, unknown> };
  } catch {
    return { ok: false, response: academicMentorshipError("Invalid JSON body", 400) };
  }
}

export function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function formString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export function parseSchoolCode(
  value: string | null | undefined,
  missingMessage = "school_code is required"
): ApiResult<string> {
  const schoolCode = value?.trim() ?? "";
  if (!schoolCode) {
    return { ok: false, response: academicMentorshipError(missingMessage, 400) };
  }
  return { ok: true, value: schoolCode };
}

export function parseAcademicYear(
  value: string | null | undefined,
  options: { defaultAcademicYear?: string; requireEditable?: boolean; requireSupported?: boolean } = {}
): ApiResult<string> {
  const academicYear = value?.trim() || options.defaultAcademicYear || "";
  if (!isValidAcademicYear(academicYear)) {
    return {
      ok: false,
      response: academicMentorshipError("academic_year must use YYYY-YYYY format", 400),
    };
  }
  if (options.requireSupported && !isAcademicMentorshipSupportedYear(academicYear)) {
    return { ok: false, response: academicMentorshipError("Academic year is not supported", 400) };
  }
  if (options.requireEditable && !isAcademicMentorshipEditableYear(academicYear)) {
    return { ok: false, response: academicMentorshipError("Academic year is not editable", 403) };
  }
  return { ok: true, value: academicYear };
}

export function parseSchoolYear(params: {
  schoolCode: string | null | undefined;
  academicYear: string | null | undefined;
  defaultAcademicYear?: string;
  requireEditable?: boolean;
  requireSupported?: boolean;
  missingSchoolCodeMessage?: string;
}): ApiResult<{ schoolCode: string; academicYear: string }> {
  const schoolCode = parseSchoolCode(
    params.schoolCode,
    params.missingSchoolCodeMessage
  );
  if (!schoolCode.ok) return schoolCode;

  const academicYear = parseAcademicYear(params.academicYear, {
    defaultAcademicYear: params.defaultAcademicYear,
    requireEditable: params.requireEditable,
    requireSupported: params.requireSupported,
  });
  if (!academicYear.ok) return academicYear;

  return {
    ok: true,
    value: { schoolCode: schoolCode.value, academicYear: academicYear.value },
  };
}

export function parseSchoolYearSearchParams(
  request: NextRequest,
  options: {
    defaultAcademicYear?: string;
    requireEditable?: boolean;
    requireSupported?: boolean;
    missingSchoolCodeMessage?: string;
  } = {}
): ApiResult<{ schoolCode: string; academicYear: string }> {
  return parseSchoolYear({
    schoolCode: request.nextUrl.searchParams.get("school_code"),
    academicYear: request.nextUrl.searchParams.get("academic_year"),
    defaultAcademicYear: options.defaultAcademicYear,
    requireEditable: options.requireEditable,
    requireSupported: options.requireSupported,
    missingSchoolCodeMessage: options.missingSchoolCodeMessage,
  });
}

export async function requireAcademicMentorshipRouteAccess(
  session: ApiSession,
  action: AcademicMentorshipAction,
  schoolCode: string
): Promise<ApiResult<OkAccess>> {
  const access = await requireAcademicMentorshipAccess(session, action, { schoolCode });
  if (!access.ok) {
    return { ok: false, response: academicMentorshipError(access.error, access.status) };
  }
  return { ok: true, value: access };
}

export async function requireAcademicMentorshipActor(
  session: ApiSession,
  schoolCode: string
): Promise<ApiResult<AcademicMentorshipActorContext>> {
  const access = await requireAcademicMentorshipRouteAccess(session, "edit", schoolCode);
  if (!access.ok) return access;

  const actorUserId = await getAcademicMentorshipActorUserId(
    access.value.email,
    access.value.permission
  );
  if (actorUserId === null) {
    return { ok: false, response: academicMentorshipError("Forbidden", 403) };
  }
  return { ok: true, value: { access: access.value, actorUserId } };
}
