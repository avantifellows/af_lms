import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { canAccessQuizSessionSchool } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";

export interface FeedbackTeacher {
  /** Stable id for the teacher (employee_code / teacher_id when available). */
  id: string | null;
  name: string;
  role: string | null;
  subject: string | null;
  /** Where this came from, so the UI can hint when the roster is empty. */
  source: "centre_seat" | "user_permission";
}

interface SeatRow {
  hr_code: string | null;
  teacher_id: string | null;
  first_name: string | null;
  last_name: string | null;
  role: string | null;
  subject: string | null;
}

interface PermissionRow {
  email: string;
  full_name: string | null;
}

function fullName(first: string | null, last: string | null, fallback: string): string {
  const name = [first, last].filter(Boolean).join(" ").trim();
  return name || fallback;
}

/**
 * Teachers placed at this school's centre(s) via the centre-seat model
 * (school -> centres -> centre_positions -> staff/teacher). Returns [] if the
 * centre tables aren't present (older schema) so the caller can fall back.
 */
async function getCentreSeatTeachers(schoolCode: string): Promise<FeedbackTeacher[]> {
  try {
    const rows = await query<SeatRow>(
      `
      SELECT
        cp.hr_code,
        t.teacher_id,
        u.first_name,
        u.last_name,
        cp.role,
        (
          SELECT e->>'subject'
          FROM jsonb_array_elements(sub.name) e
          WHERE e->>'lang_code' = 'en'
          LIMIT 1
        ) AS subject
      FROM school s
      JOIN centres c ON c.school_id = s.id
      JOIN centre_positions cp ON cp.centre_id = c.id AND cp.deleted_at IS NULL
      JOIN "user" u ON u.id = cp.user_id
      LEFT JOIN teacher t ON t.user_id = u.id
      LEFT JOIN subject sub ON sub.id = t.subject_id
      WHERE s.code = $1
      ORDER BY cp.role, u.first_name NULLS LAST
      `,
      [schoolCode]
    );

    return rows.map((r) => ({
      id: r.teacher_id || r.hr_code,
      name: fullName(r.first_name, r.last_name, r.hr_code || r.teacher_id || "Unknown"),
      role: r.role,
      subject: r.subject,
      source: "centre_seat" as const,
    }));
  } catch (error) {
    // Centre tables absent on this DB → signal "no centre data" to fall back.
    const message = error instanceof Error ? error.message : "";
    if (/centre_positions|centres|relation .* does not exist/i.test(message)) {
      return [];
    }
    throw error;
  }
}

/**
 * Fallback: teachers from user_permission scoped to this school (the legacy
 * source used by /api/pm/teachers). Used only when the centre-seat model yields
 * nothing for the school.
 */
async function getPermissionTeachers(
  schoolCode: string,
  schoolRegion: string | null
): Promise<FeedbackTeacher[]> {
  const rows = await query<PermissionRow>(
    `
    SELECT email, full_name
    FROM user_permission
    WHERE role = 'teacher'
      AND (
        school_codes @> ARRAY[$1]::TEXT[]
        OR ($2::TEXT IS NOT NULL AND regions @> ARRAY[$2]::TEXT[])
      )
    ORDER BY full_name NULLS LAST, email
    `,
    [schoolCode, schoolRegion]
  );

  return rows.map((r) => ({
    id: r.email,
    name: r.full_name || r.email,
    role: null,
    subject: null,
    source: "user_permission" as const,
  }));
}

// GET /api/teacher-feedback/teachers?school_code=XXXXX
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireTeacherFeedbackAccess(email, "edit");
  if (!access.ok) {
    return access.response;
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return NextResponse.json(
      { error: "school_code query parameter is required" },
      { status: 400 }
    );
  }

  const schoolRows = await query<{ id: number; region: string | null }>(
    `SELECT id, region FROM school WHERE code = $1 LIMIT 1`,
    [schoolCode]
  );
  const school = schoolRows[0];
  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  if (!(await canAccessQuizSessionSchool(access.permission, school.id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Prefer the centre-seat roster; fall back to user_permission if it's empty.
  let teachers = await getCentreSeatTeachers(schoolCode);
  let source: FeedbackTeacher["source"] = "centre_seat";
  if (teachers.length === 0) {
    teachers = await getPermissionTeachers(schoolCode, school.region);
    source = "user_permission";
  }

  return NextResponse.json({ teachers, source });
}
