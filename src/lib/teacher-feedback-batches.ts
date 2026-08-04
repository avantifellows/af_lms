import { query } from "@/lib/db";

/**
 * Teacher Feedback — the batches a feedback round may be attached to.
 *
 * Scoped by (school, centre programme), not by school: a school can host both a
 * CoE and a Nodal centre, each with its own cohorts, so a school-wide list offers
 * the other centre's batches. `centre_batch` is deliberately not used — it is
 * only partially seeded in production. See `.mex/context/teacher-feedback.md`.
 */

export interface FeedbackBatchRow {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
}

export interface CentreScope {
  centreId: number;
  schoolId: number;
  /** `centres.program_id`; null for online/foundation centres. */
  programId: number | null;
}

/**
 * Null when the centre is missing, inactive, or school-less — callers must treat
 * that as "no batches", never "all batches". Bigints are coerced (pg returns
 * them as strings).
 */
export async function getCentreScope(centreId: number): Promise<CentreScope | null> {
  const rows = await query<{
    id: number | string;
    school_id: number | string | null;
    program_id: number | string | null;
  }>(
    `SELECT id, school_id, program_id
     FROM centres
     WHERE id = $1 AND is_active = true
     LIMIT 1`,
    [centreId]
  );
  const centre = rows[0];
  if (!centre || centre.school_id == null) return null;
  return {
    centreId: Number(centre.id),
    schoolId: Number(centre.school_id),
    programId: centre.program_id == null ? null : Number(centre.program_id),
  };
}

/**
 * One centre's cohort, plus parent batches so the hierarchy renders whole. Fails
 * closed without a `program_id` — returning all school batches is the leak this
 * exists to prevent.
 */
export async function getBatchesForCentre(
  scope: CentreScope
): Promise<FeedbackBatchRow[]> {
  if (scope.programId === null) return [];

  const batches = await query<FeedbackBatchRow>(
    `SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
     FROM school_batch sb
     JOIN batch b ON b.id = sb.batch_id
     WHERE sb.school_id = $1
       AND b.program_id = $2
     ORDER BY b.name`,
    [scope.schoolId, scope.programId]
  );

  // Parent batches are shared across schools, so they are usually absent above;
  // the picker needs them to tell class batches apart.
  const parentIds = Array.from(
    new Set(
      batches
        .map((b) => b.parent_id)
        .filter((id): id is number => id !== null)
    )
  );
  const known = new Set(batches.map((b) => b.id));
  const missing = parentIds.filter((id) => !known.has(id));
  if (missing.length === 0) return batches;

  const parents = await query<FeedbackBatchRow>(
    `SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
     FROM batch b
     WHERE b.id = ANY($1::bigint[])
     ORDER BY b.name`,
    [missing]
  );
  return batches.concat(parents);
}

/**
 * Validates a setup request's batches. EVERY id must match: checking that *one*
 * is in scope would let a payload mix valid and foreign batches.
 */
export async function centreOwnsAllBatches(
  scope: CentreScope,
  classBatchIds: string[]
): Promise<boolean> {
  if (classBatchIds.length === 0) return false;
  if (scope.programId === null) return false;

  const rows = await query<{ batch_id: string }>(
    `SELECT b.batch_id
     FROM school_batch sb
     JOIN batch b ON b.id = sb.batch_id
     WHERE sb.school_id = $1
       AND b.program_id = $2
       AND b.batch_id = ANY($3::text[])`,
    [scope.schoolId, scope.programId, classBatchIds]
  );
  const inScope = new Set(rows.map((r) => r.batch_id));
  return classBatchIds.every((id) => inScope.has(id));
}
