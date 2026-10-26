import { query } from "./db";

export interface CmsTestLanguage {
  code: string;
  name: string;
}

// Regional (non-English) languages present on any of each CMS test's problems. English is
// always available, so it is not listed.
export async function getCmsTestLanguages(
  testIds: number[]
): Promise<Map<number, CmsTestLanguage[]>> {
  const byTest = new Map<number, CmsTestLanguage[]>();
  if (testIds.length === 0) return byTest;

  const rows = await query<{ test_id: number | string; code: string; name: string }>(
    `SELECT r.id AS test_id, l.code, l.name
       FROM resource r
       CROSS JOIN LATERAL jsonb_path_query(
         r.type_params, 'lax $.subjects[*].sections[*].*.problems[*].id'
       ) AS p(problem_id)
       JOIN problem_lang pl ON pl.res_id = (p.problem_id #>> '{}')::bigint
       JOIN language l ON l.id = pl.lang_id
      WHERE r.id = ANY($1::bigint[]) AND l.code <> 'en'
      GROUP BY r.id, l.code, l.name
      ORDER BY r.id, l.code`,
    [testIds]
  );
  for (const row of rows) {
    const id = Number(row.test_id);
    byTest.set(id, [...(byTest.get(id) ?? []), { code: row.code, name: row.name }]);
  }
  return byTest;
}
