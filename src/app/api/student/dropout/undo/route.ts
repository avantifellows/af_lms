import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { PROGRAM_IDS } from "@/lib/constants";
import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { requireStudentDropoutUndoAccess } from "@/lib/student-addition-access";

interface StudentRow {
  student_id: string | null;
  pen_number: string | null;
}

const SAFE_ERRORS = new Set([
  "This dropout cannot be undone",
  "The previous NVS batch no longer exists",
  "The previous NVS batch is closed",
  "Student already has an active NVS batch",
  "Student is no longer in the same school",
]);

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { student_pk_id: rawId } = await request.json();
    const studentPkId = Number(rawId);
    if (!Number.isInteger(studentPkId) || studentPkId <= 0) {
      return NextResponse.json({ error: "student_pk_id is required" }, { status: 400 });
    }

    const access = await requireStudentDropoutUndoAccess(session, studentPkId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const [student] = await query<StudentRow>(
      `SELECT student_id, pen_number FROM student WHERE id = $1 LIMIT 1`,
      [studentPkId],
    );
    if (!student || (!student.student_id && !student.pen_number)) {
      return NextResponse.json({ error: "Student has no identifier" }, { status: 400 });
    }

    const dbService = getDbServiceConfig();
    if (!dbService) {
      return NextResponse.json({ error: "DB Service is not configured" }, { status: 500 });
    }

    const response = await fetch(`${dbService.baseUrl}/lms/students/undo-program-dropout`, {
      method: "PATCH",
      headers: dbService.headers,
      body: JSON.stringify({
        ...(student.student_id
          ? { student_id: student.student_id }
          : { pen_number: student.pen_number }),
        actor: access.actor,
        school: access.school,
        program_id: PROGRAM_IDS.NVS,
      }),
    });

    if (response.ok) return NextResponse.json({ success: true });

    const body = await response.json().catch(() => ({})) as { errors?: unknown };
    const message = typeof body.errors === "string" && SAFE_ERRORS.has(body.errors)
      ? body.errors
      : "Failed to undo dropout";
    return NextResponse.json({ error: message }, { status: response.status });
  } catch (error) {
    console.error("Error undoing student dropout:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
