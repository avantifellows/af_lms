import { canAccessAlumni, type UserPermission } from "@/lib/permissions";
import { getAlumnusContext, loadAlumniRecords, type EntryContext } from "./entry";
import { ALUMNI_FIELDS, type Values } from "./fields";
import { loadPassOut } from "./pass-out";
import { fieldLabels, prepareSave, saveAlumni, type PreparedSave, type SaveResult } from "./save";
import { GATE_COLUMNS, commonAnswers, type BulkCommon, type BulkOutcome, type BulkRequest, type BulkResult, type BulkTarget } from "./bulk-types";
import { loadAlumniTable } from "./table";

// Bulk edit: one set of answers, given once, saved for many students — a
// pass-out not added yet gets a new alumni record (a bulk upload), an alumnus
// gets theirs updated. Each student goes through exactly what the single form
// does (access, the same checks, the DB Service), one at a time.
//
// Only the answers filled in are applied. Unless `overwrite` is set, a value
// already on record that differs is kept (the bulk answer fills blanks only).

/** Students per request; the browser sends a big selection in chunks. */
export const BULK_MAX = 25;

const COLUMNS = new Set(ALUMNI_FIELDS.map((f) => f.column));

type Loaded = { ok: true; context: EntryContext } | { ok: false; result: BulkOutcome; message: string };

/** The student's form data, if the person may edit them. */
async function loadTarget(target: BulkTarget, email: string, permission: UserPermission): Promise<Loaded> {
  if (!/^\d+$/.test(target.id)) return { ok: false, result: "error", message: "Invalid student." };
  if (target.kind === "alumnus") {
    if (!(await canAccessAlumni({ user: { email } }, target.id, { requireEdit: true }))) {
      return { ok: false, result: "denied", message: "Access denied" };
    }
    const context = await getAlumnusContext(target.id);
    return context ? { ok: true, context } : { ok: false, result: "error", message: "No such alumnus." };
  }
  const loaded = await loadPassOut(target.id, permission);
  if (loaded.ok) return loaded;
  // Added by someone since the table loaded: carry on as an update of that record.
  if (loaded.status === 409) return loadTarget({ kind: "alumnus", id: loaded.alumniId }, email, permission);
  return { ok: false, result: loaded.status === 403 ? "denied" : "error", message: loaded.error };
}

/**
 * The bulk answers as this student's submission. Without `overwrite`, an
 * answer that would replace a different value on record is left out (kept),
 * except `replace` columns, which the person deliberately changed.
 */
export function studentValues(
  answers: Values,
  previous: Values,
  overwrite: boolean,
  replace: string[] = [],
): { values: Values; kept: string[] } {
  const values: Values = {};
  const kept: string[] = [];
  for (const [column, raw] of Object.entries(answers)) {
    const v = (raw ?? "").trim();
    if (!v || !COLUMNS.has(column)) continue;
    const saved = (previous[column] ?? "").trim();
    if (saved && saved !== v && !overwrite && !replace.includes(column)) kept.push(column);
    else values[column] = v;
  }
  return { values, kept };
}

/** A failed check or save, as a row of the result. */
function failure(failed: Extract<PreparedSave | SaveResult, { ok: false }>): Pick<BulkResult, "result" | "message" | "warnings"> {
  if (failed.nothing) return { result: "unchanged", message: failed.error };
  if (failed.warnings?.length) return { result: "confirm", message: failed.error, warnings: failed.warnings };
  const fields = Object.entries(failed.fieldErrors ?? {}).map(([c, m]) => `${fieldLabels([c])[0]}: ${m}`);
  return { result: "error", message: fields.length ? fields.join(" · ") : failed.error };
}

/** One student: check (preview) or save. */
async function runOne(target: BulkTarget, request: BulkRequest, email: string, permission: UserPermission): Promise<BulkResult> {
  const loaded = await loadTarget(target, email, permission);
  if (!loaded.ok) return { target, name: "", result: loaded.result, message: loaded.message, changed: [], kept: [] };
  const { context } = loaded;
  const { values, kept } = studentValues(request.values, context.alumni, request.overwrite, request.replace);
  const base = { target, name: context.name, changed: [] as string[], kept: fieldLabels(kept) };
  const willCreate = context.kind === "new";

  if (request.dryRun) {
    const prepared = await prepareSave(context, values, request.confirmed, context.version);
    if (!prepared.ok) return { ...base, ...failure(prepared) };
    return { ...base, result: willCreate ? "create" : "update", changed: fieldLabels(prepared.changed) };
  }
  const saved = await saveAlumni(context, values, request.confirmed, context.version, {
    source: "bulk_upload",
    actorEmail: email,
    actorRole: permission.role,
  });
  if (!saved.ok) return { ...base, ...failure(saved) };
  return { ...base, result: saved.action === "inserted" ? "create" : "update", changed: saved.changed, alumniId: saved.alumniId };
}

/** Runs the request student by student; one student's problem never stops the rest. */
export async function runBulk(request: BulkRequest, email: string, permission: UserPermission): Promise<BulkResult[]> {
  const results: BulkResult[] = [];
  for (const target of request.targets) {
    try {
      results.push(await runOne(target, request, email, permission));
    } catch (error) {
      console.error("[alumni/bulk]", target, error);
      results.push({ target, name: "", result: "error", message: "Couldn't save this one. Try again.", changed: [], kept: [] });
    }
  }
  return results;
}

/** Most students looked at for shared answers at once. */
export const COMMON_MAX = 5000;

/**
 * What the students (those in the person's scope) already have on record:
 * answers they all share, and answers that differ.
 */
export async function loadCommonAnswers(targets: BulkTarget[], permission: UserPermission): Promise<BulkCommon> {
  const key = (t: BulkTarget) => `${t.kind}-${t.id}`;
  const inScope = new Set((await loadAlumniTable(permission)).map(key));
  const allowed = targets.filter((t) => inScope.has(key(t)));
  const records = await loadAlumniRecords(allowed.filter((t) => t.kind === "alumnus").map((t) => t.id));
  const answers = allowed.map((t) => (t.kind === "alumnus" ? records.get(t.id)?.alumni : undefined) ?? {});
  const shared = commonAnswers(answers, [...COLUMNS]);
  const names: Record<string, string> = {};
  const first = records.get(allowed.find((t) => t.kind === "alumnus")?.id ?? "");
  for (const column of Object.keys(shared.common)) if (first?.codeNames[column]) names[column] = first.codeNames[column];
  const gates = answers.map((a) => Object.fromEntries(GATE_COLUMNS.filter((c) => a[c]).map((c) => [c, a[c]])));
  return { ...shared, names, gates };
}
