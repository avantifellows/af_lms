import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { deriveLmsEnrollmentPeriod } from "@/lib/lms-enrollment-date";
import { requireStudentAdditionStudentAccess } from "@/lib/student-addition-access";

interface DropoutPayload {
  student_pk_id?: string | number;
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

async function resolveDropoutStudent(studentPkId: number) {
  return query<DropoutStudentRow>(
    `SELECT id, student_id, apaar_id, status
     FROM student
     WHERE id = $1
     LIMIT 1`,
    [studentPkId],
  );
}

// fallow-ignore-next-line complexity code-duplication
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body: DropoutPayload = await request.json();
    const studentPkId = Number(body.student_pk_id);

    if (!Number.isInteger(studentPkId) || studentPkId <= 0) {
      return NextResponse.json(
        { error: "student_pk_id is required" },
        { status: 400 },
      );
    }

    const access = await requireStudentAdditionStudentAccess(session, studentPkId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const matches = await resolveDropoutStudent(studentPkId);
    if (matches.length === 0) {
      return NextResponse.json(
        { error: "Student not found with the provided identifier" },
        { status: 404 },
      );
    }
    const student = matches[0];
    if (student.status === "dropout") {
      return NextResponse.json(
        { error: "Student is already marked as dropout" },
        { status: 400 },
      );
    }
    if (!student.student_id && !student.apaar_id) {
      return NextResponse.json(
        { error: "Student has no dropout identifier" },
        { status: 400 },
      );
    }

    const dbServiceUrl = process.env.DB_SERVICE_URL?.replace(/\/+$/, "");
    const dbServiceToken = process.env.DB_SERVICE_TOKEN;
    if (!dbServiceUrl || !dbServiceToken) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const requestBody: Record<string, string> = deriveLmsEnrollmentPeriod();

    if (student.student_id) {
      requestBody.student_id = student.student_id;
    } else if (student.apaar_id) {
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
          error: identifierError(student.student_id ?? undefined, student.apaar_id ?? undefined),
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
