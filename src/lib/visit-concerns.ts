// The Visit Concerns read model (server-only: reads through `@/lib/db`). Every read of Visit
// Concerns and Visit Highlights goes through this module; the School page extends it.
// Visits in view come from the shared scope module, so everything follows every filter, the
// actor's scope and the physical-only rule. A mention is **live** when its Visit is completed and
// not soft-deleted (deleted Visits are never in view), so a record counts only through Visits in view.
import { query } from "@/lib/db";
import { buildVisitSummaryWhere, type VisitSummaryFilters } from "@/lib/visit-summary-scope";
import type { VisitsActor } from "@/lib/visits-policy";

export type SchoolWiseSortKey = "school_name" | "visits" | "last_visit" | "recurring";
export type SchoolWiseSortDirection = "asc" | "desc";

// The header-sortable columns. Every sort breaks ties by school name.
export const SCHOOL_WISE_SORT_COLUMNS: Record<
  SchoolWiseSortKey,
  { sql: string; defaultDir: SchoolWiseSortDirection }
> = {
  school_name: { sql: "school_name", defaultDir: "asc" },
  visits: { sql: "visits", defaultDir: "desc" },
  last_visit: { sql: "last_visit_date", defaultDir: "desc" },
  recurring: { sql: "recurring_count", defaultDir: "desc" },
};

const DEFAULT_SCHOOL_WISE_SORT: SchoolWiseSortKey = "recurring";

export interface SchoolWiseSort {
  sort: SchoolWiseSortKey;
  dir: SchoolWiseSortDirection;
}

export interface TopRecurringConcern {
  id: number;
  text: string;
  visitCount: number;
}

export interface SchoolWiseRow {
  schoolCode: string;
  schoolName: string;
  region: string | null;
  visits: number;
  lastVisitDate: string;
  recurringCount: number;
  openCount: number;
  topRecurring: TopRecurringConcern | null;
}

// `summarisedUpTo` is the latest summary run over all Visits (null: never summarised);
// `waitingVisits` counts the completed Visits in view with no summary yet.
export interface ConcernFreshness {
  summarisedUpTo: Date | null;
  waitingVisits: number;
}

export interface SchoolWiseView {
  stats: { schools: number; visits: number; schoolsWithRecurring: number; openConcerns: number };
  freshness: ConcernFreshness;
  rows: SchoolWiseRow[];
}

interface SchoolWiseQueryRow {
  school_code: string;
  school_name: string;
  region: string | null;
  visits: string | number;
  last_visit_date: string;
  recurring_count: string | number;
  open_count: string | number;
  top_recurring_id: string | number | null;
  top_recurring_text: string | null;
  top_recurring_visit_count: string | number | null;
}

interface FreshnessQueryRow {
  summarised_up_to: Date | string | null;
  waiting_visits: string | number;
}

function isSchoolWiseSortKey(value: string | undefined): value is SchoolWiseSortKey {
  return Boolean(value && Object.prototype.hasOwnProperty.call(SCHOOL_WISE_SORT_COLUMNS, value));
}

// `sort`/`dir` are read per tab: a Visits-tab key (or anything unknown) falls back to the default.
export function normalizeSchoolWiseSort(sortParam?: string, dirParam?: string): SchoolWiseSort {
  const sort = isSchoolWiseSortKey(sortParam) ? sortParam : DEFAULT_SCHOOL_WISE_SORT;
  const dir = dirParam === "asc" || dirParam === "desc" ? dirParam : SCHOOL_WISE_SORT_COLUMNS[sort].defaultDir;
  return { sort, dir };
}

function buildOrderClause({ sort, dir }: SchoolWiseSort): string {
  const primary = `${SCHOOL_WISE_SORT_COLUMNS[sort].sql} ${dir.toUpperCase()}`;
  return sort === "school_name"
    ? `${primary}, school_code ASC`
    : `${primary}, school_name ASC, school_code ASC`;
}

// One row per School with at least one Visit in view (any status), with its Recurring Concerns
// (open, live mentions in 2+ distinct Visits in view; same-day Visits count separately), its open
// Concerns (open, 1+ live mention in view) and its top Recurring Concern (most Visits, then the
// most recent mention's visit_date, then the lowest id). Resolved Concerns and Highlights never count.
// `filters.recurringOnly` keeps only Schools with a Recurring Concern; the stats follow the rows kept.
export async function getSchoolWiseView(
  actor: VisitsActor,
  filters: VisitSummaryFilters,
  sort: SchoolWiseSort
): Promise<SchoolWiseView> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters);

  const rowsQuery = query<SchoolWiseQueryRow>(
    `WITH visits_in_view AS (
       SELECT v.id, v.school_code, v.visit_date, v.status,
              COALESCE(s.name, v.school_code) AS school_name, s.region
       FROM lms_pm_school_visits v
       LEFT JOIN school s ON s.code = v.school_code
       ${joinSql}
       WHERE ${whereSql}
     ),
     open_concerns AS (
       SELECT c.id, c.school_code, c.text,
              COUNT(DISTINCT viv.id) AS visit_count,
              MAX(viv.visit_date) AS last_mentioned_on
       FROM lms_visit_concerns c
       JOIN lms_visit_concern_mentions m ON m.concern_id = c.id
       JOIN visits_in_view viv ON viv.id = m.visit_id
         AND viv.school_code = c.school_code
         AND viv.status = 'completed'
       WHERE c.kind = 'concern' AND c.status = 'open'
       GROUP BY c.id, c.school_code, c.text
     ),
     school_concerns AS (
       SELECT school_code,
              COUNT(*) FILTER (WHERE visit_count >= 2) AS recurring_count,
              COUNT(*) AS open_count
       FROM open_concerns
       GROUP BY school_code
     ),
     top_recurring AS (
       SELECT DISTINCT ON (school_code) school_code, id, text, visit_count
       FROM open_concerns
       WHERE visit_count >= 2
       ORDER BY school_code, visit_count DESC, last_mentioned_on DESC, id ASC
     ),
     school_visits AS (
       SELECT school_code, school_name, region,
              COUNT(*) AS visits,
              MAX(visit_date) AS last_visited_on
       FROM visits_in_view
       GROUP BY school_code, school_name, region
     )
     SELECT sv.school_code,
            sv.school_name,
            sv.region,
            sv.visits,
            TO_CHAR(sv.last_visited_on, 'YYYY-MM-DD') AS last_visit_date,
            COALESCE(sc.recurring_count, 0) AS recurring_count,
            COALESCE(sc.open_count, 0) AS open_count,
            tr.id AS top_recurring_id,
            tr.text AS top_recurring_text,
            tr.visit_count AS top_recurring_visit_count
     FROM school_visits sv
     LEFT JOIN school_concerns sc ON sc.school_code = sv.school_code
     LEFT JOIN top_recurring tr ON tr.school_code = sv.school_code
     ORDER BY ${buildOrderClause(sort)}`,
    params
  );
  // summarised_at holds UTC in a timestamp without time zone.
  const freshnessQuery = query<FreshnessQueryRow>(
    `SELECT (SELECT MAX(summarised_at) FROM lms_visit_note_summaries) AT TIME ZONE 'UTC' AS summarised_up_to,
            COUNT(*) FILTER (WHERE v.status = 'completed' AND ns.visit_id IS NULL) AS waiting_visits
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     LEFT JOIN lms_visit_note_summaries ns ON ns.visit_id = v.id
     ${joinSql}
     WHERE ${whereSql}`,
    params
  );
  const [rows, [freshness]] = await Promise.all([rowsQuery, freshnessQuery]);

  const allRows = rows.map((row): SchoolWiseRow => ({
    schoolCode: row.school_code,
    schoolName: row.school_name,
    region: row.region,
    visits: Number(row.visits),
    lastVisitDate: row.last_visit_date,
    recurringCount: Number(row.recurring_count),
    openCount: Number(row.open_count),
    topRecurring: row.top_recurring_id === null || row.top_recurring_text === null
      ? null
      : {
          id: Number(row.top_recurring_id),
          text: row.top_recurring_text,
          visitCount: Number(row.top_recurring_visit_count),
        },
  }));
  const schoolRows = filters.recurringOnly ? allRows.filter((row) => row.recurringCount > 0) : allRows;

  return {
    stats: {
      schools: schoolRows.length,
      visits: schoolRows.reduce((total, row) => total + row.visits, 0),
      schoolsWithRecurring: schoolRows.filter((row) => row.recurringCount > 0).length,
      openConcerns: schoolRows.reduce((total, row) => total + row.openCount, 0),
    },
    freshness: {
      summarisedUpTo: freshness?.summarised_up_to ? new Date(freshness.summarised_up_to) : null,
      waitingVisits: Number(freshness?.waiting_visits ?? 0),
    },
    rows: schoolRows,
  };
}
