import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  assignHolisticMenteeAsAdmin,
  assignHolisticMentees,
  listHolisticAssignmentRoster,
  reassignHolisticMenteeAsAdmin,
  removeHolisticMenteeAsAdmin,
  removeHolisticMentees,
  type HolisticMappingMutationResult,
} from "@/lib/holistic-mappings";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import {
  holisticApiError,
  holisticProgramId,
  positiveInteger,
  readJsonObject,
  validSchoolCode,
} from "../route-helpers";

function mutationResponse(result: HolisticMappingMutationResult) {
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json(
        { error: result.error, ownership: result.ownership },
        { status: result.status }
      );
}

function isAdminAssignRequest(value: Record<string, unknown>): boolean {
  return "student_id" in value || "mentor_user_id" in value ||
    "confirmed" in value || "reason" in value;
}

type ParsedAdminMutation<T> = { value: T } | { response: NextResponse };

function parsingFailed<T>(result: ParsedAdminMutation<T>): result is { response: NextResponse } {
  return "response" in result;
}

function parseExplicitProgramId(
  value: Record<string, unknown>,
): ParsedAdminMutation<number> {
  if (!("program_id" in value)) return { response: holisticApiError("Program is required") };
  if (typeof value.program_id !== "number" || !Number.isSafeInteger(value.program_id)) {
    return { response: holisticApiError("Invalid Program") };
  }
  const programId = holisticProgramId(value.program_id);
  return programId
    ? { value: programId }
    : { response: holisticApiError("Invalid Program") };
}

function parseTeacherMutation(
  value: Record<string, unknown> | null,
  invalidMessage: string,
): ParsedAdminMutation<{ payload: Record<string, unknown>; programId: number }> {
  if (!value) return { response: holisticApiError(invalidMessage) };
  const parsedProgramId = parseExplicitProgramId(value);
  if (parsingFailed(parsedProgramId)) return parsedProgramId;
  return { value: { payload: value, programId: parsedProgramId.value } };
}

async function respondToAdminMutation(
  schoolCode: string,
  programId: number,
  mutate: (actor: {
    actorEmail: string;
    auditActorUserId?: number;
    schoolId: number;
  }) => Promise<HolisticMappingMutationResult>,
) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "admin_mapping_mutation", {
    schoolCode,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);
  return mutationResponse(await mutate({
    actorEmail: access.email.trim().toLowerCase(),
    auditActorUserId: access.permission.user_id ?? undefined,
    schoolId: access.school!.id,
  }));
}

function parseAdminMutationBase(
  value: Record<string, unknown>,
  messages: { year: string; confirmation: string; reason: string },
): ParsedAdminMutation<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
}> {
  const parsedProgramId = parseExplicitProgramId(value);
  if (parsingFailed(parsedProgramId)) return parsedProgramId;
  if (!validSchoolCode(value.school_code)) {
    return { response: holisticApiError("Invalid School") };
  }
  if (value.academic_year !== CURRENT_ACADEMIC_YEAR) {
    return { response: holisticApiError(messages.year) };
  }
  if (value.confirmed !== true) return { response: holisticApiError(messages.confirmation) };
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) return { response: holisticApiError(messages.reason) };
  if (reason.length > 500) {
    return { response: holisticApiError("Audit reason must be 500 characters or fewer") };
  }
  return {
    value: {
      schoolCode: value.school_code,
      programId: parsedProgramId.value,
      academicYear: value.academic_year,
      reason,
    },
  };
}

function parseAdminMentorMutation(
  value: Record<string, unknown>,
  messages: { year: string; confirmation: string; reason: string },
): ParsedAdminMutation<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  mentorUserId: number;
}> {
  const base = parseAdminMutationBase(value, messages);
  if (parsingFailed(base)) return base;
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return { response: holisticApiError("Invalid Student") };
  const mentorUserId = positiveInteger(value.mentor_user_id);
  if (!mentorUserId) return { response: holisticApiError("Invalid Mentor") };
  return { value: { ...base.value, studentId, mentorUserId } };
}

function parseAdminAssign(value: Record<string, unknown>): ParsedAdminMutation<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  mentorUserId: number;
}> {
  const base = parseAdminMentorMutation(value, {
    year: "Admin Mapping assignments are limited to the current Academic Year",
    confirmation: "Assignment confirmation is required",
    reason: "Assignment reason is required",
  });
  if (parsingFailed(base)) return base;
  if (value.expected_mapping_id !== null) {
    return { response: holisticApiError("Expected Mapping must be unassigned") };
  }
  return base;
}

async function adminAssign(value: Record<string, unknown>) {
  const parsed = parseAdminAssign(value);
  if (parsingFailed(parsed)) return parsed.response;
  const { schoolCode, programId, academicYear, reason, studentId, mentorUserId } = parsed.value;

  return respondToAdminMutation(schoolCode, programId, (actor) =>
    assignHolisticMenteeAsAdmin({
      ...actor,
      programId,
      academicYear,
      studentId,
      mentorUserId,
      expectedMappingId: null,
      confirmed: true,
      reason,
    }));
}

function parseAdminReassign(value: Record<string, unknown>): ParsedAdminMutation<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  mentorUserId: number;
  expectedMappingId: number;
}> {
  const base = parseAdminMentorMutation(value, {
    year: "Admin Mapping reassignments are limited to the current Academic Year",
    confirmation: "Reassignment confirmation is required",
    reason: "Reassignment reason is required",
  });
  if (parsingFailed(base)) return base;
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  if (!expectedMappingId) return { response: holisticApiError("Invalid expected Mapping") };
  return { value: { ...base.value, expectedMappingId } };
}

function isAdminRemoveRequest(value: Record<string, unknown>): boolean {
  return "student_id" in value || "expected_mapping_id" in value || "reason" in value;
}

function parseAdminRemove(value: Record<string, unknown>): ParsedAdminMutation<{
  schoolCode: string;
  programId: number;
  academicYear: string;
  reason: string;
  studentId: number;
  expectedMappingId: number;
}> {
  const base = parseAdminMutationBase(value, {
    year: "Admin Mapping removals are limited to the current Academic Year",
    confirmation: "Removal confirmation is required",
    reason: "Removal reason is required",
  });
  if (parsingFailed(base)) return base;
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return { response: holisticApiError("Invalid Student") };
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  if (!expectedMappingId) return { response: holisticApiError("Invalid expected Mapping") };
  return { value: { ...base.value, studentId, expectedMappingId } };
}

async function adminRemove(value: Record<string, unknown>) {
  const parsed = parseAdminRemove(value);
  if (parsingFailed(parsed)) return parsed.response;
  const { schoolCode, programId, academicYear, reason, studentId, expectedMappingId } = parsed.value;

  return respondToAdminMutation(schoolCode, programId, (actor) =>
    removeHolisticMenteeAsAdmin({
      ...actor,
      programId,
      academicYear,
      studentId,
      expectedMappingId,
      confirmed: true,
      reason,
    }));
}

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const schoolCode = params.get("school_code");
  const academicYear = params.get("academic_year") ?? CURRENT_ACADEMIC_YEAR;
  const programId = holisticProgramId(params.get("program_id"));
  const search = (params.get("search") ?? "").trim();
  const gradeValue = params.get("grade");
  const grade = gradeValue === null || gradeValue === ""
    ? null
    : Number(gradeValue);
  if (!programId || !validSchoolCode(schoolCode) || academicYear !== CURRENT_ACADEMIC_YEAR ||
      search.length > 100 || (grade !== null && grade !== 11 && grade !== 12)) {
    return holisticApiError("Invalid roster filters");
  }

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "roster_view", {
    schoolCode,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return NextResponse.json({
    actorUserId: access.actorUserId,
    students: await listHolisticAssignmentRoster({
      permission: access.permission,
      actorUserId: access.actorUserId,
      schoolId: access.school!.id,
      programId,
      academicYear,
      search,
      grade: grade as 11 | 12 | null,
    }),
  });
}

export async function POST(request: NextRequest) {
  const requestValue = await readJsonObject(request);
  if (requestValue && isAdminAssignRequest(requestValue)) return adminAssign(requestValue);
  const parsed = parseTeacherMutation(requestValue, "Invalid Mapping selection");
  if (parsingFailed(parsed)) return parsed.response;
  const { payload: value, programId } = parsed.value;
  if (!value || !programId || !validSchoolCode(value.school_code) ||
      value.academic_year !== CURRENT_ACADEMIC_YEAR ||
      !Array.isArray(value.selections) ||
      value.selections.length < 1 || value.selections.length > 50) {
    return holisticApiError("Invalid Mapping selection");
  }
  const selections = value.selections.map((selection) => {
    if (!selection || typeof selection !== "object") return null;
    const item = selection as Record<string, unknown>;
    const studentId = positiveInteger(item.student_id);
    const expectedMappingId = item.expected_mapping_id === null
      ? null
      : positiveInteger(item.expected_mapping_id);
    return studentId && (item.expected_mapping_id === null || expectedMappingId)
      ? { studentId, expectedMappingId }
      : null;
  });
  if (selections.some((selection) => !selection) ||
      new Set(selections.map((selection) => selection!.studentId)).size !== selections.length) {
    return holisticApiError("Invalid Mapping selection");
  }

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "mapping_mutation", {
    schoolCode: value.school_code as string,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await assignHolisticMentees({
    actorUserId: access.actorUserId!,
    auditActorUserId: access.permission.user_id ?? undefined,
    actorEmail: access.email.trim().toLowerCase(),
    schoolId: access.school!.id,
    programId,
    academicYear: value.academic_year,
    selections: selections as Array<{ studentId: number; expectedMappingId: number | null }>,
  }));
}

export async function PATCH(request: NextRequest) {
  const value = await readJsonObject(request);
  if (!value) return holisticApiError("Invalid Mapping reassignment");
  const parsed = parseAdminReassign(value);
  if (parsingFailed(parsed)) return parsed.response;
  const {
    schoolCode,
    programId,
    academicYear,
    reason,
    studentId,
    mentorUserId,
    expectedMappingId,
  } = parsed.value;

  return respondToAdminMutation(schoolCode, programId, (actor) =>
    reassignHolisticMenteeAsAdmin({
      ...actor,
      programId,
      academicYear,
      studentId,
      mentorUserId,
      expectedMappingId,
      confirmed: true,
      reason,
    }));
}

export async function DELETE(request: NextRequest) {
  const requestValue = await readJsonObject(request);
  if (requestValue && isAdminRemoveRequest(requestValue)) return adminRemove(requestValue);
  const parsed = parseTeacherMutation(requestValue, "Invalid Mapping removal");
  if (parsingFailed(parsed)) return parsed.response;
  const { payload: value, programId } = parsed.value;
  if (!value || !programId || !validSchoolCode(value.school_code) ||
      value.academic_year !== CURRENT_ACADEMIC_YEAR ||
      value.confirmed !== true || !Array.isArray(value.mappings) ||
      value.mappings.length < 1 || value.mappings.length > 50) {
    return holisticApiError("Invalid Mapping removal");
  }
  const mappings = value.mappings.map((mapping) => {
    if (!mapping || typeof mapping !== "object") return null;
    const item = mapping as Record<string, unknown>;
    const studentId = positiveInteger(item.student_id);
    const expectedMappingId = positiveInteger(item.expected_mapping_id);
    return studentId && expectedMappingId ? { studentId, expectedMappingId } : null;
  });
  if (mappings.some((mapping) => !mapping) ||
      new Set(mappings.map((mapping) => mapping!.studentId)).size !== mappings.length) {
    return holisticApiError("Invalid Mapping removal");
  }

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "mapping_mutation", {
    schoolCode: value.school_code,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await removeHolisticMentees({
    actorUserId: access.actorUserId!,
    auditActorUserId: access.permission.user_id ?? undefined,
    actorEmail: access.email.trim().toLowerCase(),
    schoolId: access.school!.id,
    programId,
    academicYear: value.academic_year,
    mappings: mappings as Array<{ studentId: number; expectedMappingId: number }>,
    confirmed: true,
  }));
}
