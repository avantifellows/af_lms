import type { UserPermission } from "./permissions";

export interface HolisticSchoolScopePredicate {
  clause: string;
  params: unknown[];
}

function hasProgramWideSchoolScope(permission: UserPermission) {
  return permission.role === "admin" ||
    permission.role === "holistic_mentorship_admin" ||
    permission.level === 3 ||
    permission.scope?.schools === "all";
}

function levelOnePredicate(
  permission: UserPermission,
  schoolCodes: string[],
  schoolCodeColumn: string,
  startIndex: number,
): HolisticSchoolScopePredicate | null {
  if (permission.level !== 1 || schoolCodes.length === 0) return null;
  return {
    clause: `${schoolCodeColumn} = ANY($${startIndex}::text[])`,
    params: [schoolCodes],
  };
}

function levelTwoPredicate(
  permission: UserPermission,
  resolvedSchools: string[] | null,
  columns: { schoolCode: string; schoolRegion: string },
  startIndex: number,
): HolisticSchoolScopePredicate | null {
  if (permission.level !== 2) return null;
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (permission.regions?.length) {
    params.push(permission.regions);
    conditions.push(
      `COALESCE(${columns.schoolRegion}, '') = ANY($${startIndex + params.length - 1}::text[])`,
    );
  }
  if (resolvedSchools?.length) {
    params.push(resolvedSchools);
    conditions.push(
      `${columns.schoolCode} = ANY($${startIndex + params.length - 1}::text[])`,
    );
  }
  if (conditions.length === 0) return null;
  return {
    clause: conditions.length === 1 ? conditions[0] : `(${conditions.join(" OR ")})`,
    params,
  };
}

export function buildHolisticSchoolScopePredicate(
  permission: UserPermission,
  options: {
    startIndex?: number;
    schoolCodeColumn?: string;
    schoolRegionColumn?: string;
  } = {},
): HolisticSchoolScopePredicate {
  if (hasProgramWideSchoolScope(permission)) {
    return { clause: "", params: [] };
  }

  const startIndex = options.startIndex ?? 1;
  const schoolCodeColumn = options.schoolCodeColumn ?? "school_code";
  const schoolRegionColumn = options.schoolRegionColumn ?? "school_region";
  const resolvedSchools = permission.scope
    ? [...permission.scope.schools]
    : null;
  const schoolCodes = resolvedSchools ?? permission.school_codes ?? [];
  const schoolPredicate = levelOnePredicate(
    permission,
    schoolCodes,
    schoolCodeColumn,
    startIndex,
  );
  if (schoolPredicate) return schoolPredicate;
  const regionPredicate = levelTwoPredicate(
    permission,
    resolvedSchools,
    { schoolCode: schoolCodeColumn, schoolRegion: schoolRegionColumn },
    startIndex,
  );
  if (regionPredicate) return regionPredicate;

  return { clause: "1 = 0", params: [] };
}
