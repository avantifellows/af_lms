import Link from "next/link";

import ClickableTableRow from "@/components/visits/ClickableTableRow";
import { ConcernFreshnessLine } from "@/components/visits/ConcernFreshnessLine";
import GpsMapLink from "@/components/visits/GpsMapLink";
import RecurringOnlyToggle from "@/components/visits/RecurringOnlyToggle";
import VisitSummaryFilterBar from "@/components/visits/VisitSummaryFilterBar";
import { Card } from "@/components/ui";
import { query } from "@/lib/db";
import {
  ACTION_TYPES,
  ACTION_TYPE_VALUES,
  REQUIRED_ACTION_TYPE_VALUES,
  isOptionalActionType,
  statusBadgeClass,
  type ActionType,
} from "@/lib/visit-actions";
import {
  STALE_LAST_VISIT_DAYS,
  concernSeverity,
  formatCompactVisitDates,
  formatIstDate,
  formatIstTimestamp,
  formatVisitCount,
  isStaleLastVisit,
  rollupActionTypes,
  searchParamsWithout,
  type ActionTypeRollupStatus,
  type ConcernSeverity,
} from "@/lib/visit-summary";
import {
  buildVisitSummaryWhere,
  getVisitSummaryPmOptions,
  getVisitSummaryRegionOptions,
  getVisitSummarySchoolOptions,
  normalizeVisitSummaryFilters,
  type PmFilterOption,
  type RegionFilterOption,
  type SchoolFilterOption,
  type VisitSummaryFilters,
} from "@/lib/visit-summary-scope";
import {
  SCHOOL_WISE_SORT_COLUMNS,
  getSchoolWiseView,
  normalizeSchoolWiseSort,
  withRecurringSchoolsOnly,
  type SchoolWiseSort,
  type SchoolWiseView,
  type SchoolWiseRow,
} from "@/lib/visit-concerns";
import { requireVisitSummaryPage } from "@/lib/visit-summary-page";
import type { VisitsActor } from "@/lib/visits-policy";

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

// The stat cards both tabs show. The first four count the Visits in view (`getSummaryStats`);
// the last is the School-wise read model's count of Schools with a Recurring Concern.
interface HeaderStats {
  totalVisits: number;
  completedCount: number;
  uniqueSchools: number;
  uniquePms: number;
  schoolsWithRecurring: number;
}

interface SummaryResult {
  visits: SummaryVisit[];
  stats: SummaryStats;
  headerStats: HeaderStats;
  actionSummaries: Map<number, VisitActionSummary>;
  regionOptions: RegionFilterOption[];
  schoolOptions: SchoolFilterOption[];
  pmOptions: PmFilterOption[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
  sort: SortKey;
  dir: SortDirection;
}

interface SchoolWiseResult {
  view: SchoolWiseView;
  headerStats: HeaderStats;
  regionOptions: RegionFilterOption[];
  schoolOptions: SchoolFilterOption[];
  pmOptions: PmFilterOption[];
  sort: SchoolWiseSort;
}

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    sort?: string;
    dir?: string;
    page?: string;
    regions?: string;
    schools?: string;
    pms?: string;
    status?: string;
    from?: string;
    to?: string;
    preset?: string;
    bucket?: string;
    recurring?: string;
  }>;
}

type SortKey = "visit_date" | "school_name" | "pm_email" | "status" | "inserted_at" | "completed_at";
type SortDirection = "asc" | "desc";
type SummarySearchParams = Record<string, string | undefined>;
type SummaryTab = "schools" | "visits";

// School-wise is the default; any `tab` other than `visits` shows it.
function normalizeTab(tabParam?: string): SummaryTab {
  return tabParam === "visits" ? "visits" : "schools";
}

const SORT_COLUMNS: Record<SortKey, { sql: string; defaultDir: SortDirection }> = {
  visit_date: { sql: "v.visit_date", defaultDir: "desc" },
  school_name: { sql: "s.name", defaultDir: "asc" },
  pm_email: { sql: "v.pm_email", defaultDir: "asc" },
  status: { sql: "v.status", defaultDir: "asc" },
  inserted_at: { sql: "v.inserted_at", defaultDir: "desc" },
  completed_at: { sql: "v.completed_at", defaultDir: "desc" },
};

// An own key only: `in` would also accept `constructor` and the like, and their undefined defaultDir
// would throw.
function isSortKey(value: string | undefined): value is SortKey {
  return Boolean(value && Object.hasOwn(SORT_COLUMNS, value));
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
  actor: VisitsActor,
  filters: VisitSummaryFilters
): Promise<SummaryStats> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters, { startIndex: 3 });
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
  actor: VisitsActor,
  filters: VisitSummaryFilters,
  sort: SortKey,
  dir: SortDirection,
  page: number
): Promise<SummaryVisit[]> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters);
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
  actor: VisitsActor,
  searchParams: {
    sort?: string;
    dir?: string;
    page?: string;
    regions?: string;
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
  const filters = normalizeVisitSummaryFilters(searchParams);
  const requestedPage = normalizePage(searchParams.page);
  const [stats, initialVisits, schoolOptions, pmOptions, regionOptions, schoolWiseView] = await Promise.all([
    getSummaryStats(actor, filters),
    getPaginatedVisits(actor, filters, sort, dir, requestedPage),
    getVisitSummarySchoolOptions(actor, filters),
    getVisitSummaryPmOptions(actor, filters),
    getVisitSummaryRegionOptions(actor, filters),
    // The "Schools with recurring concerns" card: the same School-wise read model over the same
    // Visits in view. `recurring=1` is a School-wise row filter, so the Visits tab ignores it.
    getSchoolWiseView(actor, { ...filters, recurringOnly: false }, normalizeSchoolWiseSort()),
  ]);
  const totalCount = stats.totalVisits;
  const totalPages = Math.max(1, Math.ceil(totalCount / VISITS_PER_PAGE));
  const currentPage = Math.min(requestedPage, totalPages);
  const visits = totalCount > 0 && currentPage !== requestedPage
    ? await getPaginatedVisits(actor, filters, sort, dir, currentPage)
    : initialVisits;
  const actionRows = await getActionRowsForVisits(visits.map((visit) => visit.id));
  const actionSummaries = buildActionSummaryMap(visits, actionRows);

  return {
    visits,
    stats,
    headerStats: toHeaderStats(stats, schoolWiseView.stats.schoolsWithRecurring),
    actionSummaries,
    regionOptions,
    schoolOptions,
    pmOptions,
    totalCount,
    currentPage,
    totalPages,
    sort,
    dir,
  };
}

async function getSchoolWiseSummary(
  actor: VisitsActor,
  searchParams: SummarySearchParams
): Promise<SchoolWiseResult> {
  const sort = normalizeSchoolWiseSort(searchParams.sort, searchParams.dir);
  const filters = normalizeVisitSummaryFilters(searchParams);
  // With `recurring=1` the options offer only what the table keeps, so no pick empties it.
  const narrowOptions = filters.recurringOnly ? withRecurringSchoolsOnly : undefined;
  const [view, allSchoolsStats, schoolOptions, pmOptions, regionOptions] = await Promise.all([
    getSchoolWiseView(actor, filters, sort),
    filters.recurringOnly ? null : getSummaryStats(actor, filters),
    getVisitSummarySchoolOptions(actor, filters, narrowOptions),
    getVisitSummaryPmOptions(actor, filters, narrowOptions),
    getVisitSummaryRegionOptions(actor, filters, narrowOptions),
  ]);
  const stats = allSchoolsStats ?? await getKeptSchoolsStats(actor, filters, view.rows);

  return {
    view,
    headerStats: toHeaderStats(stats, view.stats.schoolsWithRecurring),
    regionOptions,
    schoolOptions,
    pmOptions,
    sort,
  };
}

const EMPTY_SUMMARY_STATS: SummaryStats = {
  totalVisits: 0,
  inProgressCount: 0,
  completedCount: 0,
  uniqueSchools: 0,
  uniquePms: 0,
  avgActionCompletion: null,
};

// With `recurring=1` the stat cards follow the Schools kept, like the table: the Visits in view at
// those Schools only. No Schools kept means no Visits (an empty `schools` filter would mean all).
async function getKeptSchoolsStats(
  actor: VisitsActor,
  filters: VisitSummaryFilters,
  rows: SchoolWiseRow[]
): Promise<SummaryStats> {
  if (rows.length === 0) {
    return EMPTY_SUMMARY_STATS;
  }
  return getSummaryStats(actor, { ...filters, schools: rows.map((row) => row.schoolCode) });
}

function toHeaderStats(stats: SummaryStats, schoolsWithRecurring: number): HeaderStats {
  return {
    totalVisits: stats.totalVisits,
    completedCount: stats.completedCount,
    uniqueSchools: stats.uniqueSchools,
    uniquePms: stats.uniquePms,
    schoolsWithRecurring,
  };
}

// Switching tabs keeps every filter and drops `sort`, `dir` and `page`, which belong to one tab.
function tabHref(tab: SummaryTab, currentParams: SummarySearchParams): string {
  const params = searchParamsWithout(currentParams, ["tab", "sort", "dir", "page"], { tab });
  return `/school-visit-summary?${params.toString()}`;
}

function SummaryTabs({ tab, currentParams }: { tab: SummaryTab; currentParams: SummarySearchParams }) {
  const tabs: Array<{ value: SummaryTab; label: string }> = [
    { value: "schools", label: "School-wise" },
    { value: "visits", label: "Visits" },
  ];

  return (
    <nav aria-label="Visit Summary views" className="mb-4 flex border-b-2 border-accent">
      {tabs.map(({ value, label }) => (
        <Link
          key={value}
          href={tabHref(value, currentParams)}
          aria-current={value === tab ? "page" : undefined}
          className={`border px-4 py-2.5 text-sm font-bold uppercase tracking-wider sm:px-6 ${value === tab
            ? "border-accent bg-accent text-text-on-accent"
            : "border-b-0 border-border bg-bg-card-alt text-text-secondary hover:bg-hover-bg hover:text-text-primary"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

type SortColumns = Record<string, { defaultDir: SortDirection }>;

function sortHref(
  column: string,
  currentSort: string,
  currentDir: SortDirection,
  currentParams: SummarySearchParams,
  columns: SortColumns
): string {
  const dir = column === currentSort
    ? currentDir === "asc" ? "desc" : "asc"
    : columns[column].defaultDir;
  const params = searchParamsWithout(currentParams, ["sort", "dir", "page"]);
  params.set("sort", column);
  params.set("dir", dir);
  return `/school-visit-summary?${params.toString()}`;
}

function SortHeader({
  column,
  currentSort,
  currentDir,
  currentParams,
  columns = SORT_COLUMNS,
  children,
}: {
  column: string;
  currentSort: string;
  currentDir: SortDirection;
  currentParams: SummarySearchParams;
  columns?: SortColumns;
  children: React.ReactNode;
}) {
  const active = column === currentSort;

  return (
    <Link
      href={sortHref(column, currentSort, currentDir, currentParams, columns)}
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
    const params = searchParamsWithout(currentParams, ["page"]);
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

// Compact tiles (Vishal, 28 Oct: the full-size StatCards took too much space).
function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card elevation="sm" className="px-3 py-2">
      <span className="block text-[11px] uppercase leading-tight tracking-wider text-text-muted">{label}</span>
      <div className="mt-0.5 font-mono text-lg font-bold text-text-primary">{value.toLocaleString()}</div>
    </Card>
  );
}

function StatCards({ stats }: { stats: HeaderStats }) {
  return (
    <div role="group" aria-label="Visit totals" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
      <StatTile label="Total visits" value={stats.totalVisits} />
      <StatTile label="Completed" value={stats.completedCount} />
      <StatTile label="Schools" value={stats.uniqueSchools} />
      <StatTile label="PMs" value={stats.uniquePms} />
      <StatTile label="Schools with recurring concerns" value={stats.schoolsWithRecurring} />
    </div>
  );
}

// A bar down the left edge of a School-wise row, coloured by `concernSeverity`; the label is its
// text alternative.
const SEVERITY_BARS: Record<ConcernSeverity, { label: string; className: string }> = {
  high: { label: "3 or more recurring concerns", className: "bg-danger" },
  medium: { label: "1–2 recurring concerns", className: "bg-brand-amber" },
  low: { label: "Open concerns, none recurring", className: "bg-brand-amber/40" },
  none: { label: "No open concerns", className: "bg-transparent" },
};

function SeverityBar({ row }: { row: SchoolWiseRow }) {
  const { label, className } = SEVERITY_BARS[concernSeverity(row)];

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`absolute inset-y-3 left-2 w-1 rounded-full ${className}`}
    />
  );
}

const STALE_LAST_VISIT_LABEL = `Stale: last visit over ${STALE_LAST_VISIT_DAYS} days ago`;

// `19 Aug` (the year only outside the current one) in a pill; a stale date gets the amber tint.
function LastVisitPill({ date, now }: { date: string; now: Date }) {
  const stale = isStaleLastVisit(date, now);

  return (
    <span
      title={stale ? `${formatIstDate(date)} · ${STALE_LAST_VISIT_LABEL}` : formatIstDate(date)}
      className={`relative inline-flex rounded-full px-2.5 py-0.5 font-mono text-xs ${stale
        ? "bg-brand-amber/25 font-bold text-warning-text"
        : "bg-bg-card-alt text-text-secondary"}`}
    >
      <time dateTime={date}>{formatCompactVisitDates([date], now)}</time>
      {stale && <>{" "}<span className="sr-only">{STALE_LAST_VISIT_LABEL}</span></>}
    </span>
  );
}

// A School-wise row opens its School page carrying every filter (and the table's sort), so the
// page's Back link can return to this same table.
function schoolPageHref(schoolCode: string, currentParams: SummarySearchParams): string {
  const query = searchParamsWithout(currentParams, ["tab"]).toString();
  return `/school-visit-summary/schools/${encodeURIComponent(schoolCode)}${query ? `?${query}` : ""}`;
}

const SCHOOL_WISE_HEADER_CLASS = "px-4 py-3 text-xs font-bold uppercase tracking-wider text-text-muted";

function SchoolWiseTable({
  rows,
  sort,
  currentParams,
}: {
  rows: SchoolWiseView["rows"];
  sort: SchoolWiseSort;
  currentParams: SummarySearchParams;
}) {
  const header = (column: keyof typeof SCHOOL_WISE_SORT_COLUMNS, label: string, align: "left" | "center" = "center") => (
    <th className={`${SCHOOL_WISE_HEADER_CLASS} whitespace-nowrap ${align === "left" ? "pl-6 text-left" : "text-center"}`}>
      <SortHeader
        column={column}
        currentSort={sort.sort}
        currentDir={sort.dir}
        currentParams={currentParams}
        columns={SCHOOL_WISE_SORT_COLUMNS}
      >
        {label}
      </SortHeader>
    </th>
  );

  const now = new Date();

  return (
    // `relative` makes the scroll box the containing block of the absolutely positioned severity
    // bars and sr-only labels, so they scroll with the table instead of widening the page.
    <Card elevation="sm" className="relative overflow-x-auto">
      <table aria-label="Schools with visits" className="min-w-full">
        <thead className="border-b border-border">
          <tr>
            {header("school_name", "School", "left")}
            {header("visits", "Visits")}
            {header("last_visit", "Last visit")}
            {header("open", "Open concerns")}
            {header("recurring", "Recurring issues")}
            {header("flags", "Student flags")}
            <th className={`${SCHOOL_WISE_HEADER_CLASS} w-full text-left`}>Top recurring concern</th>
            <th className="w-10 px-2">
              <span className="sr-only">Open School page</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ClickableTableRow
              key={row.schoolCode}
              href={schoolPageHref(row.schoolCode, currentParams)}
              className="border-b border-border/40 last:border-b-0 hover:bg-hover-bg"
            >
              <td className="relative whitespace-nowrap py-3 pl-6 pr-4">
                <SeverityBar row={row} />
                <Link
                  href={schoolPageHref(row.schoolCode, currentParams)}
                  className="block text-sm font-bold text-text-primary hover:text-accent"
                >
                  {row.schoolName}
                </Link>
                {row.region && <>{" "}<span className="block text-xs text-text-muted">{row.region}</span></>}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-center text-sm text-text-primary">{row.visits}</td>
              <td className="whitespace-nowrap px-4 py-3 text-center">
                <LastVisitPill date={row.lastVisitDate} now={now} />
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-center text-sm text-text-primary">{row.openCount}</td>
              <td className="whitespace-nowrap px-4 py-3 text-center">
                {row.recurringCount > 0 ? (
                  <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-accent px-2 text-xs font-bold text-text-on-accent">
                    {row.recurringCount}
                  </span>
                ) : (
                  <span className="font-mono text-sm text-text-muted">0</span>
                )}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-center font-mono text-sm">
                {row.flagsOpen === null
                  ? <span className="text-text-muted">—</span>
                  : <span className={row.flagsOpen > 0 ? "font-bold text-text-primary" : "text-text-muted"}>{row.flagsOpen}</span>}
              </td>
              <td className="min-w-64 px-4 py-3 text-sm text-text-primary">
                {row.topRecurring ? (
                  <>
                    <div title={row.topRecurring.text} className="line-clamp-2">{row.topRecurring.text}</div>
                    <div className="mt-0.5 text-xs font-bold text-accent">{formatVisitCount(row.topRecurring.visitCount)}</div>
                  </>
                ) : (
                  <span className="text-text-muted">—</span>
                )}
              </td>
              <td className="px-2 py-3 text-center text-xl leading-none text-text-muted">
                <span aria-hidden="true">›</span>
              </td>
            </ClickableTableRow>
          ))}
        </tbody>
      </table>
    </Card>
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
          <span>{formatIstDate(visit.visit_date)}</span>
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
                  {formatIstDate(visit.visit_date)}
                </td>
                <td className="whitespace-nowrap px-4 py-4">
                  <span className={`inline-flex ${statusBadgeClass(visit.status)}`}>
                    {formatStatus(visit.status)}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatIstTimestamp(visit.inserted_at)}
                </td>
                <td className="whitespace-nowrap px-4 py-4 text-sm font-mono text-text-secondary">
                  {formatIstTimestamp(visit.completed_at)}
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

function VisitsTab({
  summary: { visits, actionSummaries, currentPage, totalPages, sort, dir },
  currentParams,
}: {
  summary: SummaryResult;
  currentParams: SummarySearchParams;
}) {
  if (visits.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-text-muted uppercase tracking-wide">No visits match your filters</div>
      </div>
    );
  }

  return (
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
        currentParams={currentParams}
      />

      <PaginationControls
        currentPage={currentPage}
        totalPages={totalPages}
        sort={sort}
        dir={dir}
        currentParams={currentParams}
      />
    </>
  );
}

function SchoolWiseTab({
  summary: { view, sort },
  currentParams,
}: {
  summary: SchoolWiseResult;
  currentParams: SummarySearchParams;
}) {
  const schools = view.stats.schools;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <p className="text-sm font-bold text-text-primary">
            {schools} school{schools === 1 ? "" : "s"}
          </p>
          <ConcernFreshnessLine freshness={view.freshness} />
        </div>
        {/* Remounts when the param changes (e.g. Clear filters), so the box follows the URL. */}
        <RecurringOnlyToggle key={currentParams.recurring ?? ""} currentParams={currentParams} />
      </div>

      {view.rows.length === 0 ? (
        <div className="py-12 text-center">
          <div className="text-text-muted uppercase tracking-wide">No schools match your filters</div>
        </div>
      ) : (
        <SchoolWiseTable rows={view.rows} sort={sort} currentParams={currentParams} />
      )}
    </>
  );
}

export default async function SchoolVisitSummaryPage({ searchParams }: PageProps) {
  const { actor } = await requireVisitSummaryPage();
  const rawSearchParams = await searchParams;

  const tab = normalizeTab(rawSearchParams.tab);
  const summary = tab === "visits"
    ? { tab: "visits" as const, ...(await getSummaryVisits(actor, rawSearchParams)) }
    : { tab: "schools" as const, ...(await getSchoolWiseSummary(actor, rawSearchParams)) };
  const { headerStats } = summary;

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
            {actor.role === "admin" && (
              <Link href="/admin" className="text-sm font-bold uppercase text-accent hover:text-accent-hover">
                Admin
              </Link>
            )}
            <span className="hidden font-mono text-sm text-text-muted sm:inline">{actor.email}</span>
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
              {formatVisitCount(headerStats.totalVisits)} found
            </p>
          </div>
        </div>

        <VisitSummaryFilterBar
          regionOptions={summary.regionOptions}
          schoolOptions={summary.schoolOptions}
          pmOptions={summary.pmOptions}
          currentParams={rawSearchParams}
        />

        <StatCards stats={headerStats} />

        <SummaryTabs tab={summary.tab} currentParams={rawSearchParams} />

        {summary.tab === "visits"
          ? <VisitsTab summary={summary} currentParams={rawSearchParams} />
          : <SchoolWiseTab summary={summary} currentParams={rawSearchParams} />}
      </main>
    </div>
  );
}
