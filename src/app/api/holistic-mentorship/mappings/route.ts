import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  assignHolisticMentees,
  listHolisticAssignmentRoster,
  removeHolisticMentees,
  type HolisticMappingMutationResult,
} from "@/lib/holistic-mappings";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import {
  holisticApiError,
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

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const schoolCode = params.get("school_code");
  const academicYear = params.get("academic_year") ?? CURRENT_ACADEMIC_YEAR;
  const search = (params.get("search") ?? "").trim();
  const gradeValue = params.get("grade");
  const grade = gradeValue === null || gradeValue === ""
    ? null
    : Number(gradeValue);
  if (!validSchoolCode(schoolCode) || academicYear !== CURRENT_ACADEMIC_YEAR ||
      search.length > 100 || (grade !== null && grade !== 11 && grade !== 12)) {
    return holisticApiError("Invalid roster filters");
  }

  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "roster_view", {
    schoolCode,
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return NextResponse.json({
    actorUserId: access.actorUserId,
    students: await listHolisticAssignmentRoster({
      schoolId: access.school!.id,
      academicYear,
      search,
      grade: grade as 11 | 12 | null,
    }),
  });
}

export async function POST(request: NextRequest) {
  const value = await readJsonObject(request);
  if (!value || !validSchoolCode(value.school_code) ||
      value.academic_year !== CURRENT_ACADEMIC_YEAR ||
      typeof value.takeover_confirmed !== "boolean" || !Array.isArray(value.selections) ||
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
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await assignHolisticMentees({
    actorUserId: access.actorUserId!,
    schoolId: access.school!.id,
    academicYear: value.academic_year,
    selections: selections as Array<{ studentId: number; expectedMappingId: number | null }>,
    takeoverConfirmed: value.takeover_confirmed,
  }));
}

export async function DELETE(request: NextRequest) {
  const value = await readJsonObject(request);
  if (!value || !validSchoolCode(value.school_code) ||
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
  });
  if (!access.ok) return holisticApiError(access.error, access.status);

  return mutationResponse(await removeHolisticMentees({
    actorUserId: access.actorUserId!,
    schoolId: access.school!.id,
    academicYear: value.academic_year,
    mappings: mappings as Array<{ studentId: number; expectedMappingId: number }>,
    confirmed: true,
  }));
}
