import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { requireStudentAdditionAccess } from "@/lib/student-addition-access";
import {
  validateStudentAdditionInput,
  type StudentAdditionValidationResult,
} from "@/lib/student-addition-fields";

interface RouteSchool {
  id: string;
  code: string;
  udise_code: string | null;
  region: string | null;
  program_ids: number[] | null;
}

function validationResponse(result: StudentAdditionValidationResult) {
  return NextResponse.json(
    {
      error: "Validation failed",
      totals: { total: 1, created: 0, duplicate_in_file: 0, already_exists: 0, rejected: 1 },
      results: [
        {
          row_number: 1,
          status: "rejected",
          generated_student_id: result.generatedStudentId,
          normalized: {
            student_name: result.row.student_name ?? "",
            g10_roll_no: result.row.g10_roll_no ?? "",
            student_id: result.generatedStudentId,
          },
          field_errors: result.fieldErrors,
          row_errors: result.rowErrors,
          existing_match: null,
        },
      ],
    },
    { status: 400 },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ udise: string }> },
) {
  const session = await getServerSession(authOptions);
  const { udise } = await params;

  const schools = await query<RouteSchool>(
    `SELECT id, code, udise_code, region, program_ids
     FROM school
     WHERE udise_code = $1 OR code = $1
     LIMIT 1`,
    [udise],
  );
  const school = schools[0];
  if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });

  const access = await requireStudentAdditionAccess(session, school);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = await request.json();
  const validation = validateStudentAdditionInput(body, { rowNumber: 1 });
  if (!validation.ok) return validationResponse(validation);

  const dbServiceUrl = process.env.DB_SERVICE_URL;
  const dbServiceToken = process.env.DB_SERVICE_TOKEN;
  if (!dbServiceUrl || !dbServiceToken) {
    return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
  }

  const period = deriveLmsEnrollmentPeriod();
  const response = await fetch(`${dbServiceUrl}/api/lms/students/bulk-create-with-enrollments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${dbServiceToken}`,
    },
    body: JSON.stringify({
      actor: access.actor,
      school: { code: school.code, udise_code: school.udise_code },
      program_id: access.programId,
      upload: {
        id: `single-student-${Date.now()}`,
        filename: "one-by-one",
      },
      ...period,
      rows: [validation.row],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    return NextResponse.json(
      { error: "Failed to create student", details },
      { status: response.status },
    );
  }

  return NextResponse.json(await response.json());
}
