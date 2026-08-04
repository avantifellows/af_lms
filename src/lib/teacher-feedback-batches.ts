import { query } from "@/lib/db";

/**
 * Teacher Feedback — the batches a feedback round may be attached to.
 *
 * A school can host more than one centre (a CoE and a Nodal), and each centre
 * runs its *own* cohorts. Scoping batches by school alone therefore offers a
 * PM the other centre's batches: at JNV Chandrapur, setting up feedback for
 * Nodal teachers would list the two CoE class batches as well, so CoE students
 * could be asked to rate teachers who never taught them.
 *
 * The discriminator is the **programme**. `centres.program_id` and
 * `batch.program_id` are both live operational columns (CoE = 1, Nodal = 2,
 * Punjab CoE/Nodal = 74/94, ...), and no school in production has two active
 * centres sharing a programme — so (school, centre programme) selects exactly
 * one centre's cohorts.
 *
 * Deliberately NOT used here:
 *   - `centre_batch` — present in production but only partially seeded (47 of
 *     56 seated centres) and known to contain at least one cross-school link,
 *     so trusting it would silently narrow or corrupt the picker today.
 *   - `batch.metadata->>'centre'` — never backfilled (no batch row carries it).
 *
 * When `centre_batch` becomes authoritative this module is the single place to
 * switch, and the route contract does not change.
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
 * Resolve a centre to the scope needed to list its batches. Returns null when
 * the centre does not exist, is inactive, or is not attached to a school —
 * callers must treat that as "no batches", never as "all batches".
 *
 * `centres.id` / `school_id` / `program_id` are bigints, which node-pg returns
 * as strings, so every one is coerced on read.
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
 * Class batches belonging to one centre's cohort, plus any parent batches
 * needed to render the hierarchy whole.
 *
 * Fails closed on a centre with no `program_id`: without it there is nothing to
 * discriminate the school's centres by, and returning every school batch is the
 * exact cross-centre leak this function exists to prevent.
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

  // Parent (quiz) batches are shared across schools, so they are usually not in
  // the school-scoped result. The picker needs them to know which rows are
  // class batches (parent_id !== null and not itself a parent).
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
     WHERE b.id = ANY($1::int[])
     ORDER BY b.name`,
    [missing]
  );
  return batches.concat(parents);
}

/**
 * Are all of these class batch ids inside the centre's cohort? Used to validate
 * a setup request, so a crafted payload cannot attach another centre's — or
 * another school's — batches to a feedback session.
 *
 * Requires EVERY id to match: proving that *one* submitted batch is in scope
 * would let valid and foreign ids be mixed in a single request.
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
