// Field-level validation for the Blended Learning Manage page (pure and
// client-safe): Resources and Common Action Items. The limits match the
// db-service CHECKs on blended_learning_resources and
// blended_learning_common_action_items; errors are keyed by field.

export const RESOURCE_TITLE_MAX = 200;
export const COMMON_ITEM_TEXT_MAX = 500;
export const COMMON_ITEM_OWNERS = ["student", "mentor", "parent"] as const;
const COMMON_TARGET_GRADES = [12, 13] as const;
// The most Student IDs one paste may list, and the longest ID.
const MAX_TARGET_STUDENT_IDS = 1000;
const MAX_STUDENT_ID_LENGTH = 64;

export type CommonItemOwner = (typeof COMMON_ITEM_OWNERS)[number];
export type CommonTarget =
  | { kind: "all" }
  | { kind: "grade"; grade: (typeof COMMON_TARGET_GRADES)[number] }
  | { kind: "mentor"; mentorUserId: number }
  // Specific Students by `student.student_id` (sheet/program IDs, leading
  // zeros kept), as pasted.
  | { kind: "students"; studentIds: string[] };
export type ResourceInput = { title: string; url: string };
export type CommonItemEdit = { text: string; owner: CommonItemOwner };
export type CommonItemInput = CommonItemEdit & { target: CommonTarget };

export type FieldErrors = Record<string, string>;
export type Validated<T> = { ok: true; input: T } | { ok: false; fieldErrors: FieldErrors };

function asRecord(value: unknown): Record<string, unknown> {
  return (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function outcome<T>(errors: FieldErrors, input: T): Validated<T> {
  return Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true, input };
}

// An `https://` link with a host and no whitespace (the DB CHECK is
// `^https://[^[:space:]]+$`).
export function isHttpsUrl(value: string): boolean {
  if (!/^https:\/\/\S+$/.test(value)) return false;
  try {
    return new URL(value).hostname.length > 0;
  } catch {
    return false;
  }
}

export function validateResource(raw: unknown): Validated<ResourceInput> {
  const body = asRecord(raw);
  const title = trimmed(body.title);
  const url = trimmed(body.url);
  const errors: FieldErrors = {};
  if (!title) errors.title = "Enter a title.";
  else if (title.length > RESOURCE_TITLE_MAX) errors.title = `Keep the title to ${RESOURCE_TITLE_MAX} characters.`;
  if (!url) errors.url = "Enter a link.";
  else if (!isHttpsUrl(url)) errors.url = "Enter a full link starting with https://";
  return outcome(errors, { title, url });
}

export function validateCommonItemEdit(raw: unknown): Validated<CommonItemEdit> {
  const body = asRecord(raw);
  const text = trimmed(body.text);
  const owner = COMMON_ITEM_OWNERS.find((value) => value === body.owner);
  const errors: FieldErrors = {};
  if (!text) errors.text = "Enter the action item.";
  else if (text.length > COMMON_ITEM_TEXT_MAX) errors.text = `Keep it to ${COMMON_ITEM_TEXT_MAX} characters.`;
  if (!owner) errors.owner = "Choose who does it.";
  return outcome(errors, { text, owner: owner ?? "student" });
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
}

// Student IDs as pasted: separated by whitespace, commas or new lines, each
// kept as written (leading zeros too), repeats dropped, in first-seen order.
// A list is split the same way, item by item.
export function parseStudentIds(raw: unknown): string[] {
  return [...new Set(textParts(raw).flatMap((part) => part.split(/[\s,]+/)).filter(Boolean))];
}

function textParts(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((part): part is string => typeof part === "string");
  return typeof raw === "string" ? [raw] : [];
}

function validateStudentIds(raw: unknown): Validated<CommonTarget> {
  const studentIds = parseStudentIds(raw);
  let error: string | null = null;
  if (studentIds.length === 0) error = "Paste at least one Student ID.";
  else if (studentIds.length > MAX_TARGET_STUDENT_IDS) error = `Paste at most ${MAX_TARGET_STUDENT_IDS} Student IDs.`;
  else if (studentIds.some((id) => id.length > MAX_STUDENT_ID_LENGTH)) error = "One of these isn't a Student ID.";
  return error ? { ok: false, fieldErrors: { studentIds: error } } : { ok: true, input: { kind: "students", studentIds } };
}

// A target from a request body: `kind` plus `grade` (12 or 13),
// `mentorUserId` or `studentIds` (pasted text or a list).
export function validateTarget(raw: unknown): Validated<CommonTarget> {
  const body = asRecord(raw);
  if (body.kind === "all") return { ok: true, input: { kind: "all" } };
  if (body.kind === "grade") {
    const grade = COMMON_TARGET_GRADES.find((value) => value === positiveInteger(body.grade));
    return grade ? { ok: true, input: { kind: "grade", grade } } : { ok: false, fieldErrors: { grade: "Choose grade 12 or 13." } };
  }
  if (body.kind === "mentor") {
    const mentorUserId = positiveInteger(body.mentorUserId);
    return mentorUserId
      ? { ok: true, input: { kind: "mentor", mentorUserId } }
      : { ok: false, fieldErrors: { mentorUserId: "Choose a mentor." } };
  }
  if (body.kind === "students") return validateStudentIds(body.studentIds);
  return { ok: false, fieldErrors: { target: "Choose who gets it." } };
}

export function validateCommonItem(raw: unknown): Validated<CommonItemInput> {
  const edit = validateCommonItemEdit(raw);
  const target = validateTarget(asRecord(raw).target);
  const errors = { ...(edit.ok ? {} : edit.fieldErrors), ...(target.ok ? {} : target.fieldErrors) };
  if (!edit.ok || !target.ok) return { ok: false, fieldErrors: errors };
  return { ok: true, input: { ...edit.input, target: target.input } };
}
