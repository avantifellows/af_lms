import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface StudentUpdatePayload {
  first_name?: string;
  last_name?: string;
  phone?: string;
  gender?: string;
  date_of_birth?: string;
  category?: string;
  stream?: string;
  student_id?: string;
  apaar_id?: string;
  grade_id?: string | null; // grade_id for student table (from grade table)
  group_id?: string; // group_id for grade enrollment_record update (from group table)
  batch_group_id?: string; // group_id for batch enrollment_record update (from group table)
  user_id?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return NextResponse.json(
      { error: "Student ID is required" },
      { status: 400 }
    );
  }

  try {
    const body: StudentUpdatePayload = await request.json();

    // Extract group_id, batch_group_id, and user_id for separate handling (enrollments)
    const { group_id, batch_group_id, user_id, ...studentFields } = body;

    const results: { student?: unknown; grade?: unknown; batch?: unknown } = {};
    const errors: string[] = [];

    // Update student fields if any are provided
    const hasStudentFields = Object.keys(studentFields).length > 0;
    if (hasStudentFields) {
      const studentResponse = await fetch(`${DB_SERVICE_URL}/student/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
        },
        body: JSON.stringify(studentFields),
      });

      if (!studentResponse.ok) {
        const errorText = await studentResponse.text();
        console.error("DB service error (student update):", errorText);
        errors.push(`Failed to update student: ${errorText}`);
      } else {
        results.student = await studentResponse.json();
      }
    }

    // Update grade via PATCH /update-group-user-by-type if group_id is provided (and not empty)
    const hasGroupId = group_id && group_id.trim() !== "";
    const hasUserId = user_id && user_id.trim() !== "";

    if (hasGroupId && hasUserId) {
      const gradePayload = {
        group_id: group_id,
        user_id: user_id,
        type: "grade",
      };

      const gradeResponse = await fetch(
        `${DB_SERVICE_URL}/update-group-user-by-type`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
          },
          body: JSON.stringify(gradePayload),
        }
      );

      if (!gradeResponse.ok) {
        const errorText = await gradeResponse.text();
        console.error("DB service error (grade update):", errorText);
        errors.push(`Failed to update grade: ${errorText}`);
      } else {
        results.grade = await gradeResponse.json();
      }
    } else if (hasGroupId && !hasUserId) {
      errors.push("user_id is required to update grade");
    }

    // Update batch via PATCH /update-group-user-by-type if batch_group_id is provided
    const hasBatchGroupId = batch_group_id && batch_group_id.trim() !== "";

    if (hasBatchGroupId && hasUserId) {
      const batchPayload = {
        group_id: batch_group_id,
        user_id: user_id,
        type: "batch",
      };

      const batchResponse = await fetch(
        `${DB_SERVICE_URL}/update-group-user-by-type`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
          },
          body: JSON.stringify(batchPayload),
        }
      );

      if (!batchResponse.ok) {
        const errorText = await batchResponse.text();
        console.error("DB service error (batch update):", errorText);
        errors.push(`Failed to update batch: ${errorText}`);
      } else {
        results.batch = await batchResponse.json();
      }
    } else if (hasBatchGroupId && !hasUserId) {
      errors.push("user_id is required to update batch");
    }

    // Return appropriate response
    if (errors.length > 0 && Object.keys(results).length === 0) {
      return NextResponse.json(
        { error: errors.join("; ") },
        { status: 400 }
      );
    }

    if (errors.length > 0) {
      return NextResponse.json({
        ...results,
        warnings: errors,
      });
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error updating student:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
