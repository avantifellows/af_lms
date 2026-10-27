// The Visits in view on the School Visit Summary (server-only: reads through `@/lib/db`).
// Every Visit Summary query — the Visits list, the School-wise rows, both tabs' stat cards and the
// Region/School/PM filter options — builds its WHERE clause here, so they all agree on which Visits are in view.
import { query } from "@/lib/db";
import { REQUIRED_ACTION_TYPE_VALUES } from "@/lib/visit-actions";
import { resolvePresetDateRange } from "@/lib/visit-summary";
import { buildVisitSummaryScopePredicate, type VisitsActor } from "@/lib/visits-policy";

export type VisitSummaryStatusFilter = "in_progress" | "completed";
export type ActionCompletionBucketFilter = "none" | "partial" | "all_present" | "all_complete";
// The filter an option list leaves out, so picking a School never hides the other Schools.
export type VisitSummaryFilterExclusion = "regions" | "schools" | "pms";

// The `regions` value that matches Schools with no region (`school.region IS NULL`): non-JNV Schools.
const NO_REGION_FILTER_VALUE = "__none__";
const NO_REGION_FILTER_LABEL = "No region (non-JNV)";

export interface VisitSummaryFilters {
  regions: string[];
  schools: string[];
  pms: string[];
  status?: VisitSummaryStatusFilter;
  from?: string;
  to?: string;
  preset?: string;
  bucket?: ActionCompletionBucketFilter;
  forceEmpty: boolean;
}

export interface VisitSummaryFilterParams {
  regions?: string;
  schools?: string;
  pms?: string;
  status?: string;
  from?: string;
  to?: string;
  preset?: string;
  bucket?: string;
}

export interface VisitSummaryWhere {
  whereSql: string;
  joinSql: string;
  params: unknown[];
}

export interface RegionFilterOption {
  value: string;
  label: string;
}

export interface SchoolFilterOption {
  code: string;
  name: string;
}

export interface PmFilterOption {
  email: string;
  name: string | null;
}

function parseListFilter(value: string | undefined, transform: (item: string) => string = (item) => item): string[] {
  return (value || "")
    .split(",")
    .map((item) => transform(item.trim()))
    .filter(Boolean);
}

function isDateString(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function isActionCompletionBucket(value: string | undefined): value is ActionCompletionBucketFilter {
  return value === "none" || value === "partial" || value === "all_present" || value === "all_complete";
}

export function normalizeVisitSummaryFilters(searchParams: VisitSummaryFilterParams): VisitSummaryFilters {
  const presetRange = resolvePresetDateRange(searchParams.preset, new Date());
  const manualFrom = isDateString(searchParams.from) ? searchParams.from : undefined;
  const manualTo = isDateString(searchParams.to) ? searchParams.to : undefined;
  const from = presetRange?.from ?? manualFrom;
  const to = presetRange?.to ?? manualTo;

  return {
    regions: parseListFilter(searchParams.regions),
    schools: parseListFilter(searchParams.schools),
    pms: parseListFilter(searchParams.pms, (item) => item.toLowerCase()),
    status: searchParams.status === "in_progress" || searchParams.status === "completed"
      ? searchParams.status
      : undefined,
    from,
    to,
    preset: presetRange || searchParams.preset === "all" ? searchParams.preset : undefined,
    bucket: isActionCompletionBucket(searchParams.bucket) ? searchParams.bucket : undefined,
    forceEmpty: Boolean(from && to && from > to),
  };
}

// The Visit Summary covers physical centres only (#470): a Visit is in view only when its
// School has an active physical Centre, so a School with only a JNV NVS Centre drops out
// while a mixed JNV (physical + NVS Centres) stays. Self-contained, so it reads only `v`.
const PHYSICAL_SCHOOL_PREDICATE = `EXISTS (
    SELECT 1
    FROM school physical_school
    JOIN centres physical_centre ON physical_centre.school_id = physical_school.id
    WHERE physical_school.code = v.school_code
      AND physical_centre.is_physical AND physical_centre.is_active
  )`;

// Expects the caller's query to alias the Visit as `v` and LEFT JOIN `school s ON s.code =
// v.school_code` (the region scope reads `s.region`). Placeholders start at `startIndex`.
export function buildVisitSummaryWhere(
  actor: VisitsActor,
  filters: VisitSummaryFilters = { regions: [], schools: [], pms: [], forceEmpty: false },
  options: { startIndex?: number; exclude?: VisitSummaryFilterExclusion } = {}
): VisitSummaryWhere {
  const { startIndex = 1, exclude } = options;
  const predicates = ["v.deleted_at IS NULL", PHYSICAL_SCHOOL_PREDICATE];
  const joins: string[] = [];
  const params: unknown[] = [];
  let nextIndex = startIndex;

  if (filters.forceEmpty) {
    predicates.push("1 = 0");
  }

  if (exclude !== "regions" && filters.regions.length > 0) {
    const namedRegions = filters.regions.filter((region) => region !== NO_REGION_FILTER_VALUE);
    const regionMatches: string[] = [];
    if (namedRegions.length > 0) {
      regionMatches.push(`s.region = ANY($${nextIndex})`);
      params.push(namedRegions);
      nextIndex += 1;
    }
    if (filters.regions.includes(NO_REGION_FILTER_VALUE)) {
      regionMatches.push("s.region IS NULL");
    }
    predicates.push(`(${regionMatches.join(" OR ")})`);
  }

  if (exclude !== "schools" && filters.schools.length > 0) {
    predicates.push(`v.school_code = ANY($${nextIndex})`);
    params.push(filters.schools);
    nextIndex += 1;
  }

  if (exclude !== "pms" && filters.pms.length > 0) {
    predicates.push(`LOWER(v.pm_email) = ANY($${nextIndex})`);
    params.push(filters.pms);
    nextIndex += 1;
  }

  if (filters.status) {
    predicates.push(`v.status = $${nextIndex}`);
    params.push(filters.status);
    nextIndex += 1;
  }

  if (filters.from) {
    predicates.push(`v.visit_date >= $${nextIndex}`);
    params.push(filters.from);
    nextIndex += 1;
  }

  if (filters.to) {
    predicates.push(`v.visit_date <= $${nextIndex}`);
    params.push(filters.to);
    nextIndex += 1;
  }

  if (filters.bucket) {
    const knownTypesIndex = nextIndex;
    joins.push(
      `LEFT JOIN (
        SELECT visit_id,
               COUNT(DISTINCT action_type) FILTER (WHERE action_type = ANY($${knownTypesIndex}::text[])) AS touched_types,
               COUNT(DISTINCT CASE WHEN status = 'completed' AND action_type = ANY($${knownTypesIndex}::text[]) THEN action_type END) AS completed_types
        FROM lms_pm_school_visit_actions
        WHERE deleted_at IS NULL
        GROUP BY visit_id
      ) AS action_agg ON action_agg.visit_id = v.id`
    );
    params.push(REQUIRED_ACTION_TYPE_VALUES);
    nextIndex += 1;

    if (filters.bucket === "none") {
      predicates.push("COALESCE(action_agg.touched_types, 0) = 0");
    } else if (filters.bucket === "partial") {
      predicates.push(`COALESCE(action_agg.touched_types, 0) > 0 AND COALESCE(action_agg.touched_types, 0) < ${REQUIRED_ACTION_TYPE_VALUES.length}`);
    } else if (filters.bucket === "all_present") {
      predicates.push(`COALESCE(action_agg.touched_types, 0) = ${REQUIRED_ACTION_TYPE_VALUES.length} AND COALESCE(action_agg.completed_types, 0) < ${REQUIRED_ACTION_TYPE_VALUES.length}`);
    } else {
      predicates.push(`COALESCE(action_agg.completed_types, 0) = ${REQUIRED_ACTION_TYPE_VALUES.length}`);
    }
  }

  const scope = buildVisitSummaryScopePredicate(actor, {
    startIndex: nextIndex,
    schoolCodeColumn: "v.school_code",
    schoolRegionColumn: "s.region",
  });

  if (scope.clause) {
    predicates.push(scope.clause);
    params.push(...scope.params);
  }

  return {
    whereSql: predicates.join(" AND "),
    joinSql: joins.join("\n"),
    params,
  };
}

export async function getVisitSummaryRegionOptions(
  actor: VisitsActor,
  filters: VisitSummaryFilters
): Promise<RegionFilterOption[]> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters, { exclude: "regions" });

  const rows = await query<{ region: string | null }>(
    `SELECT DISTINCT s.region
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     ${joinSql}
     WHERE ${whereSql}
     ORDER BY s.region ASC NULLS LAST`,
    params
  );

  return rows.map(({ region }) => region === null
    ? { value: NO_REGION_FILTER_VALUE, label: NO_REGION_FILTER_LABEL }
    : { value: region, label: region });
}

export async function getVisitSummarySchoolOptions(
  actor: VisitsActor,
  filters: VisitSummaryFilters
): Promise<SchoolFilterOption[]> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters, { exclude: "schools" });

  return query<SchoolFilterOption>(
    `SELECT DISTINCT v.school_code AS code, COALESCE(s.name, v.school_code) AS name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     ${joinSql}
     WHERE ${whereSql}
     ORDER BY name ASC, code ASC`,
    params
  );
}

export async function getVisitSummaryPmOptions(
  actor: VisitsActor,
  filters: VisitSummaryFilters
): Promise<PmFilterOption[]> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters, { exclude: "pms" });

  return query<PmFilterOption>(
    `SELECT DISTINCT LOWER(v.pm_email) AS email, up.full_name AS name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     LEFT JOIN user_permission up ON LOWER(up.email) = LOWER(v.pm_email)
     ${joinSql}
     WHERE ${whereSql}
     ORDER BY name ASC NULLS LAST, email ASC`,
    params
  );
}
