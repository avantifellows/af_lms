// The Visits in view on the School Visit Summary (server-only: reads through `@/lib/db`).
// Every Visit Summary query — the Visits list, the School-wise rows, both tabs' stat cards and the
// Region/School/PM filter options — builds its WHERE clause here, so they all agree on which Visits are in view.
import { query } from "@/lib/db";
import { REQUIRED_ACTION_TYPE_VALUES } from "@/lib/visit-actions";
import { resolvePresetDateRange } from "@/lib/visit-summary";
import {
  buildVisitSummaryScopePredicate,
  type VisitScopePredicate,
  type VisitsActor,
} from "@/lib/visits-policy";

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
  // `recurring=1`: the School-wise tab keeps only Schools with a Recurring Concern. It is a shared
  // filter param (tab links keep it) but not a Visit filter, so buildVisitSummaryWhere ignores it.
  recurringOnly?: boolean;
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
  recurring?: string;
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

// A real calendar date in `YYYY-MM-DD`: `2026-13-45` has the shape but would make Postgres throw.
function isDateString(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
    recurringOnly: searchParams.recurring === "1",
  };
}

// The Visit Summary covers physical centres only (#470): a School is on it only when it has an
// active physical Centre, so a School with only a JNV NVS Centre drops out while a mixed JNV
// (physical + NVS Centres) stays. Self-contained, so it reads only `schoolCodeColumn`.
function physicalSchoolPredicate(schoolCodeColumn: string): string {
  return `EXISTS (
    SELECT 1
    FROM school physical_school
    JOIN centres physical_centre ON physical_centre.school_id = physical_school.id
    WHERE physical_school.code = ${schoolCodeColumn}
      AND physical_centre.is_physical AND physical_centre.is_active
  )`;
}

// A School is on the actor's Visit Summary when it is inside their summary scope and has an active
// physical Centre. The Visits in view, the School page and the concern-events API all gate on this
// one rule, so a School the list hides can't be opened or written to. Placeholders start at `startIndex`.
export function buildVisitSummarySchoolPredicate(
  actor: VisitsActor,
  options: { startIndex: number; schoolCodeColumn: string; schoolRegionColumn: string }
): VisitScopePredicate {
  const physical = physicalSchoolPredicate(options.schoolCodeColumn);
  const scope = buildVisitSummaryScopePredicate(actor, options);
  return {
    clause: scope.clause ? `${physical} AND ${scope.clause}` : physical,
    params: scope.params,
  };
}

const REQUIRED_ACTION_COUNT = REQUIRED_ACTION_TYPE_VALUES.length;

// Read against `action_agg`, the per-Visit counts from actionAggregateJoin.
const ACTION_BUCKET_PREDICATES: Record<ActionCompletionBucketFilter, string> = {
  none: "COALESCE(action_agg.touched_types, 0) = 0",
  partial: `COALESCE(action_agg.touched_types, 0) > 0 AND COALESCE(action_agg.touched_types, 0) < ${REQUIRED_ACTION_COUNT}`,
  all_present: `COALESCE(action_agg.touched_types, 0) = ${REQUIRED_ACTION_COUNT} AND COALESCE(action_agg.completed_types, 0) < ${REQUIRED_ACTION_COUNT}`,
  all_complete: `COALESCE(action_agg.completed_types, 0) = ${REQUIRED_ACTION_COUNT}`,
};

// Counts each Visit's required action types that were started and completed. `knownTypes` is the
// placeholder holding REQUIRED_ACTION_TYPE_VALUES.
function actionAggregateJoin(knownTypes: string): string {
  return `LEFT JOIN (
        SELECT visit_id,
               COUNT(DISTINCT action_type) FILTER (WHERE action_type = ANY(${knownTypes}::text[])) AS touched_types,
               COUNT(DISTINCT CASE WHEN status = 'completed' AND action_type = ANY(${knownTypes}::text[]) THEN action_type END) AS completed_types
        FROM lms_pm_school_visit_actions
        WHERE deleted_at IS NULL
        GROUP BY visit_id
      ) AS action_agg ON action_agg.visit_id = v.id`;
}

// Named Regions match by value; the "no Region" option matches Schools whose region is NULL.
function regionFilterPredicate(regions: string[], bind: (value: unknown) => string): string {
  const namedRegions = regions.filter((region) => region !== NO_REGION_FILTER_VALUE);
  const regionMatches: string[] = [];
  if (namedRegions.length > 0) {
    regionMatches.push(`s.region = ANY(${bind(namedRegions)})`);
  }
  if (regions.includes(NO_REGION_FILTER_VALUE)) {
    regionMatches.push("s.region IS NULL");
  }
  return `(${regionMatches.join(" OR ")})`;
}

// Expects the caller's query to alias the Visit as `v` and LEFT JOIN `school s ON s.code =
// v.school_code` (the region scope reads `s.region`). Placeholders start at `startIndex`.
export function buildVisitSummaryWhere(
  actor: VisitsActor,
  filters: VisitSummaryFilters = { regions: [], schools: [], pms: [], forceEmpty: false },
  options: { startIndex?: number; exclude?: VisitSummaryFilterExclusion } = {}
): VisitSummaryWhere {
  const { startIndex = 1, exclude } = options;
  const predicates = ["v.deleted_at IS NULL"];
  const joins: string[] = [];
  const params: unknown[] = [];
  // Adds a parameter and returns its placeholder.
  const bind = (value: unknown) => {
    params.push(value);
    return `$${startIndex + params.length - 1}`;
  };

  if (filters.forceEmpty) {
    predicates.push("1 = 0");
  }
  if (exclude !== "regions" && filters.regions.length > 0) {
    predicates.push(regionFilterPredicate(filters.regions, bind));
  }
  if (exclude !== "schools" && filters.schools.length > 0) {
    predicates.push(`v.school_code = ANY(${bind(filters.schools)})`);
  }
  if (exclude !== "pms" && filters.pms.length > 0) {
    predicates.push(`LOWER(v.pm_email) = ANY(${bind(filters.pms)})`);
  }
  if (filters.status) {
    predicates.push(`v.status = ${bind(filters.status)}`);
  }
  if (filters.from) {
    predicates.push(`v.visit_date >= ${bind(filters.from)}`);
  }
  if (filters.to) {
    predicates.push(`v.visit_date <= ${bind(filters.to)}`);
  }
  if (filters.bucket) {
    joins.push(actionAggregateJoin(bind(REQUIRED_ACTION_TYPE_VALUES)));
    predicates.push(ACTION_BUCKET_PREDICATES[filters.bucket]);
  }

  const school = buildVisitSummarySchoolPredicate(actor, {
    startIndex: startIndex + params.length,
    schoolCodeColumn: "v.school_code",
    schoolRegionColumn: "s.region",
  });
  predicates.push(school.clause);
  params.push(...school.params);

  return {
    whereSql: predicates.join(" AND "),
    joinSql: joins.join("\n"),
    params,
  };
}

// Lets a caller narrow an option list's Visits in view further (the School-wise tab's `recurring=1`).
export type NarrowVisitSummaryWhere = (where: VisitSummaryWhere) => VisitSummaryWhere;

export async function getVisitSummaryRegionOptions(
  actor: VisitsActor,
  filters: VisitSummaryFilters,
  narrow: NarrowVisitSummaryWhere = (where) => where
): Promise<RegionFilterOption[]> {
  const { whereSql, joinSql, params } = narrow(buildVisitSummaryWhere(actor, filters, { exclude: "regions" }));

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
  filters: VisitSummaryFilters,
  narrow: NarrowVisitSummaryWhere = (where) => where
): Promise<SchoolFilterOption[]> {
  const { whereSql, joinSql, params } = narrow(buildVisitSummaryWhere(actor, filters, { exclude: "schools" }));

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
  filters: VisitSummaryFilters,
  narrow: NarrowVisitSummaryWhere = (where) => where
): Promise<PmFilterOption[]> {
  const { whereSql, joinSql, params } = narrow(buildVisitSummaryWhere(actor, filters, { exclude: "pms" }));

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
