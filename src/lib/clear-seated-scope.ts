/**
 * One-time data migration for strict per-user exclusivity.
 *
 * Once centre seats are the source of truth for a seated person's school scope
 * (see resolveScope + the seat-assignment clearing in staff-admin), any explicit
 * `user_permission.school_codes`/`regions` they still carry from before the
 * cutover is stale and must be cleared — otherwise a later seat move leaves the
 * old school reachable (the move-doesn't-revoke bug).
 *
 * This clears explicit scope for every active person holding ≥1 active seat. It
 * is LOUD about "stranded" people: those whose `school_codes` include a school
 * that NO seat covers (e.g. the centre isn't created/linked yet). Clearing their
 * scope removes access to those schools until ops creates the missing seats, so
 * the dry-run worklist is the ops to-do list. Idempotent: re-running clears
 * nothing once scopes are already null.
 */
import { query } from "./db";

export type ClearSeatedScopeMode = "dry-run" | "apply";

export interface SeatedScopeRow {
  userId: number;
  email: string;
  schoolCodes: string[];
  regions: string[];
  seatSchoolCodes: string[];
  // school_codes not covered by any of this person's seats — access lost on clear.
  uncoveredCodes: string[];
}

export interface ClearSeatedScopeReport {
  mode: ClearSeatedScopeMode;
  ok: boolean;
  error?: string;
  // Seated people still carrying explicit school_codes/regions (would be / were cleared).
  usersWithExplicitScope: number;
  usersCleared: number;
  // Seated people who lose access to ≥1 uncovered school on clear (ops worklist).
  strandedUsers: SeatedScopeRow[];
  rows: SeatedScopeRow[];
}

export async function runClearSeatedScope(opts: {
  mode: ClearSeatedScopeMode;
}): Promise<ClearSeatedScopeReport> {
  // Every active (non-revoked) person holding ≥1 active seat, with their explicit
  // scope and the school codes their seats cover (centre_positions → centres.school_id).
  const raw = await query<{
    user_id: number | string;
    email: string;
    school_codes: string[] | null;
    regions: string[] | null;
    seat_school_codes: string[] | null;
  }>(
    `SELECT up.user_id,
            lower(up.email) AS email,
            up.school_codes,
            up.regions,
            array_agg(DISTINCT s.code) FILTER (WHERE s.code IS NOT NULL) AS seat_school_codes
     FROM user_permission up
     JOIN centre_positions cp ON cp.user_id = up.user_id AND cp.deleted_at IS NULL
     LEFT JOIN centres c ON c.id = cp.centre_id
     LEFT JOIN school s ON s.id = c.school_id
     WHERE up.revoked_at IS NULL
     GROUP BY up.user_id, up.email, up.school_codes, up.regions
     ORDER BY lower(up.email)`
  );

  const rows: SeatedScopeRow[] = raw.map((r) => {
    const schoolCodes = r.school_codes ?? [];
    const seatSchoolCodes = r.seat_school_codes ?? [];
    const seatSet = new Set(seatSchoolCodes);
    return {
      userId: Number(r.user_id),
      email: r.email,
      schoolCodes,
      regions: r.regions ?? [],
      seatSchoolCodes,
      uncoveredCodes: schoolCodes.filter((code) => !seatSet.has(code)),
    };
  });

  const toClear = rows.filter(
    (r) => r.schoolCodes.length > 0 || r.regions.length > 0
  );
  const strandedUsers = rows.filter((r) => r.uncoveredCodes.length > 0);

  let usersCleared = toClear.length; // dry-run = would-clear count
  if (opts.mode === "apply" && toClear.length > 0) {
    const cleared = await query<{ user_id: number }>(
      `UPDATE user_permission up
       SET school_codes = NULL, regions = NULL, updated_at = now()
       WHERE up.revoked_at IS NULL
         AND (up.school_codes IS NOT NULL OR up.regions IS NOT NULL)
         AND EXISTS (
           SELECT 1 FROM centre_positions cp
           WHERE cp.user_id = up.user_id AND cp.deleted_at IS NULL
         )
       RETURNING up.user_id`
    );
    usersCleared = cleared.length;
  }

  return {
    mode: opts.mode,
    ok: true,
    usersWithExplicitScope: toClear.length,
    usersCleared,
    strandedUsers,
    rows,
  };
}
