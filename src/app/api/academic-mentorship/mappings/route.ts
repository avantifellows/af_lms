import { NextRequest, NextResponse } from "next/server";

import {
  createAcademicMentorshipMapping,
  endAcademicMentorshipMapping,
  isAcademicMentorshipManagementRole,
  isAcademicMentorshipEditableYear,
  listAcademicMentorshipMappings,
  reassignAcademicMentorshipMapping,
} from "@/lib/academic-mentorship";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  academicMentorshipError,
  getAcademicMentorshipSession,
  parseSchoolYear,
  parseSchoolYearSearchParams,
  positiveInteger,
  readAcademicMentorshipJsonBody,
  requireAcademicMentorshipActor,
  requireAcademicMentorshipRouteAccess,
  stringValue,
  type AcademicMentorshipRouteSession,
  type ApiResult,
} from "../route-helpers";

interface EditContext {
  session: AcademicMentorshipRouteSession;
  body: Record<string, unknown>;
  schoolCode: string;
  academicYear: string;
}

async function readEditContext(request: NextRequest): Promise<ApiResult<EditContext>> {
  const session = await getAcademicMentorshipSession();
  if (!session.ok) return session;

  const body = await readAcademicMentorshipJsonBody(request);
  if (!body.ok) return body;

  const parsed = parseSchoolYear({
    schoolCode: stringValue(body.value.school_code),
    academicYear: stringValue(body.value.academic_year),
    requireEditable: true,
  });
  if (!parsed.ok) return parsed;

  return {
    ok: true,
    value: {
      session: session.value,
      body: body.value,
      schoolCode: parsed.value.schoolCode,
      academicYear: parsed.value.academicYear,
    },
  };
}

function parseMappingId(body: Record<string, unknown>): ApiResult<number> {
  const mappingId = positiveInteger(body.mapping_id);
  if (mappingId === null) {
    return { ok: false, response: academicMentorshipError("mapping_id is required", 400) };
  }
  return { ok: true, value: mappingId };
}

async function readMappingEditContext(
  request: NextRequest
): Promise<ApiResult<EditContext & { mappingId: number }>> {
  const context = await readEditContext(request);
  if (!context.ok) return context;

  const mappingId = parseMappingId(context.value.body);
  if (!mappingId.ok) return mappingId;

  return { ok: true, value: { ...context.value, mappingId: mappingId.value } };
}

export async function GET(request: NextRequest) {
  const session = await getAcademicMentorshipSession();
  if (!session.ok) return session.response;

  const parsed = parseSchoolYearSearchParams(request, {
    defaultAcademicYear: CURRENT_ACADEMIC_YEAR,
    missingSchoolCodeMessage: "school_code query parameter is required",
  });
  if (!parsed.ok) return parsed.response;

  const access = await requireAcademicMentorshipRouteAccess(
    session.value,
    "view",
    parsed.value.schoolCode
  );
  if (!access.ok) return access.response;
  if (!isAcademicMentorshipManagementRole(access.value.permission)) {
    return academicMentorshipError("Forbidden", 403);
  }

  const includeHistory = request.nextUrl.searchParams.get("include_history") === "true";
  const groups = await listAcademicMentorshipMappings({
    schoolId: access.value.school!.id,
    academicYear: parsed.value.academicYear,
    includeHistory,
  });

  return NextResponse.json({
    school: access.value.school,
    academicYear: parsed.value.academicYear,
    includeHistory,
    canEdit: access.value.canEdit && isAcademicMentorshipEditableYear(parsed.value.academicYear),
    groups,
  });
}

export async function POST(request: NextRequest) {
  const context = await readEditContext(request);
  if (!context.ok) return context.response;

  const { session, body, schoolCode, academicYear } = context.value;
  const mentorUserId = positiveInteger(body.mentor_user_id);
  if (mentorUserId === null) {
    return academicMentorshipError("mentor_user_id is required", 400);
  }
  const studentPkId = positiveInteger(body.student_id);
  if (studentPkId === null) {
    return academicMentorshipError("student_id is required", 400);
  }

  const actor = await requireAcademicMentorshipActor(session, schoolCode);
  if (!actor.ok) return actor.response;
  const { access, actorUserId } = actor.value;

  const result = await createAcademicMentorshipMapping({
    schoolId: access.school!.id,
    schoolCode,
    schoolRegion: access.school!.region,
    academicYear,
    mentorUserId,
    studentPkId,
    assignedByUserId: actorUserId,
  });
  if (!result.ok) {
    return academicMentorshipError(result.error, result.status);
  }

  return NextResponse.json(
    { success: true, mappingId: result.mappingId },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const context = await readMappingEditContext(request);
  if (!context.ok) return context.response;

  const { session, schoolCode, academicYear, mappingId } = context.value;

  const actor = await requireAcademicMentorshipActor(session, schoolCode);
  if (!actor.ok) return actor.response;
  const { access, actorUserId } = actor.value;

  const result = await endAcademicMentorshipMapping({
    schoolId: access.school!.id,
    academicYear,
    mappingId,
    endedByUserId: actorUserId,
  });
  if (!result.ok) {
    return academicMentorshipError(result.error, result.status);
  }

  return NextResponse.json({ success: true, mappingId: result.mappingId });
}

export async function PATCH(request: NextRequest) {
  const context = await readMappingEditContext(request);
  if (!context.ok) return context.response;

  const { session, body, schoolCode, academicYear, mappingId } = context.value;
  const mentorUserId = positiveInteger(body.mentor_user_id);
  if (mentorUserId === null) {
    return academicMentorshipError("mentor_user_id is required", 400);
  }

  const actor = await requireAcademicMentorshipActor(session, schoolCode);
  if (!actor.ok) return actor.response;
  const { access, actorUserId } = actor.value;

  const result = await reassignAcademicMentorshipMapping({
    schoolId: access.school!.id,
    schoolCode: access.school!.code,
    schoolRegion: access.school!.region,
    academicYear,
    mappingId,
    replacementMentorUserId: mentorUserId,
    assignedByUserId: actorUserId,
  });
  if (!result.ok) {
    return academicMentorshipError(result.error, result.status);
  }

  return NextResponse.json({ success: true, mappingId: result.mappingId });
}
