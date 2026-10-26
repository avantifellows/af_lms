import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { needsConfirm, type Issue } from "./checks";
import { CODE_COLUMNS, type EntryContext } from "./entry";
import { ALUMNI_FIELDS, type Values } from "./fields";
import { lookupCodes, type CodeLookup } from "./reference";
import { checkContext, reviewSave } from "./validation";

// Saving one student's alumni answers. Nothing from the browser is trusted
// except the answers, and those are re-checked here; who the student is,
// new vs edit, and what's on record all come fresh from Postgres.
//
// The write goes to the DB Service (never Postgres directly):
//   - no alumni row yet → POST  {DB_SERVICE_URL}/alumni      { student_id, ...fields }
//   - row exists        → PATCH {DB_SERVICE_URL}/alumni/:id  { ...fields }
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
    }
  | { ok: false; status: number; error: string; fieldErrors?: Record<string, string>; warnings?: Issue[] };

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
  return { ok: false, status: 400, error };
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

/** POST a new alumni row or PATCH the existing one (looked up fresh — it may be new since the form opened). */
async function sendToDbService(
  context: EntryContext,
  fields: Record<string, string | number>,
): Promise<{ ok: true; alumniId: string; action: "inserted" | "updated" } | Failure> {
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
  const request = existing
    ? { url: `${dbService.baseUrl}/alumni/${existing.id}`, method: "PATCH", body: fields }
    : { url: `${dbService.baseUrl}/alumni`, method: "POST", body: { student_id: Number(studentId), ...fields } };
  const response = await fetch(request.url, {
    method: request.method,
    headers: dbService.headers,
    body: JSON.stringify(request.body),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("[alumni] DB service error:", response.status, text.slice(0, 500));
    return { ok: false, status: 502, error: `Couldn't save — the DB Service answered ${response.status}.` };
  }
  const saved = (await response.json()) as { id: number | string };
  return { ok: true, alumniId: String(saved.id), action: existing ? "updated" : "inserted" };
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

/**
 * `context` must be the student's entry context (already loaded by the route
 * to check school access). `confirmed`: ids of the unusual-answer warnings the
 * person has accepted; any other warning stops the save and is sent back.
 * `version`: the record's version when the form loaded it (edits must send it).
 */
export async function saveAlumni(
  context: EntryContext,
  submitted: Values,
  confirmed: string[] = [],
  version?: string,
): Promise<SaveResult> {
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

  const sent = await sendToDbService(context, toDbFields(changed, values, codes));
  if (!sent.ok) return sent;
  return {
    ...sent,
    version: await currentVersion(sent.alumniId),
    changed: changed.map((c) => FIELD.get(c)!.label),
    notCleared: notCleared.map((c) => FIELD.get(c)!.label),
  };
}
