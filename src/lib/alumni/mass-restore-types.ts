// Mass restore's request and results (no server imports: the browser panel
// uses these too). See mass-restore.ts.

/** All alumni the person reaches, or one school's (by code). */
export type RestoreScope = { kind: "all" } | { kind: "school"; code: string };

export interface RestoreChange {
  label: string;
  /** Now. */
  before: string;
  /** After the restore. */
  after: string;
}

export interface RestorePlanItem {
  alumniId: string;
  name: string;
  school: string;
  /** The version restored to: the date it was reported, or "" for the record before any answer. */
  versionOn: string;
  /** The record's version now (sent back with the restore, to skip anyone changed since). */
  version: string;
  changes: RestoreChange[];
}

export interface RestorePlan {
  /** Alumni the change touched who would go back to how they were before it. */
  items: RestorePlanItem[];
  /** Alumni the change touched who were changed again after it: left as they are. */
  changedLater: { alumniId: string; name: string; school: string }[];
}

export interface RestoreResult {
  alumniId: string;
  name: string;
  /** skipped: changed again after the change, or since the preview — not undone unseen. */
  result: "restored" | "unchanged" | "skipped" | "error";
  message?: string;
  changed: string[];
}

/** Alumni restored per request; the browser sends a big plan in chunks. */
export const RESTORE_CHUNK = 25;

/**
 * One step in a scope's history, like a sheet's version: the saves one person
 * (or import) made, of one kind, close together — a bulk edit is one step.
 */
export interface HistoryGroup {
  /** The first save's row id (a stable key). */
  id: string;
  /** The last save's row id. */
  lastId: string;
  /** When the step started and ended (ISO, UTC). */
  start: string;
  end: string;
  source: "call" | "form" | "bulk_upload" | "correction" | "initial";
  /** Their email, or what made it ("CSV import", "DB Service"). */
  by: string;
  /** Alumni it touched. */
  alumni: number;
  /** The remark or note, when the step has one alumnus or one shared note. */
  note: string;
}
