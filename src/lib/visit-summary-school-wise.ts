// The School-wise tab of the School Visit Summary (server-only: reads through `@/lib/db`).
// One row per School with at least one Visit in view (any status). Visits in view come from the
// shared scope module, so the rows follow every filter, the actor's scope and the physical-only rule.
import { query } from "@/lib/db";
import { buildVisitSummaryWhere, type VisitSummaryFilters } from "@/lib/visit-summary-scope";
import type { VisitsActor } from "@/lib/visits-policy";

export type SchoolWiseSortKey = "school_name" | "visits" | "last_visit";
export type SchoolWiseSortDirection = "asc" | "desc";

// The header-sortable columns. Every sort breaks ties by school name.
export const SCHOOL_WISE_SORT_COLUMNS: Record<
  SchoolWiseSortKey,
  { sql: string; defaultDir: SchoolWiseSortDirection }
> = {
  school_name: { sql: "school_name", defaultDir: "asc" },
  visits: { sql: "visits", defaultDir: "desc" },
  last_visit: { sql: "last_visit_date", defaultDir: "desc" },
};

const DEFAULT_SCHOOL_WISE_SORT: SchoolWiseSortKey = "school_name";

export interface SchoolWiseSort {
  sort: SchoolWiseSortKey;
  dir: SchoolWiseSortDirection;
}

export interface SchoolWiseRow {
  schoolCode: string;
  schoolName: string;
  region: string | null;
  visits: number;
  lastVisitDate: string;
}

export interface SchoolWiseView {
  stats: { schools: number; visits: number };
  rows: SchoolWiseRow[];
}

interface SchoolWiseQueryRow {
  school_code: string;
  school_name: string;
  region: string | null;
  visits: string | number;
  last_visit_date: string;
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

export async function getSchoolWiseView(
  actor: VisitsActor,
  filters: VisitSummaryFilters,
  sort: SchoolWiseSort
): Promise<SchoolWiseView> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters);

  const rows = await query<SchoolWiseQueryRow>(
    `SELECT v.school_code,
            COALESCE(s.name, v.school_code) AS school_name,
            s.region,
            COUNT(*) AS visits,
            TO_CHAR(MAX(v.visit_date), 'YYYY-MM-DD') AS last_visit_date
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     ${joinSql}
     WHERE ${whereSql}
     GROUP BY v.school_code, s.name, s.region
     ORDER BY ${buildOrderClause(sort)}`,
    params
  );

  const schoolRows = rows.map((row) => ({
    schoolCode: row.school_code,
    schoolName: row.school_name,
    region: row.region,
    visits: Number(row.visits),
    lastVisitDate: row.last_visit_date,
  }));

  return {
    stats: {
      schools: schoolRows.length,
      visits: schoolRows.reduce((total, row) => total + row.visits, 0),
    },
    rows: schoolRows,
  };
}
