import { query } from "@/lib/db";
import { PROGRAM_IDS, PROGRAM_IDS_ORDERED } from "@/lib/constants";

/**
 * Program ids the LMS should surface students for.
 *
 * D22 item (c): `PROGRAM_IDS` in constants.ts is hand-maintained, so onboarding a
 * centre program used to need a code edit — and when it was missed, students went
 * invisible rather than erroring. GPUC Shimoga (Karnataka CoE, program 97) sat
 * with 73 correctly-enrolled students and an empty Enrollment tab because of it.
 *
 * The set is `centres`-derived UNION the constants, deliberately additive:
 * - The union (not a replacement) matters because **NVS (64) has no `centres`
 *   row** — a pure DB list would filter every NVS student out of the roster.
 * - It can only ever add ids, so this cannot hide a program that works today.
 *
 * Ordering follows `PROGRAM_IDS_ORDERED` (JNV first, then non-JNV centres) with
 * any DB-only ids appended in id order, so the page's program tabs keep their
 * canonical order.
 *
 * Server-only: reads Postgres. Client components must keep importing the
 * constants directly.
 */

let cachedIds: Promise<number[]> | null = null;

async function loadCentreProgramIds(): Promise<number[]> {
  // Not filtered on is_physical: a program is LMS-managed if it has a centre at
  // all, and today active/active-physical/all-centres yield the same set anyway.
  // program_id IS NULL skips the one stray centre row with no program.
  const rows = await query<{ program_id: number | string }>(
    `SELECT DISTINCT program_id
     FROM centres
     WHERE is_active = true AND program_id IS NOT NULL`,
  );
  return rows
    .map((r) => Number(r.program_id))
    .filter((id) => Number.isFinite(id));
}

function merge(centreIds: number[]): number[] {
  const known = new Set<number>(Object.values(PROGRAM_IDS));
  const extras = centreIds.filter((id) => !known.has(id)).sort((a, b) => a - b);
  return [...PROGRAM_IDS_ORDERED, ...extras];
}

export async function getLmsSupportedProgramIds(): Promise<number[]> {
  cachedIds ??= loadCentreProgramIds()
    .then(merge)
    .catch((err) => {
      // Don't cache the failure, and don't let a DB hiccup empty the Enrollment
      // tab — degrade to the compiled-in list, which is never worse than the
      // pre-D22c behaviour.
      cachedIds = null;
      console.error("getLmsSupportedProgramIds: falling back to PROGRAM_IDS", err);
      return [...PROGRAM_IDS_ORDERED];
    });
  return cachedIds;
}

// Test seam (mirrors curriculum-schema.ts).
export function resetLmsSupportedProgramIdsCache(): void {
  cachedIds = null;
}
