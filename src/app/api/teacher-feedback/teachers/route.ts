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

// Subject-teaching seat roles only. Teacher Feedback rates classroom teachers,
// NOT the PM-family seats (pm/apm/spm/ph) that also live in centre_positions.
const SUBJECT_ROLES = ["physics", "chemistry", "maths", "biology", "apc", "subject_tbd"];

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
 * Subject teachers seated at a CENTRE (centre_positions -> staff/teacher),
 * filtered to subject roles. Teachers map to a centre, not a school, so a school
 * with both a CoE and a Nodal centre keeps its two cohorts separate.
 * Returns [] if the centre tables aren't present (older schema) so the caller
 * can fall back.
 */
async function getCentreSeatTeachers(centreId: number): Promise<FeedbackTeacher[]> {
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
      FROM centre_positions cp
      JOIN "user" u ON u.id = cp.user_id
      LEFT JOIN teacher t ON t.user_id = u.id
      LEFT JOIN subject sub ON sub.id = t.subject_id
      WHERE cp.centre_id = $1
        AND cp.deleted_at IS NULL
        AND cp.role = ANY($2::text[])
      ORDER BY cp.role, u.first_name NULLS LAST
      `,
      [centreId, SUBJECT_ROLES]
    );

    return rows.map((r) => ({
      id: r.teacher_id || r.hr_code,
      name: fullName(r.first_name, r.last_name, r.hr_code || r.teacher_id || "Unknown"),
      role: r.role,
      subject: r.subject,
      source: "centre_seat" as const,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/centre_positions|centres|relation .* does not exist/i.test(message)) {
      return [];
    }
    throw error;
  }
}

/**
 * Fallback: teachers from user_permission scoped to the centre's school. Used
 * only when the centre has no seated subject teachers (thin roster).
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

// GET /api/teacher-feedback/teachers?centre_id=NN
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

  const centreIdParam = request.nextUrl.searchParams.get("centre_id")?.trim();
  const centreId = Number(centreIdParam);
  if (!centreIdParam || !Number.isInteger(centreId)) {
    return NextResponse.json(
      { error: "centre_id query parameter is required" },
      { status: 400 }
    );
  }

  // Resolve the centre's school for the access check + fallback.
  const centreRows = await query<{ school_id: number | null; code: string | null; region: string | null }>(
    `SELECT c.school_id, s.code, s.region
     FROM centres c
     LEFT JOIN school s ON s.id = c.school_id
     WHERE c.id = $1 LIMIT 1`,
    [centreId]
  );
  const centre = centreRows[0];
  if (!centre || centre.school_id == null) {
    return NextResponse.json({ error: "Centre not found" }, { status: 404 });
  }
  if (!(await canAccessQuizSessionSchool(access.permission, centre.school_id))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Prefer the centre-seat subject teachers; fall back to user_permission.
  let teachers = await getCentreSeatTeachers(centreId);
  let source: FeedbackTeacher["source"] = "centre_seat";
  if (teachers.length === 0 && centre.code) {
    teachers = await getPermissionTeachers(centre.code, centre.region);
    source = "user_permission";
  }

  return NextResponse.json({ teachers, source });
}
