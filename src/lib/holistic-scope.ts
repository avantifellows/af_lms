import type { UserPermission } from "./permissions";

export interface HolisticSchoolScopePredicate {
  clause: string;
  params: unknown[];
}

export function buildHolisticSchoolScopePredicate(
  permission: UserPermission,
  options: {
    startIndex?: number;
    schoolCodeColumn?: string;
    schoolRegionColumn?: string;
  } = {},
): HolisticSchoolScopePredicate {
  if (
    permission.role === "admin" ||
    permission.role === "holistic_mentorship_admin" ||
    permission.level === 3 ||
    permission.scope?.schools === "all"
  ) {
    return { clause: "", params: [] };
  }

  const startIndex = options.startIndex ?? 1;
  const schoolCodeColumn = options.schoolCodeColumn ?? "school_code";
  const schoolRegionColumn = options.schoolRegionColumn ?? "school_region";
  const resolvedSchools = permission.scope
    ? [...permission.scope.schools]
    : null;
  const schoolCodes = resolvedSchools ?? permission.school_codes ?? [];
  if (permission.level === 1 && schoolCodes.length) {
    return {
      clause: `${schoolCodeColumn} = ANY($${startIndex}::text[])`,
      params: [schoolCodes],
    };
  }
  if (permission.level === 2) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (permission.regions?.length) {
      params.push(permission.regions);
      conditions.push(
        `COALESCE(${schoolRegionColumn}, '') = ANY($${startIndex + params.length - 1}::text[])`,
      );
    }
    if (resolvedSchools?.length) {
      params.push(resolvedSchools);
      conditions.push(
        `${schoolCodeColumn} = ANY($${startIndex + params.length - 1}::text[])`,
      );
    }
    if (conditions.length) {
      return {
        clause: conditions.length === 1 ? conditions[0] : `(${conditions.join(" OR ")})`,
        params,
      };
    }
  }

  return { clause: "1 = 0", params: [] };
}
