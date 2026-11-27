import type { Pool } from "pg";

/**
 * A fixture's reader of one id: runs `sql` and returns the first row's `id`,
 * or throws "<fixture> fixture: <what> not found" when there is no row.
 */
export function fixtureIdReader(fixture: string) {
  return async function oneId(pool: Pool, sql: string, params: unknown[], what: string): Promise<number> {
    const result = await pool.query<{ id: number | string }>(sql, params);
    if (result.rows.length === 0) throw new Error(`${fixture} fixture: ${what} not found`);
    return Number(result.rows[0].id);
  };
}
