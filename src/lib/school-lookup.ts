import { query } from "@/lib/db";

/** The School identity an API route needs to gate on and scope its reads to. */
export interface VisibleSchool {
  id: string;
  code: string;
  region: string | null;
}

/**
 * Resolve a School by UDISE or code, as the School page's `getSchoolByCode`
 * does: visible Schools are the historical JNV set PLUS any School linked to
 * an active centre (the non-JNV rollout — Punjab CoE meritorious, EMRS).
 *
 * A route that filters on `af_school_category = 'JNV'` instead 404s for the
 * centre Schools that open perfectly well on the page itself, which is what
 * left "% Docs" stuck on "—" for them (#338). Share this rather than writing
 * the predicate a fourth time.
 */
export async function findVisibleSchool(
  code: string,
): Promise<VisibleSchool | null> {
  const rows = await query<VisibleSchool>(
    `SELECT s.id, s.code, s.region
     FROM school s
     WHERE (
         s.af_school_category = 'JNV'
         OR EXISTS (SELECT 1 FROM centres c WHERE c.school_id = s.id AND c.is_active)
       )
       AND (s.udise_code = $1 OR s.code = $1)`,
    [code],
  );
  return rows[0] ?? null;
}
