import { NextRequest, NextResponse } from "next/server";

import {
  importAcademicMentorshipMappingsFromCsv,
} from "@/lib/academic-mentorship";
import {
  academicMentorshipError,
  formString,
  getAcademicMentorshipSession,
  parseSchoolYear,
  parseSchoolYearSearchParams,
  requireAcademicMentorshipActor,
  requireAcademicMentorshipRouteAccess,
} from "../../route-helpers";

const TEMPLATE = "mentor_email,student_id\n";

export async function GET(request: NextRequest) {
  const session = await getAcademicMentorshipSession();
  if (!session.ok) return session.response;

  const parsed = parseSchoolYearSearchParams(request, {
    requireEditable: false,
    requireSupported: true,
  });
  if (!parsed.ok) return parsed.response;

  const access = await requireAcademicMentorshipRouteAccess(
    session.value,
    "edit",
    parsed.value.schoolCode
  );
  if (!access.ok) return access.response;

  return new NextResponse(TEMPLATE, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        'attachment; filename="academic-mentorship-template.csv"',
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await getAcademicMentorshipSession();
  if (!session.ok) return session.response;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return academicMentorshipError("Invalid multipart form data", 400);
  }

  const parsed = parseSchoolYear({
    schoolCode: formString(formData, "school_code"),
    academicYear: formString(formData, "academic_year"),
    requireEditable: false,
    requireSupported: true,
  });
  if (!parsed.ok) return parsed.response;

  const file = formData.get("file");
  if (!file || typeof file === "string" || typeof file.text !== "function") {
    return academicMentorshipError("CSV file is required", 400);
  }

  const actor = await requireAcademicMentorshipActor(
    session.value,
    parsed.value.schoolCode
  );
  if (!actor.ok) return actor.response;

  const result = await importAcademicMentorshipMappingsFromCsv({
    csvText: await file.text(),
    schoolId: actor.value.access.school!.id,
    schoolCode: actor.value.access.school!.code,
    schoolRegion: actor.value.access.school!.region,
    academicYear: parsed.value.academicYear,
    assignedByUserId: actor.value.actorUserId,
  });

  if (result.ok) {
    return NextResponse.json(
      { success: true, insertedCount: result.insertedCount },
      { status: 201 }
    );
  }
  if (result.type === "file") {
    return academicMentorshipError(result.error, 400);
  }
  return NextResponse.json(
    {
      error: "CSV upload has row errors",
      errors: result.errors,
      errorCsv: result.errorCsv,
    },
    { status: 422 }
  );
}
