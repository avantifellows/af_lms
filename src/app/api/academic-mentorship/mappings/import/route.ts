import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  getAcademicMentorshipActorUserId,
  importAcademicMentorshipMappingsFromCsv,
  isAcademicMentorshipEditableYear,
  isValidAcademicYear,
  requireAcademicMentorshipAccess,
} from "@/lib/academic-mentorship";

const TEMPLATE = "mentor_email,student_id\n";

function requireSchoolAndYear(
  schoolCode: string | null | undefined,
  academicYear: string | null | undefined
): { ok: true; schoolCode: string; academicYear: string } | { ok: false; response: NextResponse } {
  const trimmedSchoolCode = schoolCode?.trim() ?? "";
  if (!trimmedSchoolCode) {
    return {
      ok: false,
      response: NextResponse.json({ error: "school_code is required" }, { status: 400 }),
    };
  }
  const trimmedAcademicYear = academicYear?.trim() ?? "";
  if (!isValidAcademicYear(trimmedAcademicYear)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "academic_year must use YYYY-YYYY format" },
        { status: 400 }
      ),
    };
  }
  if (!isAcademicMentorshipEditableYear(trimmedAcademicYear)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Academic year is not editable" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, schoolCode: trimmedSchoolCode, academicYear: trimmedAcademicYear };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requireSchoolAndYear(
    request.nextUrl.searchParams.get("school_code"),
    request.nextUrl.searchParams.get("academic_year")
  );
  if (!parsed.ok) return parsed.response;

  const access = await requireAcademicMentorshipAccess(session, "edit", {
    schoolCode: parsed.schoolCode,
  });
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  return new NextResponse(TEMPLATE, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition":
        'attachment; filename="academic-mentorship-template.csv"',
    },
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const parsed = requireSchoolAndYear(
    typeof formData.get("school_code") === "string"
      ? String(formData.get("school_code"))
      : "",
    typeof formData.get("academic_year") === "string"
      ? String(formData.get("academic_year"))
      : ""
  );
  if (!parsed.ok) return parsed.response;

  const file = formData.get("file");
  if (!file || typeof file === "string" || typeof file.text !== "function") {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  const access = await requireAcademicMentorshipAccess(session, "edit", {
    schoolCode: parsed.schoolCode,
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

  const result = await importAcademicMentorshipMappingsFromCsv({
    csvText: await file.text(),
    schoolId: access.school!.id,
    schoolCode: access.school!.code,
    schoolRegion: access.school!.region,
    academicYear: parsed.academicYear,
    assignedByUserId: actorUserId,
  });

  if (result.ok) {
    return NextResponse.json(
      { success: true, insertedCount: result.insertedCount },
      { status: 201 }
    );
  }
  if (result.type === "file") {
    return NextResponse.json({ error: result.error }, { status: 400 });
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
