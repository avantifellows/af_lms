import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { istDate } from "./config";
import { ALUMNI_DB_COLUMN, CODE_COLUMNS, type EntryContext } from "./entry";
import { ALUMNI_FIELDS, type Values } from "./fields";

// Alumni history (the `alumni_journey` table, DB Service #867). Every call is
// saved through
//   POST {DB_SERVICE_URL}/alumni/:id/journey
//     { reported_on, source, data, actor_email, actor_role, notes }
// which, in one transaction, applies `data` to the alumni row and adds a
// journey row holding the full record after it. The DB Service works out
// `changed_fields`, keeps an `initial` copy before an alumnus's first change,
// and lets `source: "correction"` clear fields (how a restore works). Rows are
// insert-only and read here from Postgres, in the order they were recorded.

export type JourneySource = "initial" | "call" | "form" | "bulk_upload" | "correction";

export interface JourneyNote {
  source: JourneySource;
  actorEmail: string;
  /** The person's LMS role (alumni_manager, admin, …). */
  actorRole?: string;
  /** The call remark. */
  notes?: string;
  /** The call's outcome (contact status), stored on the row as `contact_status`. */
  contactStatus?: string;
}

export type JourneyWrite = { ok: true } | { ok: false; status: number; error: string };

/**
 * Saves one call: `data` (full field names; college/branch as ids, numbers as
 * numbers) is applied to the alumni row and a history row is added — even
 * when `data` is empty (a call with only a remark).
 */
export async function postJourney(alumniId: string, data: Record<string, unknown>, note: JourneyNote): Promise<JourneyWrite> {
  const dbService = getDbServiceConfig();
  if (!dbService) return { ok: false, status: 503, error: "DB Service is not configured." };
  const response = await fetch(`${dbService.baseUrl}/alumni/${alumniId}/journey`, {
    method: "POST",
    headers: dbService.headers,
    body: JSON.stringify({
      reported_on: istDate(),
      source: note.source,
      data,
      actor_email: note.actorEmail,
      actor_role: note.actorRole ?? null,
      notes: note.notes ?? null,
      contact_status: note.contactStatus || null,
    }),
  });
  if (response.ok) return { ok: true };
  const text = await response.text();
  console.error("[alumni/journey] DB service error:", response.status, text.slice(0, 500));
  return { ok: false, status: 502, error: `Couldn't save — the DB Service answered ${response.status}.` };
}

export type Snapshot = Record<string, unknown>;

const LABEL = new Map(ALUMNI_FIELDS.map((f) => [f.column, f.label]));
const COLUMNS = ALUMNI_FIELDS.map((f) => f.column);

/** One value as stored, for comparing: blanks are null, numbers and ids compare as text (pg returns bigint as text). */
const norm = (v: unknown) => (v == null || v === "" ? null : String(v));

/** Columns whose value differs between two snapshots, in form order. */
export function changedColumns(before: Snapshot, after: Snapshot): string[] {
  return COLUMNS.filter((c) => norm(before[c]) !== norm(after[c]));
}

/** An alumni table row (`a.*`) as a snapshot: full field names. */
export const rowSnapshot = (row: Record<string, unknown>): Snapshot =>
  Object.fromEntries(COLUMNS.map((c) => [c, row[ALUMNI_DB_COLUMN[c]] ?? null]));

/** The alumni row now, as a snapshot (full field names) plus its version. */
async function loadCurrent(alumniId: string): Promise<{ data: Snapshot; version: string } | null> {
  const [row] = await query<Record<string, unknown>>(`SELECT a.*, a.updated_at::text AS row_version FROM alumni a WHERE a.id = $1`, [alumniId]);
  if (!row) return null;
  return { data: rowSnapshot(row), version: String(row.row_version) };
}

/** A field's label, for messages. */
export const fieldLabel = (column: string) => LABEL.get(column) ?? column;

export interface JourneyChange {
  column: string;
  label: string;
  before: string;
  after: string;
}

export interface JourneyEntry {
  id: string;
  reportedOn: string;
  recordedAt: string;
  source: JourneySource;
  /** Who saved it: their email, or what did ("CSV import", "Automatic", …). */
  recordedBy: string;
  notes: string;
  /** What this row changed from the one recorded before it (empty for the first). */
  changes: JourneyChange[];
  /** The record already looks like this row (nothing to restore). */
  matchesCurrent: boolean;
  /** The whole record as of this row, as the form's values (college/branch as codes). */
  values: Values;
  /** College/branch names for those codes. */
  names: Record<string, string>;
}

interface JourneyRow {
  id: string;
  reported_on: string;
  recorded_at: string;
  source: JourneySource;
  actor_email: string | null;
  actor_role: string | null;
  notes: string | null;
  data: Snapshot;
}

/** Rows written without a person (DB Service's own writes). */
export const ROLE_NAMES: Record<string, string> = { system: "Automatic", import: "CSV import", api: "DB Service" };

export type Code = { code: string; name: string };

/** College/branch codes and names for the ids the snapshots hold. */
export async function codeNames(rows: Snapshot[]): Promise<Record<"college" | "branch", Map<string, Code>>> {
  const ids = { college: new Set<string>(), branch: new Set<string>() };
  for (const data of rows) {
    for (const [col, kind] of Object.entries(CODE_COLUMNS)) if (data[col] != null) ids[kind].add(String(data[col]));
  }
  const load = async (table: "college" | "branch", set: Set<string>) => {
    if (!set.size) return new Map<string, Code>();
    const rows = await query<{ id: string; code: string; name: string }>(
      `SELECT id::text, ${table}_id AS code, name FROM ${table} WHERE id = ANY($1::bigint[])`,
      [[...set]],
    );
    return new Map(rows.map((r) => [r.id, { code: r.code, name: r.name }]));
  };
  return { college: await load("college", ids.college), branch: await load("branch", ids.branch) };
}

/** Postgres "relation does not exist": the table isn't created yet. */
const isMissingTable = (error: unknown) => (error as { code?: string })?.code === "42P01";

/** The alumnus's history, newest first. `available` is false while the table doesn't exist. */
export async function loadJourney(alumniId: string): Promise<{ available: boolean; entries: JourneyEntry[] }> {
  let rows: JourneyRow[];
  try {
    rows = await query<JourneyRow>(
      // Ordered by the numeric row id (when recorded) — not by the text `id` selected.
      `SELECT j.id::text AS id, j.reported_on::text AS reported_on,
              to_char(j.inserted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS recorded_at,
              j.source, j.actor_email, j.actor_role, j.notes, j.data
       FROM alumni_journey j WHERE j.alumni_id = $1
       ORDER BY j.id`,
      [alumniId],
    );
  } catch (error) {
    if (isMissingTable(error)) return { available: false, entries: [] };
    throw error;
  }
  const current = (await loadCurrent(alumniId))?.data ?? {};
  const names = await codeNames(rows.map((r) => r.data));
  const kindOf = (column: string) => CODE_COLUMNS[column as keyof typeof CODE_COLUMNS];
  const show = (column: string, value: unknown) => {
    if (norm(value) == null) return "";
    const kind = kindOf(column);
    return kind ? names[kind].get(String(value))?.name ?? String(value) : String(value);
  };
  /** A snapshot as the form's values and code names. */
  const asForm = (data: Snapshot) => {
    const values: Values = {};
    const codeNames: Record<string, string> = {};
    for (const column of COLUMNS) {
      const v = norm(data[column]);
      const kind = kindOf(column);
      const code = kind && v != null ? names[kind].get(v) : undefined;
      values[column] = code ? code.code : v ?? "";
      if (code) codeNames[column] = code.name;
    }
    return { values, names: codeNames };
  };

  const entries = rows.map((row, i): JourneyEntry => {
    const before = i === 0 ? null : rows[i - 1].data;
    const changes = before
      ? changedColumns(before, row.data).map((column) => ({
          column,
          label: LABEL.get(column) ?? column,
          before: show(column, before[column]),
          after: show(column, row.data[column]),
        }))
      : [];
    return {
      id: row.id,
      reportedOn: row.reported_on,
      recordedAt: row.recorded_at,
      source: row.source,
      recordedBy: row.actor_email || ROLE_NAMES[row.actor_role ?? ""] || row.actor_role || "",
      notes: row.notes ?? "",
      changes,
      matchesCurrent: changedColumns(row.data, current).length === 0,
      ...asForm(row.data),
    };
  });
  return { available: true, entries: entries.reverse() };
}

export type RevertResult = { ok: true; changed: string[] } | { ok: false; status: number; error: string };

/**
 * Puts the alumnus's record back to journey row `journeyId`: every field that
 * differs is sent as a `correction` (a blank clears the field), which also
 * adds the history row. `version`: the record's version the person was looking at.
 */
export async function revertToJourney(
  context: EntryContext,
  journeyId: string,
  version: string,
  note: Omit<JourneyNote, "source" | "notes">,
): Promise<RevertResult> {
  const alumniId = context.ids.alumniId;
  const [row] = await query<{ reported_on: string; data: Snapshot }>(
    `SELECT reported_on::text, data FROM alumni_journey WHERE id = $1 AND alumni_id = $2`,
    [journeyId, alumniId],
  );
  if (!row) return { ok: false, status: 404, error: "No such history entry for this alumnus." };
  const current = await loadCurrent(alumniId);
  if (!current || current.version !== version) {
    return { ok: false, status: 409, error: "This record changed after you opened it. Reload, then try again." };
  }
  // An older version can predate fields added since: leave those as they are.
  const columns = changedColumns(current.data, row.data).filter((c) => c in row.data);
  if (!columns.length) return { ok: false, status: 400, error: "The record already matches this version." };

  const data = Object.fromEntries(columns.map((c) => [c, row.data[c] ?? null]));
  const written = await postJourney(alumniId, data, {
    ...note,
    source: "correction",
    notes: `Restored the record of ${row.reported_on} (history #${journeyId})`,
  });
  if (!written.ok) return written;
  return { ok: true, changed: columns.map((c) => LABEL.get(c) ?? c) };
}
