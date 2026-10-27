// The Visit Concerns read model (server-only: reads through `@/lib/db`). Every read of Visit
// Concerns and Visit Highlights goes through this module; the School page extends it.
// Visits in view come from the shared scope module, so everything follows every filter, the
// actor's scope and the physical-only rule. A mention is **live** when its Visit is completed and
// not soft-deleted (deleted Visits are never in view), so a record counts only through Visits in view.
import { PROGRAM_IDS } from "@/lib/constants";
import { query } from "@/lib/db";
import { canViewSchoolInterventionFlags } from "@/lib/intervention-flags";
import {
  buildVisitSummarySchoolPredicate,
  buildVisitSummaryWhere,
  type VisitSummaryFilters,
} from "@/lib/visit-summary-scope";
import { RECURRING_CONCERN_MIN_VISITS } from "@/lib/visit-summary";
import type { VisitsActor } from "@/lib/visits-policy";

export type SchoolWiseSortKey = "school_name" | "visits" | "last_visit" | "recurring" | "flags";
export type SchoolWiseSortDirection = "asc" | "desc";

// The header-sortable columns. Every sort breaks ties by school name. Flags sorts on the raw count;
// Schools whose flags the viewer may not see then move to the end (see `getSchoolWiseView`).
export const SCHOOL_WISE_SORT_COLUMNS: Record<
  SchoolWiseSortKey,
  { sql: string; defaultDir: SchoolWiseSortDirection }
> = {
  school_name: { sql: "school_name", defaultDir: "asc" },
  visits: { sql: "visits", defaultDir: "desc" },
  last_visit: { sql: "last_visit_date", defaultDir: "desc" },
  recurring: { sql: "recurring_count", defaultDir: "desc" },
  flags: { sql: "open_flags", defaultDir: "desc" },
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
  // Open intervention flags at the School, excluding JNV NVS ones; null when the viewer may not
  // see the School's flags.
  flagsOpen: number | null;
  topRecurring: TopRecurringConcern | null;
  // Completed Visits in view at the School with no note summary yet.
  waitingVisits: number;
}

// `summarisedUpTo` is the latest summary run over all Visits (null: never summarised);
// `waitingVisits` counts the completed Visits in view with no summary yet, at the Schools kept
// (so it follows `recurringOnly` like the stats).
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
  af_school_category: string | null;
  visits: string | number;
  last_visit_date: string;
  recurring_count: string | number;
  open_count: string | number;
  top_recurring_id: string | number | null;
  top_recurring_text: string | null;
  top_recurring_visit_count: string | number | null;
  open_flags: string | number;
  waiting_visits: string | number;
}

interface FreshnessQueryRow {
  summarised_up_to: Date | string | null;
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
// (open, live mentions in RECURRING_CONCERN_MIN_VISITS+ distinct Visits in view; same-day Visits
// count separately), its open
// Concerns (open, 1+ live mention in view) and its top Recurring Concern (most Visits, then the
// most recent mention's visit_date, then the lowest id). Resolved Concerns and Highlights never count.
// `filters.recurringOnly` keeps only Schools with a Recurring Concern; the stats and the waiting
// count follow the rows kept.
// Open intervention flags are counted per School in the same query (JNV NVS flags never count) and
// shown only where the viewer passes the intervention-flag view rule for that School.
export async function getSchoolWiseView(
  actor: VisitsActor,
  filters: VisitSummaryFilters,
  sort: SchoolWiseSort
): Promise<SchoolWiseView> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters);
  const nvsProgramIndex = params.length + 1;
  const recurringIndex = params.length + 2;

  const rowsQuery = query<SchoolWiseQueryRow>(
    `WITH visits_in_view AS (
       SELECT v.id, v.school_code, v.visit_date, v.status,
              COALESCE(s.name, v.school_code) AS school_name, s.region, s.af_school_category,
              EXISTS (SELECT 1 FROM lms_visit_note_summaries ns WHERE ns.visit_id = v.id) AS summarised
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
              COUNT(*) FILTER (WHERE visit_count >= $${recurringIndex}) AS recurring_count,
              COUNT(*) AS open_count
       FROM open_concerns
       GROUP BY school_code
     ),
     top_recurring AS (
       SELECT DISTINCT ON (school_code) school_code, id, text, visit_count
       FROM open_concerns
       WHERE visit_count >= $${recurringIndex}
       ORDER BY school_code, visit_count DESC, last_mentioned_on DESC, id ASC
     ),
     school_visits AS (
       SELECT school_code, school_name, region, af_school_category,
              COUNT(*) AS visits,
              MAX(visit_date) AS last_visited_on,
              COUNT(*) FILTER (WHERE status = 'completed' AND NOT summarised) AS waiting_visits
       FROM visits_in_view
       GROUP BY school_code, school_name, region, af_school_category
     ),
     school_flags AS (
       SELECT sch.code AS school_code, COUNT(*) AS open_flags
       FROM lms_student_intervention_flags f
       JOIN school sch ON sch.id = f.school_id
       WHERE f.status = 'open'
         AND f.program_id IS DISTINCT FROM $${nvsProgramIndex}
         AND sch.code IN (SELECT school_code FROM visits_in_view)
       GROUP BY sch.code
     )
     SELECT sv.school_code,
            sv.school_name,
            sv.region,
            sv.af_school_category,
            sv.visits,
            TO_CHAR(sv.last_visited_on, 'YYYY-MM-DD') AS last_visit_date,
            COALESCE(sc.recurring_count, 0) AS recurring_count,
            COALESCE(sc.open_count, 0) AS open_count,
            tr.id AS top_recurring_id,
            tr.text AS top_recurring_text,
            tr.visit_count AS top_recurring_visit_count,
            COALESCE(sf.open_flags, 0) AS open_flags,
            sv.waiting_visits
     FROM school_visits sv
     LEFT JOIN school_concerns sc ON sc.school_code = sv.school_code
     LEFT JOIN top_recurring tr ON tr.school_code = sv.school_code
     LEFT JOIN school_flags sf ON sf.school_code = sv.school_code
     ORDER BY ${buildOrderClause(sort)}`,
    [...params, PROGRAM_IDS.NVS, RECURRING_CONCERN_MIN_VISITS]
  );
  // The latest summary run over all Visits. summarised_at holds UTC in a timestamp without time zone.
  const freshnessQuery = query<FreshnessQueryRow>(
    `SELECT MAX(summarised_at) AT TIME ZONE 'UTC' AS summarised_up_to FROM lms_visit_note_summaries`
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
    flagsOpen: canViewSchoolInterventionFlags(actor.permission, {
      code: row.school_code,
      region: row.region,
      af_school_category: row.af_school_category,
    })
      ? Number(row.open_flags)
      : null,
    topRecurring: row.top_recurring_id === null || row.top_recurring_text === null
      ? null
      : {
          id: Number(row.top_recurring_id),
          text: row.top_recurring_text,
          visitCount: Number(row.top_recurring_visit_count),
        },
    waitingVisits: Number(row.waiting_visits),
  }));
  const keptRows = filters.recurringOnly ? allRows.filter((row) => row.recurringCount > 0) : allRows;
  // The SQL sorted by the raw flag count; "—" rows go last in either direction, keeping that order.
  const schoolRows = sort.sort === "flags"
    ? [...keptRows.filter((row) => row.flagsOpen !== null), ...keptRows.filter((row) => row.flagsOpen === null)]
    : keptRows;

  return {
    stats: {
      schools: schoolRows.length,
      visits: schoolRows.reduce((total, row) => total + row.visits, 0),
      schoolsWithRecurring: schoolRows.filter((row) => row.recurringCount > 0).length,
      openConcerns: schoolRows.reduce((total, row) => total + row.openCount, 0),
    },
    freshness: {
      summarisedUpTo: freshness?.summarised_up_to ? new Date(freshness.summarised_up_to) : null,
      waitingVisits: schoolRows.reduce((total, row) => total + row.waitingVisits, 0),
    },
    rows: schoolRows,
  };
}

export type ConcernEventKind = "resolved" | "reopened" | "comment" | "auto_reopened";

// One entry of a concern's history, oldest first. `authorName` comes from the author's
// user_permission row (null when they have none); `auto_reopened` entries have no author, but name
// the Visit that raised the concern again.
export interface ConcernHistoryEntry {
  kind: ConcernEventKind;
  body: string | null;
  authorEmail: string | null;
  authorName: string | null;
  visitId: number | null;
  visitDate: string | null;
  at: Date;
}

// A Visit Concern or Visit Highlight on the School page. `visitDates` holds one `YYYY-MM-DD` per
// live-mention Visit in view (same-day Visits repeat), newest first. Highlights have no status,
// history or reopened marker.
export interface ConcernCard {
  id: number;
  kind: "concern" | "highlight";
  text: string;
  status: "open" | "resolved" | null;
  visitCount: number;
  visitDates: string[];
  reopened: boolean;
  history: ConcernHistoryEntry[];
}

export interface VisitNoteItem {
  id: number;
  kind: "concern" | "highlight";
  text: string;
  status: "open" | "resolved" | null;
}

export interface VisitNotes {
  visitId: number;
  visitDate: string;
  status: string;
  pmEmail: string;
  pmName: string | null;
  concerns: VisitNoteItem[];
  highlights: VisitNoteItem[];
}

export interface SchoolConcernPage {
  needsAttention: ConcernCard[];
  goingWell: ConcernCard[];
  resolved: ConcernCard[];
  visitNotes: VisitNotes[];
}

interface SchoolVisitRow {
  id: string | number;
  visit_date: string;
  status: string;
  pm_email: string;
  pm_name: string | null;
}

interface MentionRow {
  id: string | number;
  kind: "concern" | "highlight";
  text: string;
  status: "open" | "resolved" | null;
  visit_id: string | number;
}

interface EventRow {
  concern_id: string | number;
  kind: ConcernEventKind;
  body: string | null;
  author_email: string | null;
  author_name: string | null;
  visit_id: string | number | null;
  visit_date: string | null;
  at: Date | string;
}

// Name lookup by email in a scalar subquery: an email with case-variant duplicate permission rows
// still yields one row (the first permission row's name).
function permissionNameSql(emailColumn: string): string {
  return `(SELECT NULLIF(TRIM(up.full_name), '') FROM user_permission up
           WHERE LOWER(up.email) = LOWER(${emailColumn})
           ORDER BY up.id LIMIT 1)`;
}

// Each concern's history, oldest first, keyed by concern id.
async function getConcernHistories(concernIds: number[]): Promise<Map<number, ConcernHistoryEntry[]>> {
  const historyById = new Map<number, ConcernHistoryEntry[]>();
  if (concernIds.length === 0) return historyById;
  // inserted_at holds UTC in a timestamp without time zone.
  const events = await query<EventRow>(
    `SELECT e.concern_id, e.kind, e.body, e.author_email,
            ${permissionNameSql("e.author_email")} AS author_name,
            e.visit_id, TO_CHAR(ev.visit_date, 'YYYY-MM-DD') AS visit_date,
            e.inserted_at AT TIME ZONE 'UTC' AS at
     FROM lms_visit_concern_events e
     LEFT JOIN lms_pm_school_visits ev ON ev.id = e.visit_id
     WHERE e.concern_id = ANY($1::bigint[])
     ORDER BY e.inserted_at ASC, e.id ASC`,
    [concernIds]
  );
  for (const event of events) {
    const id = Number(event.concern_id);
    const history = historyById.get(id) ?? [];
    history.push({
      kind: event.kind,
      body: event.body,
      authorEmail: event.author_email,
      authorName: event.author_name,
      visitId: event.visit_id === null ? null : Number(event.visit_id),
      visitDate: event.visit_date,
      at: new Date(event.at),
    });
    historyById.set(id, history);
  }
  return historyById;
}

function isReopened(history: ConcernHistoryEntry[]): boolean {
  return history.some((entry) => entry.kind === "reopened" || entry.kind === "auto_reopened");
}

// Most Visits first, then the most recent mention, then the lowest id (the School-wise tab's
// top-recurring order).
function compareCards(a: ConcernCard, b: ConcernCard): number {
  return b.visitCount - a.visitCount
    || (b.visitDates[0] ?? "").localeCompare(a.visitDates[0] ?? "")
    || a.id - b.id;
}

// The School page's concern sections, from the Visits in view at one School (every filter, the
// actor's scope and the physical-only rule apply). Only live mentions (completed Visits in view)
// count, so a record with none in view — including one mentioned only by soft-deleted or
// in-progress Visits — doesn't show. Visit-wise notes list every Visit in view, newest first.
// The caller has already checked the School is one the actor may see.
export async function getSchoolConcernPage(
  actor: VisitsActor,
  schoolCode: string,
  filters: VisitSummaryFilters
): Promise<SchoolConcernPage> {
  const { whereSql, joinSql, params } = buildVisitSummaryWhere(actor, filters);
  const schoolIndex = params.length + 1;

  const visits = await query<SchoolVisitRow>(
    `SELECT v.id, TO_CHAR(v.visit_date, 'YYYY-MM-DD') AS visit_date, v.status, v.pm_email,
            ${permissionNameSql("v.pm_email")} AS pm_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     ${joinSql}
     WHERE ${whereSql} AND v.school_code = $${schoolIndex}
     ORDER BY v.visit_date DESC, v.id DESC`,
    [...params, schoolCode]
  );

  const liveVisitIds = visits.filter((visit) => visit.status === "completed").map((visit) => Number(visit.id));
  const mentions = liveVisitIds.length === 0
    ? []
    : await query<MentionRow>(
      `SELECT c.id, c.kind, c.text, c.status, m.visit_id
       FROM lms_visit_concerns c
       JOIN lms_visit_concern_mentions m ON m.concern_id = c.id
       WHERE c.school_code = $1 AND m.visit_id = ANY($2::bigint[])`,
      [schoolCode, liveVisitIds]
    );

  const concernIds = [...new Set(mentions.filter((row) => row.kind === "concern").map((row) => Number(row.id)))];
  const historyById = await getConcernHistories(concernIds);
  const visitDateById = new Map(visits.map((visit) => [Number(visit.id), visit.visit_date]));

  const cardsById = new Map<number, ConcernCard>();
  const itemsByVisit = new Map<number, VisitNoteItem[]>();
  for (const mention of mentions) {
    const id = Number(mention.id);
    const visitId = Number(mention.visit_id);
    const history = historyById.get(id) ?? [];
    const card = cardsById.get(id) ?? {
      id,
      kind: mention.kind,
      text: mention.text,
      status: mention.status,
      visitCount: 0,
      visitDates: [],
      reopened: isReopened(history),
      history,
    };
    card.visitCount += 1;
    card.visitDates.push(visitDateById.get(visitId) ?? "");
    cardsById.set(id, card);

    const items = itemsByVisit.get(visitId) ?? [];
    items.push({ id, kind: mention.kind, text: mention.text, status: mention.status });
    itemsByVisit.set(visitId, items);
  }

  const cards = [...cardsById.values()];
  for (const card of cards) {
    card.visitDates.sort((a, b) => b.localeCompare(a));
  }
  cards.sort(compareCards);
  const byId = (a: VisitNoteItem, b: VisitNoteItem) => a.id - b.id;

  return {
    needsAttention: cards.filter((card) => card.kind === "concern" && card.status === "open"),
    goingWell: cards.filter((card) => card.kind === "highlight"),
    resolved: cards.filter((card) => card.kind === "concern" && card.status === "resolved"),
    visitNotes: visits.map((visit) => {
      const items = itemsByVisit.get(Number(visit.id)) ?? [];
      return {
        visitId: Number(visit.id),
        visitDate: visit.visit_date,
        status: visit.status,
        pmEmail: visit.pm_email,
        pmName: visit.pm_name,
        concerns: items.filter((item) => item.kind === "concern").sort(byId),
        highlights: items.filter((item) => item.kind === "highlight").sort(byId),
      };
    }),
  };
}

// The concern behind a Resolve / Comment / Reopen, when the actor can see it on the Visit Summary:
// its School is on the actor's Visit Summary (`buildVisitSummarySchoolPredicate`), and it has at
// least one live mention. Null otherwise (also for a missing id), so a caller can't tell them apart.
export async function findVisitSummaryConcern(
  actor: VisitsActor,
  concernId: number
): Promise<{ id: number; schoolCode: string } | null> {
  const onSummary = buildVisitSummarySchoolPredicate(actor, {
    startIndex: 2,
    schoolCodeColumn: "s.code",
    schoolRegionColumn: "s.region",
  });
  const rows = await query<{ id: string | number; school_code: string }>(
    `SELECT c.id, c.school_code
     FROM lms_visit_concerns c
     JOIN school s ON s.code = c.school_code
     WHERE c.id = $1
       AND ${onSummary.clause}
       AND EXISTS (
         SELECT 1 FROM lms_visit_concern_mentions m
         JOIN lms_pm_school_visits v ON v.id = m.visit_id
         WHERE m.concern_id = c.id AND v.status = 'completed' AND v.deleted_at IS NULL
       )
     LIMIT 1`,
    [concernId, ...onSummary.params]
  );
  const row = rows[0];
  return row ? { id: Number(row.id), schoolCode: row.school_code } : null;
}
