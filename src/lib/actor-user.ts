// The acting user's `user.id`, for features that record who did something
// (Academic Mentorship, AI Test Insights). Server-only (`@/lib/db`).
import { query } from "@/lib/db";

/**
 * The permission's linked User (`user_permission.user_id`), otherwise the
 * lowest-id User with the same email, case-insensitive. Null when there is
 * neither.
 */
export async function actorUserId(email: string, linkedUserId: number | string | null | undefined): Promise<number | null> {
  if (linkedUserId != null) return Number(linkedUserId);
  const rows = await query<{ id: number | string }>(
    `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1`,
    [email],
  );
  return rows.length > 0 ? Number(rows[0].id) : null;
}
