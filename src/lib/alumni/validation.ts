// Field checks shared by the form (browser) and the save route (server).
import { findIssues, type CheckContext, type Issue } from "./checks";
import { allowedDegrees, isDegreeCompatible, type Level } from "./compat";
import { ALUMNI_SECTIONS, ENUMS, isFieldShown, isFieldStale, type FieldDef, type Values } from "./fields";

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2035;
/** Text columns in the alumni table are varchar(255). */
const MAX_TEXT = 255;
/** Number fields stored as integers in the alumni table. */
const WHOLE_NUMBERS = new Set(["years_of_experience"]);

/**
 * The values that will be saved: only fields that apply. Fields hidden by the
 * answers above (e.g. PG fields when UG isn't Graduated), and stale values
 * that no longer apply (e.g. an organisation after switching to Not
 * Employed), are left out, so they never get saved.
 */
export function visibleValues(values: Values): Values {
  const out: Values = {};
  for (const section of ALUMNI_SECTIONS) {
    for (const field of section.fields) {
      if (isFieldShown(section, field, values) && !isFieldStale(section, field, values)) {
        out[field.column] = (values[field.column] ?? "").trim();
      }
    }
  }
  return out;
}

/**
 * The record as it will be after the save. A blank is never sent, so the
 * saved value stays: checks must see it, or clearing one field of a blocked
 * pair (e.g. the branch, before picking MBBS) would get past them.
 */
export function afterSave(values: Values, previous: Values): Values {
  const after: Values = { ...previous };
  for (const [column, v] of Object.entries(values)) if (v) after[column] = v;
  return after;
}

type FieldRule = (field: FieldDef, v: string, previous: Values) => string | undefined;

const yearRule: FieldRule = (_field, v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? undefined : `Enter a year between ${MIN_YEAR} and ${MAX_YEAR}.`;
};

const numberRule: FieldRule = (field, v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return "Enter a number (0 or more).";
  return WHOLE_NUMBERS.has(field.column) && !Number.isInteger(n) ? "Enter a whole number." : undefined;
};

const textRule: FieldRule = (_field, v) => (v.length > MAX_TEXT ? `Keep it under ${MAX_TEXT} characters.` : undefined);

/** A dropdown value must be in the list, unless it is the value already on record. */
const enumRule: FieldRule = (field, v, previous) => {
  const listed = (ENUMS[field.column] ?? []).includes(v);
  const onRecord = v === (previous[field.column] ?? "").trim();
  return listed || onRecord ? undefined : "Pick one of the listed options.";
};

/** Format checks by field type (college/branch codes are checked against the database on save). */
const FIELD_RULES: Partial<Record<FieldDef["type"], FieldRule>> = {
  year: yearRule,
  number: numberRule,
  text: textRule,
  enum: enumRule,
};

/** Graduation can't come before starting (a pair already on record is left alone). */
function checkGraduationOrder(values: Values, previous: Values, errors: Record<string, string>) {
  for (const [start, end] of [["start_year_ug", "year_of_graduation_ug"], ["start_year_pg", "year_of_graduation_pg"]]) {
    if (!values[start] || !values[end] || errors[end]) continue;
    const unchanged = values[start] === previous[start] && values[end] === previous[end];
    const s = Number(values[start]);
    const e = Number(values[end]);
    if (!unchanged && e < s) errors[end] = `Graduation year (${e}) is before the start year (${s}).`;
  }
}

/**
 * Degree must fit the branch (no MBBS in CS/IT). A pair already on record is
 * left alone so old records can still be saved; changing either re-checks it.
 */
function checkDegreeFitsBranch(values: Values, previous: Values, errors: Record<string, string>) {
  for (const level of ["ug", "pg"] as const) {
    const col = `degree_${level}`;
    const branch = (values[`branch_id_${level}`] ?? "").trim();
    const degree = (values[col] ?? "").trim();
    const unchanged = branch === (previous[`branch_id_${level}`] ?? "").trim() && degree === (previous[col] ?? "").trim();
    if (!errors[col] && !unchanged && !isDegreeCompatible(level, branch, degree)) errors[col] = degreeMismatchMessage(level, branch);
  }
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
    const error = v ? FIELD_RULES[field.type]?.(field, v, previous) : undefined;
    if (error) errors[field.column] = error;
  }
  checkGraduationOrder(values, previous, errors);
  checkDegreeFitsBranch(values, previous, errors);
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

/**
 * Everything checked before a save — the form and the server run the same
 * review. What applies is worked out on the record as it will be after the
 * save (saved values + the new non-blank ones), and only that is checked:
 * - a saved value that no longer applies (a graduation year once the status
 *   is Studying) isn't checked, since the person can't change it here;
 * - a typed value that doesn't apply to the merged record (an organisation
 *   while the saved Employment is Not Employed) isn't sent.
 * `values` is what will be sent: the submitted fields that still apply.
 */
export function reviewSave(submitted: Values, previous: Values, ctx: CheckContext): Review & { values: Values } {
  const typed: Values = {};
  for (const [column, v] of Object.entries(submitted)) typed[column] = (v ?? "").trim();
  const after = visibleValues(afterSave(typed, previous));
  const values: Values = {};
  for (const column of Object.keys(after)) if (column in typed) values[column] = typed[column];
  return { values, ...reviewValues(after, previous, ctx) };
}

/** The checks on one set of values (normally the record after the save, see `reviewSave`). */
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
