import { query } from "@/lib/db";
import type { UserPermission } from "@/lib/permissions";

/**
 * Building blocks for the teacher → centre → batch model.
 *
 * A batch belongs to a centre via the `centre_batch` join table (LMS-owned,
 * written direct-to-Postgres like `centre_positions` / `centre_students`).
 * These helpers deliberately keep school OUT of the path: batch selection is
 * scoped by the centre a teacher holds a seat at, not by the batch's school.
 *
 * The consuming UI (a teacher-scoped "my centres" surface) lands on a separate
 * branch that coordinates with teacher-feedback; this module is the shared
 * query + access plumbing it will call.
 */

export interface CentreBatchRow {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
}

export interface CentreListItem {
  id: number;
  name: string;
  school_name: string | null;
  batch_count: number;
}

/**
 * Centres the user may see on the "My Centres" surface, with a label (school
 * name) and a count of actively-linked batches. Scope comes from the resolved
 * permission's centre set (centre_positions seats); admins ("all") get every
 * active centre. Returns [] for a user with no centre scope.
 */
export async function centresForUserList(
  centres: Set<number> | "all"
): Promise<CentreListItem[]> {
  const scopeAll = centres === "all";
  if (!scopeAll && centres.size === 0) return [];

  const ids = scopeAll ? [] : Array.from(centres);
  return query<CentreListItem>(
    `SELECT c.id,
            c.name,
            s.name AS school_name,
            count(cb.id) FILTER (WHERE cb.deleted_at IS NULL)::int AS batch_count
     FROM centres c
     LEFT JOIN school s ON s.id = c.school_id
     LEFT JOIN centre_batch cb ON cb.centre_id = c.id
     WHERE c.is_active = true
       AND ($1::boolean OR c.id = ANY($2::bigint[]))
     GROUP BY c.id, c.name, s.name
     ORDER BY c.name`,
    [scopeAll, ids]
  );
}

/**
 * Batches linked to a centre through `centre_batch` (active links only).
 * Ordered by name for stable UI rendering. Returns [] for an unlinked centre.
 */
export async function batchesForCentre(centreId: number): Promise<CentreBatchRow[]> {
  return query<CentreBatchRow>(
    `SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
     FROM centre_batch cb
     JOIN batch b ON b.id = cb.batch_id
     WHERE cb.centre_id = $1 AND cb.deleted_at IS NULL
     ORDER BY b.name`,
    [centreId]
  );
}

/**
 * Pure teacher → centre access: does this user hold an active seat at the
 * centre? Uses the resolved permission's centre scope (populated by
 * getResolvedPermission via centre_positions), so no school permission is
 * involved. Level-3 admins carry scope.centres === "all".
 *
 * Callers MUST pass a *resolved* permission (getResolvedPermission), not a bare
 * getUserPermission result — the latter has no `scope` and would always deny.
 */
export function userCanAccessCentre(
  permission: UserPermission,
  centreId: number
): boolean {
  const centres = permission.scope?.centres;
  if (!centres) return false;
  if (centres === "all") return true;
  return centres.has(centreId);
}
