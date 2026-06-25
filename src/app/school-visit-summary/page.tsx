import Link from "next/link";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import StatCard from "@/components/StatCard";
import GpsMapLink from "@/components/visits/GpsMapLink";
import VisitSummaryFilterBar from "@/components/visits/VisitSummaryFilterBar";
import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { getFeatureAccess, getResolvedPermission, type UserPermission } from "@/lib/permissions";
import {
  ACTION_TYPES,
  ACTION_TYPE_VALUES,
  REQUIRED_ACTION_TYPE_VALUES,
  isOptionalActionType,
  statusBadgeClass,
  type ActionType,
} from "@/lib/visit-actions";
import {
  resolvePresetDateRange,
  rollupActionTypes,
  type ActionTypeRollupStatus,
} from "@/lib/visit-summary";
import {
  buildVisitScopePredicate,
  buildVisitsActor,
  isScopedVisitsRole,
} from "@/lib/visits-policy";

const VISITS_PER_PAGE = 20;

interface SummaryVisit {
  id: number;
  school_code: string;
  school_name: string | null;
  pm_email: string;
  pm_name: string | null;
  visit_date: string;
  status: string;
  inserted_at: string;
  completed_at: string | null;
  start_lat: number | string | null;
  start_lng: number | string | null;
  start_accuracy: number | string | null;
  end_lat: number | string | null;
  end_lng: number | string | null;
  end_accuracy: number | string | null;
}

interface SummaryStats {
  totalVisits: number;
  inProgressCount: number;
  completedCount: number;
  uniqueSchools: number;
  uniquePms: number;
  avgActionCompletion: number | null;
}

interface SummaryStatsRow {
  total_visits: string | number | null;
  in_progress_count: string | number | null;
  completed_count: string | number | null;
  unique_schools: string | number | null;
  unique_pms: string | number | null;
  avg_action_completion: string | number | null;
}

interface VisitActionRow {
  visit_id: number | string;
  action_type: string;
  status: string;
}

interface VisitActionSummary {
  totalActions: number;
  completedActions: number;
  completedTypes: number;
  inProgressTypes: number;
  notStartedTypes: number;
  completionPercent: number | null;
  rollup: Record<ActionType, ActionTypeRollupStatus>;
}

interface SchoolFilterOption {
  code: string;
  name: string;
}

interface PmFilterOption {
  email: string;
  name: string | null;
}

interface SummaryResult {
  visits: SummaryVisit[];
  stats: SummaryStats;
  actionSummaries: Map<number, VisitActionSummary>;
  schoolOptions: SchoolFilterOption[];
  pmOptions: PmFilterOption[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  sort: SortKey;
  dir: SortDirection;
}

interface PageProps {
  searchParams: Promise<{
    sort?: string;
    dir?: string;
    page?: string;
    schools?: string;
    pms?: string;
    status?: string;
    from?: string;
    to?: string;
    preset?: string;
    bucket?: string;
  }>;
}

type SortKey = "visit_date" | "school_name" | "pm_email" | "status" | "inserted_at" | "completed_at";
type SortDirection = "asc" | "desc";
type VisitSummaryStatusFilter = "in_progress" | "completed";
type FilterExclusion = "schools" | "pms";
type ActionCompletionBucketFilter = "none" | "partial" | "all_present" | "all_complete";
type SummarySearchParams = Record<string, string | undefined>;

interface VisitSummaryFilters {
  schools: string[];
  pms: string[];
  status?: VisitSummaryStatusFilter;
  from?: string;
  to?: string;
  preset?: string;
  bucket?: ActionCompletionBucketFilter;
  forceEmpty: boolean;
}

const SORT_COLUMNS: Record<SortKey, { sql: string; defaultDir: SortDirection }> = {
  visit_date: { sql: "v.visit_date", defaultDir: "desc" },
  school_name: { sql: "s.name", defaultDir: "asc" },
  pm_email: { sql: "v.pm_email", defaultDir: "asc" },
  status: { sql: "v.status", defaultDir: "asc" },
  inserted_at: { sql: "v.inserted_at", defaultDir: "desc" },
  completed_at: { sql: "v.completed_at", defaultDir: "desc" },
};

function isSortKey(value: string | undefined): value is SortKey {
  return Boolean(value && value in SORT_COLUMNS);
}

function normalizeSort(sortParam?: string, dirParam?: string): { sort: SortKey; dir: SortDirection } {
  const sort = isSortKey(sortParam) ? sortParam : "visit_date";
  const dir = dirParam === "asc" || dirParam === "desc"
    ? dirParam
    : SORT_COLUMNS[sort].defaultDir;

  return { sort, dir };
}

function normalizePage(pageParam?: string): number {
  const parsed = Number.parseInt(pageParam || "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
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

function normalizeFilters(searchParams: {
  schools?: string;
  pms?: string;
  status?: string;
  from?: string;
  to?: string;
  preset?: string;
  bucket?: string;
}): VisitSummaryFilters {
  const presetRange = resolvePresetDateRange(searchParams.preset, new Date());
  const manualFrom = isDateString(searchParams.from) ? searchParams.from : undefined;
  const manualTo = isDateString(searchParams.to) ? searchParams.to : undefined;
  const from = presetRange?.from ?? manualFrom;
  const to = presetRange?.to ?? manualTo;

  return {
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

function isActionCompletionBucket(value: string | undefined): value is ActionCompletionBucketFilter {
  return value === "none" || value === "partial" || value === "all_present" || value === "all_complete";
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  });
}

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

function formatStatus(status: string): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "in_progress") {
    return "In Progress";
  }
  return status;
}

function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}

function formatSchool(visit: SummaryVisit): string {
  return visit.school_name ? `${visit.school_name} (${visit.school_code})` : visit.school_code;
}

function formatPm(visit: SummaryVisit): string {
  return visit.pm_name || visit.pm_email;
}

function formatDuration(visit: SummaryVisit, now = new Date()): string {
  const start = new Date(visit.inserted_at).getTime();
  const end = visit.completed_at ? new Date(visit.completed_at).getTime() : now.getTime();
  const totalMinutes = Math.max(0, Math.floor((end - start) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

function buildWhereClause(
  permission: UserPermission,
  actorEmail: string,
  filters: VisitSummaryFilters = { schools: [], pms: [], forceEmpty: false },
  startIndex = 1,
  exclude?: FilterExclusion
): { whereSql: string; joinSql: string; params: unknown[] } {
  const actor = buildVisitsActor(actorEmail, permission);
  const predicates = ["v.deleted_at IS NULL"];
  const joins: string[] = [];
  const params: unknown[] = [];
  let nextIndex = startIndex;

  if (filters.forceEmpty) {
    predicates.push("1 = 0");
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

  const scope = buildVisitScopePredicate(actor, {
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

function buildOrderClause(sort: SortKey, dir: SortDirection): string {
  const sortColumn = SORT_COLUMNS[sort].sql;
  const nullsClause = sort === "completed_at" && dir === "asc" ? " NULLS LAST" : "";

  return `${sortColumn} ${dir.toUpperCase()}${nullsClause}, v.id DESC`;
}

function parseCount(value: string | number | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  return Number.parseInt(value || "0", 10);
}

function parseNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function getSummaryStats(
  actorEmail: string,
  permission: UserPermission,
  filters: VisitSummaryFilters
): Promise<SummaryStats> {
  const { whereSql, joinSql, params } = buildWhereClause(permission, actorEmail, filters, 3);
  const rows = await query<SummaryStatsRow>(
    `WITH action_completion AS (
       SELECT a.visit_id,
              COUNT(DISTINCT CASE
                WHEN a.status = 'completed' AND a.action_type = ANY($1::text[])
                THEN a.action_type
              END) AS completed_types
       FROM lms_pm_school_visit_actions a
       WHERE a.deleted_at IS NULL
       GROUP BY a.visit_id
     )
     SELECT COUNT(*) AS total_visits,
            COUNT(*) FILTER (WHERE v.status = 'in_progress') AS in_progress_count,
            COUNT(*) FILTER (WHERE v.status = 'completed') AS completed_count,
            COUNT(DISTINCT v.school_code) AS unique_schools,
            COUNT(DISTINCT LOWER(v.pm_email)) AS unique_pms,
            100.0 * SUM(COALESCE(ac.completed_types, 0))::numeric
              / NULLIF(COUNT(*) * $2, 0) AS avg_action_completion
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     LEFT JOIN action_completion ac ON ac.visit_id = v.id
     ${joinSql}
     WHERE ${whereSql}`,
    [REQUIRED_ACTION_TYPE_VALUES, REQUIRED_ACTION_TYPE_VALUES.length, ...params]
  );

  const row = rows[0];
  return {
    totalVisits: parseCount(row?.total_visits),
    inProgressCount: parseCount(row?.in_progress_count),
    completedCount: parseCount(row?.completed_count),
    uniqueSchools: parseCount(row?.unique_schools),
    uniquePms: parseCount(row?.unique_pms),
    avgActionCompletion: parseNullableNumber(row?.avg_action_completion),
  };
}

async function getPaginatedVisits(
  actorEmail: string,
  permission: UserPermission,
  filters: VisitSummaryFilters,
  sort: SortKey,
  dir: SortDirection,
  page: number
): Promise<SummaryVisit[]> {
  const { whereSql, joinSql, params } = buildWhereClause(permission, actorEmail, filters);
  const offset = (page - 1) * VISITS_PER_PAGE;
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;

  return query<SummaryVisit>(
    `SELECT v.id, v.school_code, s.name AS school_name, v.pm_email,
            up.full_name AS pm_name, v.visit_date, v.status, v.inserted_at,
            v.completed_at, v.start_lat, v.start_lng, v.start_accuracy,
            v.end_lat, v.end_lng, v.end_accuracy
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     LEFT JOIN user_permission up ON LOWER(up.email) = LOWER(v.pm_email)
     ${joinSql}
     WHERE ${whereSql}
     ORDER BY ${buildOrderClause(sort, dir)}
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...params, VISITS_PER_PAGE, offset]
  );
}

async function getSchoolFilterOptions(
  actorEmail: string,
  permission: UserPermission,
  filters: VisitSummaryFilters
): Promise<SchoolFilterOption[]> {
  const { whereSql, joinSql, params } = buildWhereClause(permission, actorEmail, filters, 1, "schools");

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

async function getPmFilterOptions(
  actorEmail: string,
  permission: UserPermission,
  filters: VisitSummaryFilters
): Promise<PmFilterOption[]> {
  const { whereSql, joinSql, params } = buildWhereClause(permission, actorEmail, filters, 1, "pms");

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

async function getActionRowsForVisits(visitIds: number[]): Promise<VisitActionRow[]> {
  if (visitIds.length === 0) {
    return [];
  }

  return query<VisitActionRow>(
    `SELECT visit_id, action_type, status
     FROM lms_pm_school_visit_actions
     WHERE visit_id = ANY($1) AND deleted_at IS NULL`,
    [visitIds]
  );
}

function summarizeActions(actions: VisitActionRow[]): VisitActionSummary {
  const rollup = rollupActionTypes(actions);
  const countStatuses = (statuses: ActionTypeRollupStatus[]) => REQUIRED_ACTION_TYPE_VALUES.filter(
    (actionType: ActionType) => statuses.includes(rollup[actionType])
  ).length;
  const completedTypes = countStatuses(["completed"]);
  const totalActions = actions.length;

  return {
    totalActions,
    completedActions: actions.filter((action) => action.status === "completed").length,
    completedTypes,
    inProgressTypes: countStatuses(["pending", "in_progress"]),
    notStartedTypes: countStatuses(["not_started"]),
    completionPercent: totalActions === 0
      ? null
      : (completedTypes / REQUIRED_ACTION_TYPE_VALUES.length) * 100,
    rollup,
  };
}

function buildActionSummaryMap(visits: SummaryVisit[], actions: VisitActionRow[]): Map<number, VisitActionSummary> {
  const actionsByVisit = new Map<string, VisitActionRow[]>();

  for (const action of actions) {
    const visitId = String(action.visit_id);
    actionsByVisit.set(visitId, [...(actionsByVisit.get(visitId) || []), action]);
  }

  return new Map(visits.map((visit) => [
    visit.id,
    summarizeActions(actionsByVisit.get(String(visit.id)) || []),
  ]));
}

async function getSummaryVisits(
  actorEmail: string,
  permission: UserPermission,
  searchParams: {
    sort?: string;
    dir?: string;
    page?: string;
    schools?: string;
    pms?: string;
    status?: string;
    from?: string;
    to?: string;
    preset?: string;
    bucket?: string;
  }
): Promise<SummaryResult> {
  const { sort, dir } = normalizeSort(searchParams.sort, searchParams.dir);
  const filters = normalizeFilters(searchParams);
  const requestedPage = normalizePage(searchParams.page);
  const [stats, initialVisits, schoolOptions, pmOptions] = await Promise.all([
    getSummaryStats(actorEmail, permission, filters),
    getPaginatedVisits(actorEmail, permission, filters, sort, dir, requestedPage),
    getSchoolFilterOptions(actorEmail, permission, filters),
    getPmFilterOptions(actorEmail, permission, filters),
  ]);
  const totalCount = stats.totalVisits;
  const totalPages = Math.max(1, Math.ceil(totalCount / VISITS_PER_PAGE));
  const currentPage = Math.min(requestedPage, totalPages);
  const visits = totalCount > 0 && currentPage !== requestedPage
    ? await getPaginatedVisits(actorEmail, permission, filters, sort, dir, currentPage)
    : initialVisits;
  const actionRows = await getActionRowsForVisits(visits.map((visit) => visit.id));
  const actionSummaries = buildActionSummaryMap(visits, actionRows);

  return {
    visits,
    stats,
    actionSummaries,
    schoolOptions,
    pmOptions,
    totalCount,
    currentPage,
    totalPages,
    sort,
    dir,
  };
}

function sortHref(
  column: SortKey,
  currentSort: SortKey,
  currentDir: SortDirection,
  currentParams: SummarySearchParams
): string {
  const dir = column === currentSort
    ? currentDir === "asc" ? "desc" : "asc"
    : SORT_COLUMNS[column].defaultDir;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(currentParams)) {
    if (value && key !== "sort" && key !== "dir" && key !== "page") {
      params.set(key, value);
    }
  }
  params.set("sort", column);
  params.set("dir", dir);
  return `/school-visit-summary?${params.toString()}`;
}

function SortHeader({
  column,
  currentSort,
  currentDir,
  currentParams,
  children,
}: {
  column: SortKey;
  currentSort: SortKey;
  currentDir: SortDirection;
  currentParams: SummarySearchParams;
  children: React.ReactNode;
}) {
  const active = column === currentSort;

  return (
    <Link
      href={sortHref(column, currentSort, currentDir, currentParams)}
      className="inline-flex items-center gap-1 hover:text-text-primary"
    >
      {children}
      {active && <span aria-hidden="true">{currentDir === "asc" ? "↑" : "↓"}</span>}
    </Link>
  );
}

function PaginationControls({
  currentPage,
  totalPages,
  sort,
  dir,
  currentParams,
}: {
  currentPage: number;
  totalPages: number;
  sort: SortKey;
  dir: SortDirection;
  currentParams: SummarySearchParams;
}) {
  if (totalPages <= 1) {
    return null;
  }

  const hrefFor = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(currentParams)) {
      if (value && key !== "page") {
        params.set(key, value);
      }
    }
    params.set("sort", sort);
    params.set("dir", dir);
    if (page > 1) {
      params.set("page", String(page));
    }
    return `/school-visit-summary?${params.toString()}`;
  };

  return (
    <nav className="mt-6 flex items-center justify-between border-t border-border bg-bg-card px-4 py-3 text-sm text-text-secondary">
      <span className="font-mono">
        Page {currentPage} of {totalPages}
      </span>
      <div className="flex gap-2">
        {currentPage > 1 ? (
          <Link href={hrefFor(currentPage - 1)} className="border border-border px-3 py-2 font-bold uppercase hover:bg-hover-bg">
            Previous
          </Link>
        ) : (
          <span className="border border-border px-3 py-2 text-text-muted">Previous</span>
        )}
        {currentPage < totalPages ? (
          <Link href={hrefFor(currentPage + 1)} className="border border-border px-3 py-2 font-bold uppercase hover:bg-hover-bg">
            Next
          </Link>
        ) : (
          <span className="border border-border px-3 py-2 text-text-muted">Next</span>
        )}
      </div>
    </nav>
  );
}

function formatActionCounts(summary: VisitActionSummary): string {
  return `${summary.totalActions} total, ${summary.completedActions} completed`;
}

function ActionTypeBar({ summary }: { summary: VisitActionSummary }) {
  const pct = summary.completionPercent !== null ? Math.round(summary.completionPercent) : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex h-5 w-28 rounded-sm border border-border/60">
        {ACTION_TYPE_VALUES.map((actionType) => {
          const status = summary.rollup[actionType];
          const label = ACTION_TYPES[actionType];
          const statusLabel = `${status.replace("_", " ")}${isOptionalActionType(actionType) ? " (optional)" : ""}`;
          const colorClass =
            status === "completed"
              ? "bg-success"
              : status === "in_progress" || status === "pending"
                ? "bg-brand-amber"
                : "bg-gray-200";

          return (
            <span
              key={actionType}
              className={`group/seg relative flex-1 border-r border-border/30 last:border-r-0 ${colorClass} cursor-default hover:opacity-80`}
            >
              <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 shadow-lg transition-all group-hover/seg:visible group-hover/seg:opacity-100">
                {label}: {statusLabel}
              </span>
            </span>
          );
        })}
      </div>
      <span className="text-xs font-mono text-text-muted whitespace-nowrap">{pct}%</span>
    </div>
  );
}

function formatMobileActionSummary(summary: VisitActionSummary): string {
  return `${summary.completedTypes}/${REQUIRED_ACTION_TYPE_VALUES.length} required complete`;
}

function StatCards({ stats }: { stats: SummaryStats }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-6">
      <StatCard label="Total Visits" value={stats.totalVisits} size="sm" />
      <StatCard label="In Progress" value={stats.inProgressCount} size="sm" />
      <StatCard label="Completed" value={stats.completedCount} size="sm" />
      <StatCard label="Unique Schools" value={stats.uniqueSchools} size="sm" />
      <StatCard label="Unique PMs" value={stats.uniquePms} size="sm" />
      <StatCard label="Avg Completion" value={formatPercent(stats.avgActionCompletion)} size="sm" />
    </div>
  );
}

function VisitMobileCard({
  visit,
  actionSummary,
}: {
  visit: SummaryVisit;
  actionSummary: VisitActionSummary;
}) {
  return (
    <Link href={`/school-visit-summary/${visit.id}`} aria-label="View visit">
      <Card elevation="sm" className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-bold text-text-primary">{formatSchool(visit)}</div>
            <div className="mt-1 text-xs text-text-muted">{formatPm(visit)}</div>
          </div>
          <span className={`inline-flex shrink-0 ${statusBadgeClass(visit.status)}`}>
            {formatStatus(visit.status)}
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-mono text-text-muted">
          <span>{formatDate(visit.visit_date)}</span>
          <span>{formatDuration(visit)}</span>
          <span>{formatMobileActionSummary(actionSummary)}</span>
        </div>
      </Card>
    </Link>
  );
}

function VisitDesktopTable({
  visits,
  actionSummaries,
  sort,
  dir,
  currentParams,
}: {
  visits: SummaryVisit[];
  actionSummaries: Map<number, VisitActionSummary>;
  sort: SortKey;
  dir: SortDirection;
  currentParams: SummarySearchParams;
}) {
  return (
    <Card elevation="sm" className="hidden overflow-x-auto sm:block">
      <table className="min-w-full">
        <thead className="border-b-2 border-border-accent bg-bg-card-alt">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="school_name" currentSort={sort} currentDir={dir} currentParams={currentParams}>School</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="pm_email" currentSort={sort} currentDir={dir} currentParams={currentParams}>PM</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="visit_date" currentSort={sort} currentDir={dir} currentParams={currentParams}>Visit Date</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="status" currentSort={sort} currentDir={dir} currentParams={currentParams}>Status</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="inserted_at" currentSort={sort} currentDir={dir} currentParams={currentParams}>Started At</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              <SortHeader column="completed_at" currentSort={sort} currentDir={dir} currentParams={currentParams}>Completed At</SortHeader>
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Duration
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Start GPS
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              End GPS
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Actions
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Action %
            </th>
            <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider text-text-muted">
              Action Types
            </th>
            <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider text-text-muted">
              Detail
            </th>
          </tr>
        </thead>
        <tbody className="bg-bg-card">
          {visits.map((visit) => {
            const actionSummary = actionSummaries.get(visit.id) || summarizeActions([]);

            return (
              <tr key={visit.id} className="border-b border-border/40 hover:bg-hover-bg">
                <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-text-primary">
                  {formatSchool(visit)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm text-text-secondary">
                  <div>{formatPm(visit)}</div>
                  {visit.pm_name && <div className="text-xs text-text-muted">{visit.pm_email}</div>}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatDate(visit.visit_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <span className={`inline-flex ${statusBadgeClass(visit.status)}`}>
                    {formatStatus(visit.status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatTimestamp(visit.inserted_at)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatTimestamp(visit.completed_at)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatDuration(visit)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <GpsMapLink lat={visit.start_lat} lng={visit.start_lng} accuracy={visit.start_accuracy} />
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <GpsMapLink lat={visit.end_lat} lng={visit.end_lng} accuracy={visit.end_accuracy} />
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatActionCounts(actionSummary)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatPercent(actionSummary.completionPercent)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <ActionTypeBar summary={actionSummary} />
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-right text-sm">
                  <Link
                    href={`/school-visit-summary/${visit.id}`}
                    aria-label="View visit"
                    className="font-bold uppercase text-accent hover:text-accent-hover"
                  >
                    View
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

export default async function SchoolVisitSummaryPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const rawSearchParams = await searchParams;

  if (!session) {
    redirect("/");
  }

  if (session.isPasscodeUser) {
    if (session.schoolCode) {
      redirect(`/school/${session.schoolCode}`);
    }
    redirect("/dashboard");
  }

  if (!session.user?.email) {
    redirect("/");
  }

  const permission = await getResolvedPermission(session.user.email);
  if (!permission) {
    redirect("/dashboard");
  }

  if (!getFeatureAccess(permission, "visits").canView) {
    redirect("/dashboard");
  }

  const actor = buildVisitsActor(session.user.email, permission);
  if (!isScopedVisitsRole(actor)) {
    if (actor.role === "program_manager") {
      redirect("/visits");
    }
    redirect("/dashboard");
  }

  const {
    visits,
    stats,
    actionSummaries,
    schoolOptions,
    pmOptions,
    totalCount,
    currentPage,
    totalPages,
    sort,
    dir,
  } = await getSummaryVisits(
    session.user.email,
    permission,
    rawSearchParams
  );

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-bg-card shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp"
              alt="Avanti Fellows"
              className="h-8 shrink-0 sm:h-10"
            />
            <nav className="flex gap-3 sm:gap-4">
              <Link
                href="/dashboard"
                className="pb-1 text-sm font-medium uppercase tracking-wide text-text-muted hover:text-text-primary"
              >
                Schools
              </Link>
              <Link
                href="/school-visit-summary"
                className="border-b-2 border-accent pb-1 text-sm font-bold uppercase tracking-wide text-text-primary"
              >
                Visit Summary
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            {permission.role === "admin" && (
              <Link href="/admin" className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
                Admin
              </Link>
            )}
            <span className="hidden font-mono text-sm text-text-muted sm:inline">{session.user.email}</span>
            <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-col gap-2 border-b-4 border-border-accent pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight text-text-primary sm:text-2xl">
              School Visit Summary
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              {totalCount} visit{totalCount === 1 ? "" : "s"} found
            </p>
          </div>
        </div>

        <StatCards stats={stats} />

        <VisitSummaryFilterBar
          schoolOptions={schoolOptions}
          pmOptions={pmOptions}
          currentParams={rawSearchParams}
        />

        {visits.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-text-muted uppercase tracking-wide">No visits match your filters</div>
          </div>
        ) : (
          <>
            <div className="space-y-3 sm:hidden">
              {visits.map((visit) => (
                <VisitMobileCard
                  key={visit.id}
                  visit={visit}
                  actionSummary={actionSummaries.get(visit.id) || summarizeActions([])}
                />
              ))}
            </div>

            <VisitDesktopTable
              visits={visits}
              actionSummaries={actionSummaries}
              sort={sort}
              dir={dir}
              currentParams={rawSearchParams}
            />

            <PaginationControls
              currentPage={currentPage}
              totalPages={totalPages}
              sort={sort}
              dir={dir}
              currentParams={rawSearchParams}
            />
          </>
        )}
      </main>
    </div>
  );
}
