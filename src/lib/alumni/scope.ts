import type { UserPermission } from "@/lib/permissions";

// A person's alumni scope as SQL, so queries narrow to it before any LIMIT or
// aggregation. Same rule as canAccessSchoolSync: level 3 reaches every school;
// otherwise any seat Schools in the resolved scope, plus the explicit School
// codes at level 1 or the regions at level 2. Leftover codes on a level-2 row
// grant nothing there, so they mustn't here either.

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
  const explicitCodes = permission.level === 1 ? (permission.school_codes ?? []) : [];
  const codes = [...new Set([...explicitCodes, ...seatSchools])];
  const regions = permission.level === 2 ? (permission.regions ?? []) : [];
  return {
    sql: `(${codeColumn} = ANY($${first}::text[]) OR ${regionColumn} = ANY($${first + 1}::text[]))`,
    params: [codes, regions],
  };
}
