import { query } from "@/lib/db";
import { CODE_COLUMNS } from "./entry";
import { ROLE_NAMES, changedColumns, codeNames, fieldLabel, postJourney, rowSnapshot, type JourneyNote, type Snapshot } from "./journey";
import type { HistoryGroup, RestorePlan, RestorePlanItem, RestoreResult, RestoreScope } from "./mass-restore-types";

//// Undoing one change for many alumni (all of them, or one school's): a "step"
// in the history — one person's saves of one kind, close together (a bulk
// edit, a run of calls, a restore). Only the alumni that step touched go back,
// each to their own version from just before it (their latest history row
// before their first row in the step: the DB Service's `initial` copy when the
// step was their first change, or no answers at all when the step created
// them). Anyone changed again after the step — by anyone — is left as they
// are and listed, so later work is never undone. Each undo is written like a
// single restore — a `correction` call through the DB Service — so it can
// itself be undone.
//
// A school's alumni are those whose latest school it is (canAccessAlumni's rule).

/** A step, as its first and last history row ids plus who made it (read from the rows, not trusted). */
export interface RestoreStep {
  fromId: string;
  toId: string;
  source: string;
  actorEmail: string | null;
  actorRole: string | null;
  /** When it started (ISO, UTC). */
  at: string;
}

/** The step between these history rows (made by the first row's person and kind), or null. */
export async function findStep(fromId: string, toId: string): Promise<RestoreStep | null> {
  const [row] = await query<{ source: string; actor_email: string | null; actor_role: string | null; at: string; last_ok: boolean }>(
    `SELECT f.source, f.actor_email, f.actor_role, to_char(f.inserted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at,
            EXISTS (
              SELECT 1 FROM alumni_journey t
              WHERE t.id = $2::bigint AND t.id >= f.id AND t.source = f.source
                AND t.actor_email IS NOT DISTINCT FROM f.actor_email AND t.actor_role IS NOT DISTINCT FROM f.actor_role
            ) AS last_ok
     FROM alumni_journey f WHERE f.id = $1::bigint`,
    [fromId, toId],
  );
  if (!row?.last_ok) return null;
  return { fromId, toId, source: row.source, actorEmail: row.actor_email, actorRole: row.actor_role, at: row.at };
}

interface CandidateRow extends Record<string, unknown> {
  id: string;
  person: string | null;
  school_name: string | null;
  row_version: string;
  changed_later: boolean;
  target_on: string | null;
  target_data: Snapshot | null;
}

/** The alumni the step touched (in scope), each with the version from just before their part of it. */
async function loadCandidates(scope: RestoreScope, step: RestoreStep, alumniIds?: string[]): Promise<CandidateRow[]> {
  const params: unknown[] = [step.fromId, step.toId, step.source, step.actorEmail, step.actorRole];
  const where: string[] = [];
  if (scope.kind === "school") {
    params.push(scope.code);
    where.push(`sch.code = $${params.length}`);
  }
  if (alumniIds) {
    params.push(alumniIds);
    where.push(`a.id = ANY($${params.length}::bigint[])`);
  }
  return query<CandidateRow>(
    `WITH step AS (
       SELECT j.alumni_id, min(j.id) AS first_id, max(j.id) AS last_id
       FROM alumni_journey j
       WHERE j.id BETWEEN $1::bigint AND $2::bigint AND j.source = $3
         AND j.actor_email IS NOT DISTINCT FROM $4::text AND j.actor_role IS NOT DISTINCT FROM $5::text
       GROUP BY j.alumni_id
     )
     SELECT a.*, a.id::text AS id, a.updated_at::text AS row_version,
            NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), '') AS person,
            sch.name AS school_name,
            EXISTS (SELECT 1 FROM alumni_journey l WHERE l.alumni_id = a.id AND l.id > st.last_id) AS changed_later,
            t.reported_on::text AS target_on, t.data AS target_data
     FROM step st
     JOIN alumni a ON a.id = st.alumni_id
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
       WHERE j.alumni_id = a.id AND j.id < st.first_id
       ORDER BY j.id DESC LIMIT 1
     ) t ON true
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY sch.name NULLS LAST, person, a.id`,
    params,
  );
}

/** What to write to undo the step for one alumnus: the fields that differ from their version before it. */
function undoFor(row: CandidateRow): { columns: string[]; data: Snapshot; on: string } {
  const back = row.target_data ?? {}; // no earlier row: the step created them, or they had no answers
  const now = rowSnapshot(row);
  // An older version can predate fields added since: leave those as they are.
  const known = Object.keys(back).length ? (c: string) => c in back : () => true;
  const columns = changedColumns(now, back).filter(known);
  return { columns, data: back, on: row.target_on ?? "" };
}

const person = (row: CandidateRow) => ({ alumniId: row.id, name: row.person ?? "(no name)", school: row.school_name ?? "" });

/** Who would go back, and how; who was changed again after the step (left as they are). */
export async function planRestore(scope: RestoreScope, step: RestoreStep, alumniIds?: string[]): Promise<RestorePlan> {
  const rows = await loadCandidates(scope, step, alumniIds);
  const open = rows.filter((r) => !r.changed_later);
  const undos = new Map(open.map((r) => [r.id, undoFor(r)]));
  const names = await codeNames([...open.map(rowSnapshot), ...[...undos.values()].map((u) => u.data)]);
  const show = (column: string, value: unknown) => {
    if (value == null || value === "") return "";
    const kind = CODE_COLUMNS[column as keyof typeof CODE_COLUMNS];
    return kind ? names[kind].get(String(value))?.name ?? String(value) : String(value);
  };

  const items: RestorePlanItem[] = [];
  for (const row of open) {
    const now = rowSnapshot(row);
    const undo = undos.get(row.id)!;
    if (!undo.columns.length) continue;
    items.push({
      ...person(row),
      versionOn: undo.on,
      version: row.row_version,
      changes: undo.columns.map((c) => ({ label: fieldLabel(c), before: show(c, now[c]), after: show(c, undo.data[c]) })),
    });
  }
  return { items, changedLater: rows.filter((r) => r.changed_later).map(person) };
}

/** "23 Nov 2026, 2:00 pm" in India. */
export const istMoment = (at: Date) =>
  at.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

/** One alumnus's undo, given their candidate row (re-read now). `version`: what the preview showed. */
async function restoreOne(
  alumniId: string,
  row: CandidateRow | undefined,
  version: string | undefined,
  note: JourneyNote,
): Promise<RestoreResult> {
  const name = row?.person ?? "";
  if (!row) return { alumniId, name, result: "unchanged", message: "Not part of this change.", changed: [] };
  if (row.changed_later) {
    return { alumniId, name, result: "skipped", message: "Changed again after this change — left as it is.", changed: [] };
  }
  // Someone saved this alumnus after the preview: undoing now would also undo that unseen save.
  if (version && version !== row.row_version) {
    return { alumniId, name, result: "skipped", message: "Changed since the preview — check again to include it.", changed: [] };
  }
  const undo = undoFor(row);
  if (!undo.columns.length) return { alumniId, name, result: "unchanged", message: "Already as it was.", changed: [] };
  const data = Object.fromEntries(undo.columns.map((c) => [c, undo.data[c] ?? null]));
  const written = await postJourney(alumniId, data, note);
  return written.ok
    ? { alumniId, name, result: "restored", changed: undo.columns.map(fieldLabel) }
    : { alumniId, name, result: "error", message: written.error, changed: [] };
}

const SOURCE_NAMES: Record<string, string> = { call: "calls", form: "saves", bulk_upload: "bulk edit", correction: "restore" };

/**
 * Undoes the step for these alumni, re-read now: one changed again since the
 * step, or since the preview (`versions`, from the plan), is skipped rather
 * than reverted unseen; one already back is left alone.
 */
export async function runRestore(
  scope: RestoreScope,
  step: RestoreStep,
  alumniIds: string[],
  actor: Omit<JourneyNote, "source" | "notes">,
  versions: Record<string, string> = {},
): Promise<RestoreResult[]> {
  const rows = await loadCandidates(scope, step, alumniIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const by = step.actorEmail || ROLE_NAMES[step.actorRole ?? ""] || step.actorRole || "someone";
  const note: JourneyNote = {
    ...actor,
    source: "correction",
    notes: `Undid the ${SOURCE_NAMES[step.source] ?? step.source} by ${by} on ${istMoment(new Date(step.at))} (history #${step.fromId}–#${step.toId})`,
  };
  const results: RestoreResult[] = [];
  for (const alumniId of alumniIds) results.push(await restoreOne(alumniId, byId.get(alumniId), versions[alumniId], note));
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

/**
 * Rows newest first → steps: same kind, same person, each save within
 * GROUP_GAP_MS of the next. Someone else's saves in between don't split a
 * step (a bulk edit stays one step); undoing a step picks only its own rows.
 */
export function groupHistory(rows: HistoryRow[]): HistoryGroup[] {
  type Open = HistoryGroup & { ids: Set<string>; notes: Set<string> };
  const groups: Open[] = [];
  /** The step still open for each kind + person. */
  const open = new Map<string, Open>();
  for (const row of rows) {
    const by = actorOf(row);
    const key = `${row.source}|${by}`;
    const step = open.get(key);
    if (step && Date.parse(step.start) - Date.parse(row.at) <= GROUP_GAP_MS) {
      step.start = row.at;
      step.id = row.id;
      step.ids.add(row.alumni_id);
      step.notes.add(row.notes ?? "");
    } else {
      const created: Open = {
        id: row.id, lastId: row.id, start: row.at, end: row.at, source: row.source, by, alumni: 0, note: "",
        ids: new Set([row.alumni_id]), notes: new Set([row.notes ?? ""]),
      };
      groups.push(created);
      open.set(key, created);
    }
  }
  return groups.map(({ ids, notes, ...g }) => ({ ...g, alumni: ids.size, note: notes.size === 1 ? [...notes][0] : "" }));
}
