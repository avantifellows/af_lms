import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { requireStudentAdditionStudentAccess } from "@/lib/student-addition-access";

interface DropoutPayload {
  student_id?: string;
  apaar_id?: string;
  start_date: string;
  academic_year: string;
}

interface DropoutStudentRow {
  id: number;
  student_id: string | null;
  apaar_id: string | null;
  status: string | null;
}

function identifierError(studentId?: string, apaarId?: string) {
  const identifier = studentId || apaarId || "provided identifier";
  return `Multiple students found with the same ID (${identifier}). Please contact an administrator to resolve this duplicate record issue.`;
}

async function resolveDropoutStudent(body: DropoutPayload) {
  const studentId = body.student_id?.trim() || null;
  const apaarId = body.apaar_id?.trim() || null;

  return query<DropoutStudentRow>(
    `SELECT id, student_id, apaar_id, status
     FROM student
     WHERE ($1::text IS NOT NULL AND student_id = $1)
        OR ($2::text IS NOT NULL AND apaar_id = $2)
     LIMIT 2`,
    [studentId, apaarId],
  );
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: DropoutPayload = await request.json();

    if (!body.student_id && !body.apaar_id) {
      return NextResponse.json(
        { error: "Either student_id or apaar_id is required" },
        { status: 400 },
      );
    }

    if (!body.start_date) {
      return NextResponse.json(
        { error: "start_date is required" },
        { status: 400 },
      );
    }

    if (!body.academic_year) {
      return NextResponse.json(
        { error: "academic_year is required" },
        { status: 400 },
      );
    }

    const matches = await resolveDropoutStudent(body);
    if (matches.length === 0) {
      return NextResponse.json(
        { error: "Student not found with the provided identifier" },
        { status: 404 },
      );
    }
    if (matches.length > 1) {
      return NextResponse.json(
        { error: identifierError(body.student_id, body.apaar_id) },
        { status: 400 },
      );
    }

    const student = matches[0];
    if (student.status === "dropout") {
      return NextResponse.json(
        { error: "Student is already marked as dropout" },
        { status: 400 },
      );
    }

    const access = await requireStudentAdditionStudentAccess(session, student.id);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const dbServiceUrl = process.env.DB_SERVICE_URL;
    const dbServiceToken = process.env.DB_SERVICE_TOKEN;
    if (!dbServiceUrl || !dbServiceToken) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const requestBody: Record<string, string> = {
      start_date: body.start_date,
      academic_year: body.academic_year,
    };

    if (student.student_id) {
      requestBody.student_id = student.student_id;
    }
    if (student.apaar_id) {
      requestBody.apaar_id = student.apaar_id;
    }

    const response = await fetch(`${dbServiceUrl}/dropout`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dbServiceToken}`,
      },
      body: JSON.stringify({
        ...requestBody,
        actor: access.actor,
        school: access.school,
        program_id: access.programId,
      }),
    });

    if (response.status === 200) {
      return NextResponse.json({ success: true });
    }

    if (response.status === 400) {
      const errorData = await response.json();
      if (errorData.errors === "Student is already marked as dropout") {
        return NextResponse.json(
          { error: "Student is already marked as dropout" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: errorData.errors || "Failed to mark student as dropout" },
        { status: 400 },
      );
    }

    const errorText = await response.text();
    console.error("DB service error:", errorText);

    // Check for duplicate student error
    if (errorText.includes("expected at most one result but got")) {
      return NextResponse.json(
        {
          error: identifierError(body.student_id, body.apaar_id),
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: "Failed to mark student as dropout", details: errorText },
      { status: response.status },
    );
  } catch (error) {
    console.error("Error marking student as dropout:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
