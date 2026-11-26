import type { Issue } from "./checks";

// Bulk edit's request and results. No server imports: the browser panel
// (BulkEditPanel) uses these too.

export interface BulkTarget {
  kind: "alumnus" | "pass-out";
  /** alumni.id for an alumnus, user.id for a pass-out (as in the table). */
  id: string;
}

export interface BulkRequest {
  targets: BulkTarget[];
  /** The answers, filled in once for everyone (blank = leave as is). */
  values: Record<string, string>;
  /** Unusual-answer warning ids the person accepted. */
  confirmed: string[];
  /** Replace a different value already on record (else only blanks are filled). */
  overwrite: boolean;
  /** Columns to replace even without `overwrite`: answers the person changed from one all the students shared. */
  replace: string[];
  /** Check only: nothing is written. */
  dryRun: boolean;
}

/** create: new alumni record · update: record changed · unchanged: nothing to write · confirm: unusual answers to accept. */
export type BulkOutcome = "create" | "update" | "unchanged" | "confirm" | "error" | "denied";

export interface BulkResult {
  target: BulkTarget;
  name: string;
  result: BulkOutcome;
  message?: string;
  /** Fields written (or, in a preview, that would be). */
  changed: string[];
  /** Fields left as they are on record (already a different value). */
  kept: string[];
  warnings?: Issue[];
  /** The alumni record, once saved. */
  alumniId?: string;
}

/** What the selected students already have on record, so bulk edit starts where they differ. */
export interface BulkCommon {
  /** Students looked at (those in the person's scope). */
  total: number;
  /** Answers every one of them has, the same. */
  common: Record<string, string>;
  /** Display names for common college/branch codes. */
  names: Record<string, string>;
  /** Answers that differ: how many students have one filled in. */
  mixed: Record<string, number>;
  /** Each student's answers that open sections of the form (GATE_COLUMNS). */
  gates: Record<string, string>[];
}

/** The answers the form's show-rules read (fields.ts). */
export const GATE_COLUMNS = ["ug_status", "pg_status", "employment_status", "did_you_take_a_gap_year"];

/** Shared and differing answers across students' records (a pass-out not added has none). */
export function commonAnswers(records: Record<string, string>[], columns: string[]): Omit<BulkCommon, "names" | "gates"> {
  const common: Record<string, string> = {};
  const mixed: Record<string, number> = {};
  for (const column of columns) {
    const values = records.map((r) => (r[column] ?? "").trim());
    const filled = values.filter(Boolean).length;
    if (!filled) continue;
    if (filled === values.length && values.every((v) => v === values[0])) common[column] = values[0];
    else mixed[column] = filled;
  }
  return { total: records.length, common, mixed };
}

/** Warnings across results, one per kind (the confirm step lists these). */
export function distinctWarnings(results: BulkResult[]): Issue[] {
  const byId = new Map<string, Issue>();
  for (const r of results) for (const w of r.warnings ?? []) if (!byId.has(w.id)) byId.set(w.id, w);
  return [...byId.values()];
}

const isTarget = (t: unknown): t is BulkTarget => {
  const x = t as BulkTarget;
  return !!x && (x.kind === "alumnus" || x.kind === "pass-out") && typeof x.id === "string" && /^\d+$/.test(x.id);
};

/** The body's students, or an error message. `max`: students allowed in one request. */
export function readBulkTargets(body: unknown, max: number): BulkTarget[] | string {
  const targets = ((body ?? {}) as Record<string, unknown>).targets;
  if (!Array.isArray(targets) || !targets.length || !targets.every(isTarget)) return "Pick at least one student.";
  if (targets.length > max) return `At most ${max} students at a time.`;
  return targets;
}

/** The request body, or an error message. `max`: students allowed in one request. */
export function readBulkRequest(body: unknown, max: number): BulkRequest | string {
  const targets = readBulkTargets(body, max);
  if (typeof targets === "string") return targets;
  const b = body as Record<string, unknown>;
  if (!b.values || typeof b.values !== "object" || Array.isArray(b.values)) return "Invalid values.";
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(b.values as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) values[k] = v.slice(0, 1000);
  }
  return {
    targets,
    values,
    confirmed: Array.isArray(b.confirmed) ? b.confirmed.filter((c): c is string => typeof c === "string") : [],
    overwrite: b.overwrite === true,
    replace: Array.isArray(b.replace) ? b.replace.filter((c): c is string => typeof c === "string") : [],
    dryRun: b.dryRun !== false,
  };
}
