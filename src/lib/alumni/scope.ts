import type { UserPermission } from "@/lib/permissions";

// A person's alumni scope as SQL, so queries narrow to it before any LIMIT or
// aggregation. Same rule as canAccessSchoolSync: level 3 reaches every school;
// otherwise the explicit School codes, any seat Schools in the resolved scope,
// and (level 2) the regions.

export interface ScopeSql {
  /** A boolean SQL expression ("TRUE" for level 3). */
  sql: string;
  params: unknown[];
}

/** Does this person reach every school (and so alumni with no school)? */
export const reachesAllSchools = (permission: UserPermission) => permission.level === 3;

/**
 * `codeColumn` / `regionColumn` are the school's columns in the query; bound
 * params are numbered from `$first`. A NULL code (no school) never matches
 * below level 3.
 */
export function schoolScopeSql(
  permission: UserPermission,
  codeColumn: string,
  regionColumn: string,
  first: number,
): ScopeSql {
  if (reachesAllSchools(permission)) return { sql: "TRUE", params: [] };
  const seatSchools = permission.scope?.schools instanceof Set ? [...permission.scope.schools] : [];
  const codes = [...new Set([...(permission.school_codes ?? []), ...seatSchools])];
  const regions = permission.level === 2 ? (permission.regions ?? []) : [];
  return {
    sql: `(${codeColumn} = ANY($${first}::text[]) OR ${regionColumn} = ANY($${first + 1}::text[]))`,
    params: [codes, regions],
  };
}
