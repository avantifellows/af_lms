import { query } from "./db";
import { PM_SEAT_ROLES } from "./staff-shared";

export interface VisitTeacher {
  id: number;
  email: string;
  full_name: string;
}

export async function getVisitTeachersForSchool(
  schoolCode: string
): Promise<VisitTeacher[]> {
  return query<VisitTeacher>(
    `WITH visit_teachers AS (
       SELECT DISTINCT ON (up.id)
         up.id,
         up.email,
         COALESCE(
           NULLIF(BTRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
           NULLIF(BTRIM(up.full_name), ''),
           up.email
         ) AS full_name
       FROM teacher t
       JOIN "user" u ON u.id = t.user_id
       JOIN user_permission up
         ON up.revoked_at IS NULL
        AND (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
       JOIN centre_positions cp
         ON cp.user_id = u.id
        AND cp.deleted_at IS NULL
        AND NOT (cp.role = ANY($2::text[]))
       JOIN centres c
         ON c.id = cp.centre_id
        AND c.is_active IS TRUE
       JOIN school s ON s.id = c.school_id
       WHERE s.code = $1
         AND t.is_af_teacher = true
         AND t.exit_date IS NULL
       ORDER BY up.id
     )
     SELECT id, email, full_name
     FROM visit_teachers
     ORDER BY full_name ASC, email ASC`,
    [schoolCode, [...PM_SEAT_ROLES]]
  );
}
