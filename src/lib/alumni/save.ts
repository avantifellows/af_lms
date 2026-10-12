import { query } from "@/lib/db";
import { getDbServiceConfig } from "@/lib/db-service-config";
import { needsConfirm, type Issue } from "./checks";
import { CODE_COLUMNS, type EntryContext } from "./entry";
import { ALUMNI_FIELDS, type Values } from "./fields";
import { lookupCodes } from "./reference";
import { checkContext, reviewValues, visibleValues } from "./validation";

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
  | { ok: true; alumniId: string; action: "inserted" | "updated"; changed: string[]; notCleared: string[] }
  | { ok: false; status: number; error: string; fieldErrors?: Record<string, string>; warnings?: Issue[] };

const FIELD = new Map(ALUMNI_FIELDS.map((f) => [f.column, f]));

/**
 * `context` must be the student's entry context (already loaded by the route
 * to check school access). `confirmed`: ids of the unusual-answer warnings the
 * person has accepted; any other warning stops the save and is sent back.
 */
export async function saveAlumni(
  context: EntryContext,
  submitted: Values,
  confirmed: string[] = [],
): Promise<SaveResult> {
  const previous = context.alumni;
  const values = visibleValues(submitted);
  const review = reviewValues(values, previous, checkContext(context.profile));
  const fieldErrors = review.errors;

  // College/branch codes must exist; their ids are what the alumni table stores.
  const codeCols = Object.keys(CODE_COLUMNS) as (keyof typeof CODE_COLUMNS)[];
  const filledCodes = codeCols.filter((c) => values[c]);
  const codes = await lookupCodes(
    filledCodes.filter((c) => CODE_COLUMNS[c] === "college").map((c) => values[c]),
    filledCodes.filter((c) => CODE_COLUMNS[c] === "branch").map((c) => values[c]),
  );
  for (const col of filledCodes) {
    if (!codes.has(values[col])) fieldErrors[col] = "Unknown code — pick from the search list.";
  }
  if (Object.keys(fieldErrors).length) {
    return { ok: false, status: 400, error: "Some fields need fixing.", fieldErrors };
  }

  const unconfirmed = needsConfirm(review.warnings).filter((w) => !confirmed.includes(w.id));
  if (unconfirmed.length) {
    return { ok: false, status: 409, error: "Some answers look unusual — please confirm.", warnings: unconfirmed };
  }

  const changed = Object.keys(values).filter((c) => values[c] && values[c] !== (previous[c] ?? ""));
  const notCleared = Object.keys(values).filter((c) => !values[c] && previous[c]);
  if (!changed.length) {
    return {
      ok: false,
      status: 400,
      error: notCleared.length
        ? "Clearing a saved value isn't allowed here — nothing else changed."
        : context.kind === "edit" ? "Nothing changed from the alumni record." : "Nothing filled in yet.",
    };
  }

  // DB Service field names are the form's (full) names; college/branch as ids.
  const fields: Record<string, string | number> = {};
  for (const col of changed) {
    const field = FIELD.get(col)!;
    const v = values[col];
    fields[col] =
      col in CODE_COLUMNS ? Number(codes.get(v)!.id)
      : field.type === "year" || field.type === "number" ? Number(v)
      : v;
  }

  const dbService = getDbServiceConfig();
  if (!dbService) return { ok: false, status: 503, error: "DB Service is not configured." };

  // The row may have been created since the form opened — look it up fresh.
  const [existing] = await query<{ id: string }>(
    `SELECT id FROM alumni WHERE student_id = $1 ORDER BY id DESC LIMIT 1`,
    [context.ids.studentId],
  );
  const response = existing
    ? await fetch(`${dbService.baseUrl}/alumni/${existing.id}`, {
        method: "PATCH",
        headers: dbService.headers,
        body: JSON.stringify(fields),
      })
    : await fetch(`${dbService.baseUrl}/alumni`, {
        method: "POST",
        headers: dbService.headers,
        body: JSON.stringify({ student_id: Number(context.ids.studentId), ...fields }),
      });

  if (!response.ok) {
    const text = await response.text();
    console.error("[alumni] DB service error:", response.status, text.slice(0, 500));
    return { ok: false, status: 502, error: `Couldn't save — the DB Service answered ${response.status}.` };
  }
  const saved = (await response.json()) as { id: number | string };
  return {
    ok: true,
    alumniId: String(saved.id),
    action: existing ? "updated" : "inserted",
    changed: changed.map((c) => FIELD.get(c)!.label),
    notCleared: notCleared.map((c) => FIELD.get(c)!.label),
  };
}
