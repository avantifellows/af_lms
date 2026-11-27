import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { needsConfirm, type Issue } from "./checks";
import { CODE_COLUMNS, type EntryContext } from "./entry";
import { ALUMNI_FIELDS, type Values } from "./fields";
import { lookupCodes, type CodeLookup } from "./reference";
import { postJourney, type JourneyNote } from "./journey";
import { checkContext, reviewSave } from "./validation";

// Saving one student's alumni answers. Nothing from the browser is trusted
// except the answers, and those are re-checked here; who the student is,
// new vs edit, and what's on record all come fresh from Postgres.
//
// The write goes to the DB Service (never Postgres directly), as a call that
// also adds the alumnus's history row (journey.ts):
//   - no alumni row yet → POST {DB_SERVICE_URL}/alumni { student_id } (empty),
//                         then the answers as below, so the history says who added them
//   - row exists        → POST {DB_SERVICE_URL}/alumni/:id/journey { data: fields, ... }
// Only fields that are filled in and differ from the record are sent, so a
// blank never erases a saved value. Nothing is ever deleted.

export type SaveResult =
  | {
      ok: true;
      alumniId: string;
      action: "inserted" | "updated";
      changed: string[];
      notCleared: string[];
      /** The record's new version, for the form's next save. */
      version: string;
      /** The call remark saved with the history row. */
      remark?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
      fieldErrors?: Record<string, string>;
      warnings?: Issue[];
      /** Nothing to write: every answer is already on record (or blank). */
      nothing?: true;
      /** With `nothing`: saved values the person blanked, which a save never clears. */
      notCleared?: string[];
    };

const FIELD = new Map(ALUMNI_FIELDS.map((f) => [f.column, f]));

type Failure = Extract<SaveResult, { ok: false }>;
type CodeColumn = keyof typeof CODE_COLUMNS;

/** College/branch codes must exist, as that kind; their ids are what the alumni table stores. */
async function resolveCodes(values: Values, fieldErrors: Record<string, string>): Promise<CodeLookup> {
  const codeCols = Object.keys(CODE_COLUMNS) as CodeColumn[];
  const filled = codeCols.filter((c) => values[c]);
  const codes = await lookupCodes(
    filled.filter((c) => CODE_COLUMNS[c] === "college").map((c) => values[c]),
    filled.filter((c) => CODE_COLUMNS[c] === "branch").map((c) => values[c]),
  );
  for (const col of filled) {
    if (!codes[CODE_COLUMNS[col]].has(values[col])) fieldErrors[col] = "Unknown code — pick from the search list.";
  }
  return codes;
}

/** Why there is nothing to send, when no field changed. */
function nothingToSave(context: EntryContext, notCleared: string[]): Failure {
  const error = notCleared.length
    ? "Clearing a saved value isn't allowed here — nothing else changed."
    : context.kind === "edit" ? "Nothing changed from the alumni record." : "Nothing filled in yet.";
  return { ok: false, status: 400, error, nothing: true, notCleared };
}

/** DB Service payload: the form's (full) field names; college/branch as ids, years/numbers as numbers. */
function toDbFields(changed: string[], values: Values, codes: CodeLookup): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  for (const col of changed) {
    const type = FIELD.get(col)!.type;
    const v = values[col];
    if (col in CODE_COLUMNS) fields[col] = Number(codes[CODE_COLUMNS[col as CodeColumn]].get(v)!.id);
    else fields[col] = type === "year" || type === "number" ? Number(v) : v;
  }
  return fields;
}

type Sent = { ok: true; alumniId: string; action: "inserted" | "updated" } | Failure;

/** Saves the answers as a call, on the alumni row looked up fresh (it may be new since the form opened). */
async function sendToDbService(
  context: EntryContext,
  fields: Record<string, string | number>,
  journey: JourneyNote,
): Promise<Sent> {
  const dbService = getDbServiceConfig();
  if (!dbService) return { ok: false, status: 503, error: "DB Service is not configured." };

  const studentId = context.ids.studentId;
  const [existing] = await query<{ id: string }>(
    `SELECT id FROM alumni WHERE student_id = $1 ORDER BY id DESC LIMIT 1`,
    [studentId],
  );
  // The form was for adding them, but someone added them since (or the other
  // way round): writing now would merge these answers, unchecked, into a
  // record the person never saw.
  if (Boolean(existing) !== (context.kind === "edit")) return CONFLICT;
  return sendAsCall(context, existing?.id, fields, journey);
}

/** The save as a call through the journey endpoint. */
async function sendAsCall(
  context: EntryContext,
  existingId: string | undefined,
  fields: Record<string, string | number>,
  journey: JourneyNote,
): Promise<Sent> {
  let alumniId = existingId;
  if (!alumniId) {
    const created = await createEmptyAlumni(context.ids.studentId);
    if (!created.ok) return created;
    alumniId = created.alumniId;
  }
  // The call's outcome on every row, changed or not (reports count calls by it).
  const contactStatus = String(fields.contact_status ?? context.alumni.contact_status ?? "");
  const written = await postJourney(alumniId, fields, { ...journey, contactStatus });
  if (written.ok) return { ok: true, alumniId, action: existingId ? "updated" : "inserted" };
  if (existingId) return written;
  // The record exists now, without the answers: a reload shows it to edit.
  return { ...written, error: `${written.error} The alumnus was added without these answers — reload and save them again.` };
}

/**
 * A new alumni row with no answers yet (the DB Service writes no history for
 * it). The DB Service's POST updates the row when one exists, answering 200 —
 * so only 201 means it's new; otherwise someone added them meanwhile, and
 * writing now would overwrite their answers unseen.
 */
async function createEmptyAlumni(studentId: string): Promise<{ ok: true; alumniId: string } | Failure> {
  const dbService = getDbServiceConfig()!;
  const response = await fetch(`${dbService.baseUrl}/alumni`, {
    method: "POST",
    headers: dbService.headers,
    body: JSON.stringify({ student_id: Number(studentId) }),
  });
  if (!response.ok) {
    console.error("[alumni] DB service error:", response.status, (await response.text()).slice(0, 500));
    return { ok: false, status: 502, error: `Couldn't save — the DB Service answered ${response.status}.` };
  }
  if (response.status !== 201) return CONFLICT;
  return { ok: true, alumniId: String(((await response.json()) as { id: number | string }).id) };
}

/** The record's version as the form sees it (see EntryContext.version). */
async function currentVersion(alumniId: string): Promise<string> {
  const [row] = await query<{ version: string | null }>(`SELECT updated_at::text AS version FROM alumni WHERE id = $1`, [alumniId]);
  return row?.version ?? "";
}

/** Someone else saved this alumnus after the form loaded it. */
const CONFLICT: Failure = {
  ok: false,
  status: 409,
  error: "Someone else saved changes to this alumnus after you opened it. Reload to see them, then make your changes again.",
};

/** What a save would send: the checked values and the fields that change. */
export type PreparedSave =
  | { ok: true; values: Values; changed: string[]; notCleared: string[]; codes: CodeLookup }
  | Failure;

/**
 * Every check a save runs, without writing anything (the bulk preview uses
 * this alone). `confirmed`: ids of the unusual-answer warnings accepted.
 */
export async function prepareSave(
  context: EntryContext,
  submitted: Values,
  confirmed: string[] = [],
  version?: string,
): Promise<PreparedSave> {
  if (context.kind === "edit" && version !== context.version) return CONFLICT;
  const previous = context.alumni;
  const review = reviewSave(submitted, previous, checkContext(context.profile));
  const { values } = review;
  const codes = await resolveCodes(values, review.errors);
  if (Object.keys(review.errors).length) {
    return { ok: false, status: 400, error: "Some fields need fixing.", fieldErrors: review.errors };
  }

  const unconfirmed = needsConfirm(review.warnings).filter((w) => !confirmed.includes(w.id));
  if (unconfirmed.length) {
    return { ok: false, status: 409, error: "Some answers look unusual — please confirm.", warnings: unconfirmed };
  }

  const changed = Object.keys(values).filter((c) => values[c] && values[c] !== (previous[c] ?? ""));
  const notCleared = Object.keys(values).filter((c) => !values[c] && previous[c]);
  if (!changed.length) return nothingToSave(context, notCleared);
  return { ok: true, values, changed, notCleared, codes };
}

/** Field labels, for messages. */
export const fieldLabels = (columns: string[]) => columns.map((c) => FIELD.get(c)?.label ?? c);

/**
 * `context` must be the student's entry context (already loaded by the route
 * to check school access). `confirmed`: ids of the unusual-answer warnings the
 * person has accepted; any other warning stops the save and is sent back.
 * `version`: the record's version when the form loaded it (edits must send it).
 * `journey`: who is saving and how, for the history row.
 */
export async function saveAlumni(
  context: EntryContext,
  submitted: Values,
  confirmed: string[],
  version: string | undefined,
  journey: JourneyNote,
): Promise<SaveResult> {
  const prepared = await prepareSave(context, submitted, confirmed, version);
  if (!prepared.ok) {
    // A call where nothing changed but something happened ("Wrong phone number").
    if (prepared.nothing && journey.notes && context.kind === "edit") {
      return saveRemarkOnly(context, journey, prepared.notCleared ?? []);
    }
    return prepared;
  }
  const { values, changed, notCleared, codes } = prepared;

  const sent = await sendToDbService(context, toDbFields(changed, values, codes), journey);
  if (!sent.ok) return sent;
  return {
    ...sent,
    ...(journey.notes ? { remark: journey.notes } : {}),
    version: await currentVersion(sent.alumniId),
    changed: fieldLabels(changed),
    notCleared: fieldLabels(notCleared),
  };
}

/**
 * Only the call remark: a history row with no field changes (the alumni row is
 * untouched). `notCleared`: blanked saved values, reported as not cleared.
 */
async function saveRemarkOnly(context: EntryContext, journey: JourneyNote, notCleared: string[]): Promise<SaveResult> {
  const alumniId = context.ids.alumniId;
  const written = await postJourney(alumniId, {}, { ...journey, contactStatus: context.alumni.contact_status });
  if (!written.ok) return { ...written, error: "Couldn't save the remark. Try again." };
  return {
    ok: true,
    alumniId,
    action: "updated",
    changed: [],
    notCleared: fieldLabels(notCleared),
    version: await currentVersion(alumniId),
    remark: journey.notes,
  };
}
