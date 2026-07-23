import type { PoolClient } from "pg";
import { PROGRAM_IDS } from "./constants";
import { query } from "./db";
import { PM_SEAT_ROLES } from "./staff-shared";

type EligibilityLookup =
  | { email: string; userId?: never; schoolId: number; client?: PoolClient }
  | { userId: number; email?: never; schoolId: number; client: PoolClient };

export async function findEligibleHolisticMentorUserId(
  lookup: EligibilityLookup
): Promise<number | null> {
  const params = [
    "userId" in lookup ? lookup.userId : null,
    "email" in lookup ? lookup.email : null,
    lookup.schoolId,
    PROGRAM_IDS.COE,
    [...PM_SEAT_ROLES],
  ];
  const sql = `SELECT DISTINCT u.id AS user_id
     FROM teacher t
     JOIN "user" u ON u.id = t.user_id
     JOIN user_permission up
       ON up.revoked_at IS NULL
      AND up.role = 'teacher'
      AND (up.user_id = u.id OR LOWER(up.email) = LOWER(u.email))
     JOIN centre_positions cp
       ON cp.user_id = u.id
      AND cp.deleted_at IS NULL
      AND NOT (cp.role = ANY($5::text[]))
     JOIN centres c
       ON c.id = cp.centre_id
      AND c.is_active IS TRUE
     WHERE (
         ($1::bigint IS NOT NULL AND u.id = $1)
         OR ($2::text IS NOT NULL AND LOWER(up.email) = LOWER($2))
       )
       AND c.school_id = $3
       AND c.program_id = $4
       AND t.is_af_teacher = true
       AND t.exit_date IS NULL
     LIMIT 1`;
  const rows = lookup.client
    ? (await lookup.client.query<{ user_id: number | string }>(sql, params)).rows
    : await query<{ user_id: number | string }>(sql, params);
  return rows[0] ? Number(rows[0].user_id) : null;
}
