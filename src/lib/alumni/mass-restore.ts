import { query } from "@/lib/db";
import { CODE_COLUMNS } from "./entry";
import { ROLE_NAMES, changedColumns, codeNames, fieldLabel, postJourney, rowSnapshot, type JourneyNote, type Snapshot } from "./journey";
import type { HistoryGroup, RestorePlan, RestorePlanItem, RestoreResult, RestoreScope } from "./mass-restore-types";

// Mass restore: put every alumnus in a scope (all alumni, or one school's)
// back to how they were at a moment. For each alumnus changed after it, the
// version to go back to is their latest history row recorded at or before it;
// when their first recorded change came later, it is the `initial` copy kept
// before that change (or no answers at all, when they had none). Each one is
// written like a single restore — a `correction` call through the DB Service
// — so a mass restore can itself be undone. Alumni added after the moment are
// listed, never removed.
//
// A school's alumni are those whose latest school it is (canAccessAlumni's rule).

interface CandidateRow extends Record<string, unknown> {
  id: string;
  person: string | null;
  school_name: string | null;
  added_after: boolean;
  target_on: string | null;
  target_data: Snapshot | null;
  first_source: string | null;
  first_on: string | null;
  first_data: Snapshot | null;
}

/** The alumni in scope changed after `at` (or added after it), with the version to go back to. */
async function loadCandidates(scope: RestoreScope, at: Date, alumniIds?: string[]): Promise<CandidateRow[]> {
  const params: unknown[] = [at.toISOString()];
  const where: string[] = [
    `EXISTS (SELECT 1 FROM alumni_journey j WHERE j.alumni_id = a.id AND j.inserted_at > $1::timestamptz AT TIME ZONE 'UTC')
     OR a.inserted_at > $1::timestamptz AT TIME ZONE 'UTC'`,
  ];
  if (scope.kind === "school") {
    params.push(scope.code);
    where.push(`sch.code = $${params.length}`);
  }
  if (alumniIds) {
    params.push(alumniIds);
    where.push(`a.id = ANY($${params.length}::bigint[])`);
  }
  return query<CandidateRow>(
    `SELECT a.*, a.id::text AS id,
            NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS person,
            sch.name AS school_name,
            a.inserted_at > $1::timestamptz AT TIME ZONE 'UTC' AS added_after,
            t.reported_on::text AS target_on, t.data AS target_data,
            f.source AS first_source, f.reported_on::text AS first_on, f.data AS first_data
     FROM alumni a
     JOIN student s ON s.id = a.student_id
     JOIN "user" u ON u.id = s.user_id
     LEFT JOIN LATERAL (
       SELECT sc.code, sc.name
       FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
       WHERE er.user_id = s.user_id AND er.group_type = 'school'
       ORDER BY er.academic_year DESC NULLS LAST, er.is_current DESC, er.id DESC
       LIMIT 1
     ) sch ON true
     LEFT JOIN LATERAL (
       SELECT j.reported_on, j.data FROM alumni_journey j
       WHERE j.alumni_id = a.id AND j.inserted_at <= $1::timestamptz AT TIME ZONE 'UTC'
       ORDER BY j.id DESC LIMIT 1
     ) t ON true
     LEFT JOIN LATERAL (
       SELECT j.source, j.reported_on, j.data FROM alumni_journey j
       WHERE j.alumni_id = a.id ORDER BY j.id LIMIT 1
     ) f ON true
     WHERE (${where[0]}) ${where.slice(1).map((w) => `AND ${w}`).join(" ")}
     ORDER BY sch.name NULLS LAST, person, a.id`,
    params,
  );
}

/** The version to go back to: the row at or before the moment, else the copy kept before the first change. */
function target(row: CandidateRow): { data: Snapshot; on: string } {
  if (row.target_data) return { data: row.target_data, on: row.target_on ?? "" };
  if (row.first_source === "initial" && row.first_data) return { data: row.first_data, on: row.first_on ?? "" };
  return { data: {}, on: "" }; // they had no answers before their first recorded change
}

/** Who would change, and how; who was added after the moment. */
export async function planRestore(scope: RestoreScope, at: Date, alumniIds?: string[]): Promise<RestorePlan> {
  const rows = await loadCandidates(scope, at, alumniIds);
  const kept = rows.filter((r) => !r.added_after);
  const targets = new Map(kept.map((r) => [r.id, target(r)]));
  const names = await codeNames([...kept.map(rowSnapshot), ...[...targets.values()].map((t) => t.data)]);
  const show = (column: string, value: unknown) => {
    if (value == null || value === "") return "";
    const kind = CODE_COLUMNS[column as keyof typeof CODE_COLUMNS];
    return kind ? names[kind].get(String(value))?.name ?? String(value) : String(value);
  };

  const items: RestorePlanItem[] = [];
  for (const row of kept) {
    const now = rowSnapshot(row);
    const back = targets.get(row.id)!;
    const columns = changedColumns(now, back.data);
    if (!columns.length) continue;
    items.push({
      alumniId: row.id,
      name: row.person ?? "(no name)",
      school: row.school_name ?? "",
      versionOn: back.on,
      changes: columns.map((c) => ({ label: fieldLabel(c), before: show(c, now[c]), after: show(c, back.data[c]) })),
    });
  }
  const addedAfter = rows
    .filter((r) => r.added_after)
    .map((r) => ({ alumniId: r.id, name: r.person ?? "(no name)", school: r.school_name ?? "" }));
  return { items, addedAfter };
}

/** "23 Nov 2026, 2:00 pm" in India. */
export const istMoment = (at: Date) =>
  at.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/**
 * Restores these alumni (re-checked now, so a change made since the preview
 * is restored too, and one already put back is left alone).
 */
export async function runRestore(
  scope: RestoreScope,
  at: Date,
  alumniIds: string[],
  actor: Omit<JourneyNote, "source" | "notes">,
): Promise<RestoreResult[]> {
  const rows = await loadCandidates(scope, at, alumniIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const where = scope.kind === "school" ? `school ${scope.code}` : "all alumni";
  const results: RestoreResult[] = [];
  for (const alumniId of alumniIds) {
    const row = byId.get(alumniId);
    const name = row?.person ?? "";
    if (!row || row.added_after) {
      results.push({ alumniId, name, result: "unchanged", message: "Nothing to restore.", changed: [] });
      continue;
    }
    const back = target(row);
    const columns = changedColumns(rowSnapshot(row), back.data);
    if (!columns.length) {
      results.push({ alumniId, name, result: "unchanged", message: "Already as it was.", changed: [] });
      continue;
    }
    const data = Object.fromEntries(columns.map((c) => [c, back.data[c] ?? null]));
    const written = await postJourney(alumniId, data, {
      ...actor,
      source: "correction",
      notes: `Mass restore to ${istMoment(at)} (${where})`,
    });
    results.push(
      written.ok
        ? { alumniId, name, result: "restored", changed: columns.map(fieldLabel) }
        : { alumniId, name, result: "error", message: written.error, changed: [] },
    );
  }
  return results;
}

/** Saves further apart than this start a new step. */
const GROUP_GAP_MS = 2 * 60 * 1000;
/** Rows read for the history (the latest), and steps shown. */
const HISTORY_ROWS = 5000;
const HISTORY_GROUPS = 50;

interface HistoryRow {
  alumni_id: string;
  id: string;
  source: HistoryGroup["source"];
  actor_email: string | null;
  actor_role: string | null;
  notes: string | null;
  at: string;
}

/**
 * The scope's history as steps, newest first. The `initial` copies the DB
 * Service keeps before an alumnus's first change are left out: they record
 * no change of their own.
 */
export async function listHistory(scope: RestoreScope): Promise<HistoryGroup[]> {
  const params: unknown[] = [];
  let schoolJoin = "";
  if (scope.kind === "school") {
    params.push(scope.code);
    schoolJoin = `
      JOIN alumni a ON a.id = j.alumni_id
      JOIN student s ON s.id = a.student_id
      JOIN LATERAL (
        SELECT sc.code
        FROM enrollment_record er JOIN school sc ON sc.id = er.group_id
        WHERE er.user_id = s.user_id AND er.group_type = 'school'
        ORDER BY er.academic_year DESC NULLS LAST, er.is_current DESC, er.id DESC
        LIMIT 1
      ) sch ON sch.code = $1`;
  }
  const rows = await query<HistoryRow>(
    `SELECT j.id::text AS id, j.alumni_id::text AS alumni_id, j.source, j.actor_email, j.actor_role, j.notes,
            to_char(j.inserted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
     FROM alumni_journey j ${schoolJoin}
     WHERE j.source <> 'initial'
     ORDER BY j.id DESC
     LIMIT ${HISTORY_ROWS}`,
    params,
  );
  return groupHistory(rows).slice(0, HISTORY_GROUPS);
}

const actorOf = (r: HistoryRow) => r.actor_email || ROLE_NAMES[r.actor_role ?? ""] || r.actor_role || "";

/** Rows newest first → steps: same kind, same person, each save within GROUP_GAP_MS of the next. */
export function groupHistory(rows: HistoryRow[]): HistoryGroup[] {
  const groups: (HistoryGroup & { ids: Set<string>; notes: Set<string> })[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    const by = actorOf(row);
    const sameStep =
      last && last.source === row.source && last.by === by && Date.parse(last.start) - Date.parse(row.at) <= GROUP_GAP_MS;
    if (sameStep) {
      last.start = row.at;
      last.id = row.id;
      last.ids.add(row.alumni_id);
      last.notes.add(row.notes ?? "");
    } else {
      groups.push({ id: row.id, start: row.at, end: row.at, source: row.source, by, alumni: 0, note: "", ids: new Set([row.alumni_id]), notes: new Set([row.notes ?? ""]) });
    }
  }
  return groups.map(({ ids, notes, ...g }) => ({ ...g, alumni: ids.size, note: notes.size === 1 ? [...notes][0] : "" }));
}
