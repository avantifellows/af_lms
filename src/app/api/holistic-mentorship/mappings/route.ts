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

async function adminAssign(value: Record<string, unknown>) {
  if (!("program_id" in value)) return holisticApiError("Program is required");
  if (typeof value.program_id !== "number" || !Number.isSafeInteger(value.program_id)) {
    return holisticApiError("Invalid Program");
  }
  const programId = holisticProgramId(value.program_id);
  if (!programId) return holisticApiError("Invalid Program");
  if (!validSchoolCode(value.school_code)) return holisticApiError("Invalid School");
  if (value.academic_year !== CURRENT_ACADEMIC_YEAR) {
    return holisticApiError("Admin Mapping assignments are limited to the current Academic Year");
  }
  if (value.confirmed !== true) return holisticApiError("Assignment confirmation is required");
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) return holisticApiError("Assignment reason is required");
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return holisticApiError("Invalid Student");
  const mentorUserId = positiveInteger(value.mentor_user_id);
  if (!mentorUserId) return holisticApiError("Invalid Mentor");
  if (value.expected_mapping_id !== null) {
    return holisticApiError("Expected Mapping must be unassigned");
  }

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "admin_mapping_mutation", {
    schoolCode: value.school_code,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await assignHolisticMenteeAsAdmin({
    actorEmail: access.email.trim().toLowerCase(),
    auditActorUserId: access.permission.user_id ?? undefined,
    schoolId: access.school!.id,
    programId,
    academicYear: value.academic_year,
    studentId,
    mentorUserId,
    expectedMappingId: null,
    confirmed: true,
    reason,
  }));
}

function isAdminRemoveRequest(value: Record<string, unknown>): boolean {
  return "student_id" in value || "expected_mapping_id" in value || "reason" in value;
}

async function adminRemove(value: Record<string, unknown>) {
  if (!("program_id" in value)) return holisticApiError("Program is required");
  if (typeof value.program_id !== "number" || !Number.isSafeInteger(value.program_id)) {
    return holisticApiError("Invalid Program");
  }
  const programId = holisticProgramId(value.program_id);
  if (!programId) return holisticApiError("Invalid Program");
  if (!validSchoolCode(value.school_code)) return holisticApiError("Invalid School");
  if (value.academic_year !== CURRENT_ACADEMIC_YEAR) {
    return holisticApiError("Admin Mapping removals are limited to the current Academic Year");
  }
  if (value.confirmed !== true) return holisticApiError("Removal confirmation is required");
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) return holisticApiError("Removal reason is required");
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return holisticApiError("Invalid Student");
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  if (!expectedMappingId) return holisticApiError("Invalid expected Mapping");

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "admin_mapping_mutation", {
    schoolCode: value.school_code,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await removeHolisticMenteeAsAdmin({
    actorEmail: access.email.trim().toLowerCase(),
    auditActorUserId: access.permission.user_id ?? undefined,
    schoolId: access.school!.id,
    programId,
    academicYear: value.academic_year,
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
  const value = await readJsonObject(request);
  if (value && isAdminAssignRequest(value)) return adminAssign(value);
  if (!value) return holisticApiError("Invalid Mapping selection");
  if (!("program_id" in value)) return holisticApiError("Program is required");
  if (typeof value.program_id !== "number" || !Number.isSafeInteger(value.program_id)) {
    return holisticApiError("Invalid Program");
  }
  const programId = holisticProgramId(value.program_id);
  if (!programId) return holisticApiError("Invalid Program");
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
  if (!("program_id" in value)) return holisticApiError("Program is required");
  if (typeof value.program_id !== "number" || !Number.isSafeInteger(value.program_id)) {
    return holisticApiError("Invalid Program");
  }
  const programId = holisticProgramId(value.program_id);
  if (!programId) return holisticApiError("Invalid Program");
  if (!validSchoolCode(value.school_code)) return holisticApiError("Invalid School");
  if (value.academic_year !== CURRENT_ACADEMIC_YEAR) {
    return holisticApiError("Admin Mapping reassignments are limited to the current Academic Year");
  }
  if (value.confirmed !== true) return holisticApiError("Reassignment confirmation is required");
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  if (!reason) return holisticApiError("Reassignment reason is required");
  const studentId = positiveInteger(value.student_id);
  if (!studentId) return holisticApiError("Invalid Student");
  const mentorUserId = positiveInteger(value.mentor_user_id);
  if (!mentorUserId) return holisticApiError("Invalid Mentor");
  const expectedMappingId = positiveInteger(value.expected_mapping_id);
  if (!expectedMappingId) return holisticApiError("Invalid expected Mapping");

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "admin_mapping_mutation", {
    schoolCode: value.school_code,
    programId,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await reassignHolisticMenteeAsAdmin({
    actorEmail: access.email.trim().toLowerCase(),
    auditActorUserId: access.permission.user_id ?? undefined,
    schoolId: access.school!.id,
    programId,
    academicYear: value.academic_year,
    studentId,
    mentorUserId,
    expectedMappingId,
    confirmed: true,
    reason,
  }));
}

export async function DELETE(request: NextRequest) {
  const value = await readJsonObject(request);
  if (value && isAdminRemoveRequest(value)) return adminRemove(value);
  if (!value) return holisticApiError("Invalid Mapping removal");
  if (!("program_id" in value)) return holisticApiError("Program is required");
  if (typeof value.program_id !== "number" || !Number.isSafeInteger(value.program_id)) {
    return holisticApiError("Invalid Program");
  }
  const programId = holisticProgramId(value.program_id);
  if (!programId) return holisticApiError("Invalid Program");
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
