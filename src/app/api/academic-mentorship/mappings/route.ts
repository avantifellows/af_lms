import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  createAcademicMentorshipMapping,
  endAcademicMentorshipMapping,
  getAcademicMentorshipActorUserId,
  isAcademicMentorshipManagementRole,
  isAcademicMentorshipEditableYear,
  isValidAcademicYear,
  listAcademicMentorshipMappings,
  reassignAcademicMentorshipMapping,
  requireAcademicMentorshipAccess,
} from "@/lib/academic-mentorship";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.isPasscodeUser) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return NextResponse.json(
      { error: "school_code query parameter is required" },
      { status: 400 }
    );
  }
  const academicYear =
    request.nextUrl.searchParams.get("academic_year")?.trim() || CURRENT_ACADEMIC_YEAR;
  if (!isValidAcademicYear(academicYear)) {
    return NextResponse.json(
      { error: "academic_year must use YYYY-YYYY format" },
      { status: 400 }
    );
  }
  const access = await requireAcademicMentorshipAccess(session, "view", {
    schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  if (!isAcademicMentorshipManagementRole(access.permission)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const includeHistory = request.nextUrl.searchParams.get("include_history") === "true";
  const groups = await listAcademicMentorshipMappings({
    schoolId: access.school!.id,
    academicYear,
    includeHistory,
  });

  return NextResponse.json({
    school: access.school,
    academicYear,
    includeHistory,
    canEdit: access.canEdit && isAcademicMentorshipEditableYear(academicYear),
    groups,
  });
}

function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  if (!schoolCode) {
    return NextResponse.json({ error: "school_code is required" }, { status: 400 });
  }
  const academicYear =
    typeof body.academic_year === "string" ? body.academic_year.trim() : "";
  if (!isValidAcademicYear(academicYear)) {
    return NextResponse.json(
      { error: "academic_year must use YYYY-YYYY format" },
      { status: 400 }
    );
  }
  if (!isAcademicMentorshipEditableYear(academicYear)) {
    return NextResponse.json({ error: "Academic year is not editable" }, { status: 403 });
  }
  const mentorUserId = positiveInteger(body.mentor_user_id);
  if (mentorUserId === null) {
    return NextResponse.json({ error: "mentor_user_id is required" }, { status: 400 });
  }
  const studentPkId = positiveInteger(body.student_id);
  if (studentPkId === null) {
    return NextResponse.json({ error: "student_id is required" }, { status: 400 });
  }

  const access = await requireAcademicMentorshipAccess(session, "edit", {
    schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const actorUserId = await getAcademicMentorshipActorUserId(
    access.email,
    access.permission
  );
  if (actorUserId === null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await createAcademicMentorshipMapping({
    schoolId: access.school!.id,
    schoolCode: access.school!.code,
    schoolRegion: access.school!.region,
    academicYear,
    mentorUserId,
    studentPkId,
    assignedByUserId: actorUserId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(
    { success: true, mappingId: result.mappingId },
    { status: 201 }
  );
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  if (!schoolCode) {
    return NextResponse.json({ error: "school_code is required" }, { status: 400 });
  }
  const academicYear =
    typeof body.academic_year === "string" ? body.academic_year.trim() : "";
  if (!isValidAcademicYear(academicYear)) {
    return NextResponse.json(
      { error: "academic_year must use YYYY-YYYY format" },
      { status: 400 }
    );
  }
  if (!isAcademicMentorshipEditableYear(academicYear)) {
    return NextResponse.json({ error: "Academic year is not editable" }, { status: 403 });
  }
  const mappingId = positiveInteger(body.mapping_id);
  if (mappingId === null) {
    return NextResponse.json({ error: "mapping_id is required" }, { status: 400 });
  }

  const access = await requireAcademicMentorshipAccess(session, "edit", {
    schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const actorUserId = await getAcademicMentorshipActorUserId(
    access.email,
    access.permission
  );
  if (actorUserId === null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await endAcademicMentorshipMapping({
    schoolId: access.school!.id,
    academicYear,
    mappingId,
    endedByUserId: actorUserId,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, mappingId: result.mappingId });
}

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  if (!schoolCode) {
    return NextResponse.json({ error: "school_code is required" }, { status: 400 });
  }
  const academicYear =
    typeof body.academic_year === "string" ? body.academic_year.trim() : "";
  if (!isValidAcademicYear(academicYear)) {
    return NextResponse.json(
      { error: "academic_year must use YYYY-YYYY format" },
      { status: 400 }
    );
  }
  if (!isAcademicMentorshipEditableYear(academicYear)) {
    return NextResponse.json({ error: "Academic year is not editable" }, { status: 403 });
  }
  const mappingId = positiveInteger(body.mapping_id);
  if (mappingId === null) {
    return NextResponse.json({ error: "mapping_id is required" }, { status: 400 });
  }
  const mentorUserId = positiveInteger(body.mentor_user_id);
  if (mentorUserId === null) {
    return NextResponse.json({ error: "mentor_user_id is required" }, { status: 400 });
  }

  const access = await requireAcademicMentorshipAccess(session, "edit", {
    schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const actorUserId = await getAcademicMentorshipActorUserId(
    access.email,
    access.permission
  );
  if (actorUserId === null) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, mappingId: result.mappingId });
}
