// Field checks shared by the form (browser) and the save route (server).
import { findIssues, type CheckContext, type Issue } from "./checks";
import { allowedDegrees, isDegreeCompatible, type Level } from "./compat";
import { ALUMNI_SECTIONS, ENUMS, isFieldShown, type Values } from "./fields";

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2035;
/** Text columns in the alumni table are varchar(255). */
export const MAX_TEXT = 255;
/** Number fields stored as integers in the alumni table. */
const WHOLE_NUMBERS = new Set(["years_of_experience"]);

/**
 * The values that will be saved: only fields that are shown. Fields hidden by
 * the answers above (e.g. PG fields when UG isn't Graduated) are left out, so
 * stale values never get saved.
 */
export function visibleValues(values: Values): Values {
  const out: Values = {};
  for (const section of ALUMNI_SECTIONS) {
    for (const field of section.fields) {
      if (isFieldShown(section, field, values)) out[field.column] = (values[field.column] ?? "").trim();
    }
  }
  return out;
}

/**
 * Returns { column: message } for invalid values. `previous` holds the values
 * already on record: an existing value that isn't in today's dropdown list is
 * allowed to stay (kept as-is, never silently changed).
 */
export function validateValues(values: Values, previous: Values = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of ALUMNI_SECTIONS.flatMap((s) => s.fields)) {
    const v = (values[field.column] ?? "").trim();
    if (!v) continue;
    if (field.type === "year") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < MIN_YEAR || n > MAX_YEAR) errors[field.column] = `Enter a year between ${MIN_YEAR} and ${MAX_YEAR}.`;
    } else if (field.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) errors[field.column] = "Enter a number (0 or more).";
      else if (WHOLE_NUMBERS.has(field.column) && !Number.isInteger(n)) errors[field.column] = "Enter a whole number.";
    } else if (field.type === "text" && v.length > MAX_TEXT) {
      errors[field.column] = `Keep it under ${MAX_TEXT} characters.`;
    } else if (field.type === "enum") {
      const allowed = ENUMS[field.column] ?? [];
      if (!allowed.includes(v) && v !== (previous[field.column] ?? "").trim()) errors[field.column] = "Pick one of the listed options.";
    }
  }
  // Graduation can't come before starting.
  for (const [start, end] of [["start_year_ug", "year_of_graduation_ug"], ["start_year_pg", "year_of_graduation_pg"]]) {
    const s = Number(values[start]);
    const e = Number(values[end]);
    const unchanged = values[start] === previous[start] && values[end] === previous[end];
    if (values[start] && values[end] && !errors[end] && !unchanged && e < s) {
      errors[end] = `Graduation year (${e}) is before the start year (${s}).`;
    }
  }
  // Degree must fit the branch (no MBBS in CS/IT). A pair already on record is
  // left alone so old records can still be saved; changing either re-checks it.
  for (const level of ["ug", "pg"] as const) {
    const branch = (values[`branch_id_${level}`] ?? "").trim();
    const degree = (values[`degree_${level}`] ?? "").trim();
    const col = `degree_${level}`;
    const unchanged = branch === (previous[`branch_id_${level}`] ?? "").trim() && degree === (previous[col] ?? "").trim();
    if (!errors[col] && !unchanged && !isDegreeCompatible(level, branch, degree)) errors[col] = degreeMismatchMessage(level, branch);
  }
  return errors;
}

export function degreeMismatchMessage(level: Level, branch: string): string {
  const allowed = allowedDegrees(level, branch) ?? [];
  return `Doesn't match the branch. Pick one of: ${allowed.filter((d) => d !== "Other").join(", ")} (or Other).`;
}

export interface Review {
  /** Blocking problems, one per field. */
  errors: Record<string, string>;
  /** Unusual answers: ask to confirm (unless only noted on an old record). */
  warnings: Issue[];
}

/** Everything checked before a save — the form and the server run the same review. */
export function reviewValues(values: Values, previous: Values, ctx: CheckContext): Review {
  const errors = validateValues(values, previous);
  const warnings: Issue[] = [];
  for (const issue of findIssues(values, previous, ctx)) {
    if (issue.level === "error") {
      if (!errors[issue.field]) errors[issue.field] = issue.message;
    } else {
      warnings.push(issue);
    }
  }
  return { errors, warnings };
}

/** Check context from the student's profile and today's date. */
export function checkContext(profile: Values, now = new Date()): CheckContext {
  const g12 = Number(profile.student_g12_graduating_year);
  return { currentYear: now.getFullYear(), g12Year: Number.isInteger(g12) && g12 > 1990 ? g12 : undefined };
}
