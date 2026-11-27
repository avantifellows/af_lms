// AI Test Insights Session Notes (#551): the rules the form and the server
// share, so they never disagree. Client-safe: keep server-only imports
// (`@/lib/db`, `@/lib/permissions`) out of this module.
//
// Slice #574 has the draft rule only. Submit (#575) adds the final rule to
// `validateSessionNotes` as a second `SessionNotesRule`.
import { aiTestInsightsStudentApiUrl } from "@/lib/ai-test-insights-shared";
import { isDateString } from "@/lib/curriculum-date-helpers";

/** The most characters any one text field of Session Notes may hold. */
export const SESSION_NOTES_MAX_LENGTH = 2000;

/** What the form calls each field; the validation messages use the same words. */
export const SESSION_NOTES_LABELS = {
  sessionDate: "Date of conversation",
  areasOfConcern: "Areas of concern",
  immediateActions: "Immediate actions",
  otherNotes: "Other notes (optional)",
} as const;

/** The three text fields, in the form's order. */
export const SESSION_NOTES_TEXT_FIELDS = ["areasOfConcern", "immediateActions", "otherNotes"] as const;

export type SessionNotesField = keyof typeof SESSION_NOTES_LABELS;
export type SessionNotesTextField = (typeof SESSION_NOTES_TEXT_FIELDS)[number];

/** The four fields of Session Notes. A blank text field or no date may be null. */
export interface SessionNotesFields {
  /** The day the conversation happened, `YYYY-MM-DD`. */
  sessionDate: string | null;
  areasOfConcern: string | null;
  immediateActions: string | null;
  otherNotes: string | null;
}

/** `draft`: what any save of a draft must meet. */
export type SessionNotesRule = "draft";

export type SessionNotesValidation =
  | { ok: true; notes: SessionNotesFields }
  | { ok: false; field: SessionNotesField; error: string };

const LIMIT_TEXT = SESSION_NOTES_MAX_LENGTH.toLocaleString("en-IN");

/** A label without "(optional)", for messages. */
const fieldName = (field: SessionNotesField) => SESSION_NOTES_LABELS[field].replace(/ \(optional\)$/, "");

const refuse = (field: SessionNotesField, error: string): SessionNotesValidation => ({ ok: false, field, error });

/** A text field's length as the limit counts it (the form's counter shows the same number). */
export function sessionNotesLength(text: string | null): number {
  return text?.length ?? 0;
}

/** Null, empty or only whitespace. */
export function isBlankNote(text: string | null): boolean {
  return text === null || text.trim() === "";
}

/**
 * Checks Session Notes against a rule; the form and the routes both call it.
 *
 * Draft rule: each text field is a string or null of at most 2,000
 * characters; the date is null or a real `YYYY-MM-DD` date (`2026-02-30` is
 * refused). Text is returned exactly as typed. Only the four fields come back;
 * anything else in `input` is left out. The first failing field is named.
 */
export function validateSessionNotes(input: unknown, rule: SessionNotesRule): SessionNotesValidation {
  void rule;
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return refuse("sessionDate", "Session Notes are missing.");
  }
  const raw = input as Record<string, unknown>;

  const sessionDate = raw.sessionDate;
  if (sessionDate !== null && (typeof sessionDate !== "string" || !isDateString(sessionDate))) {
    return refuse("sessionDate", `${fieldName("sessionDate")} is not a real date.`);
  }

  const notes: SessionNotesFields = { sessionDate, areasOfConcern: null, immediateActions: null, otherNotes: null };
  for (const field of SESSION_NOTES_TEXT_FIELDS) {
    const value = raw[field];
    if (value !== null && typeof value !== "string") return refuse(field, `${fieldName(field)} must be text.`);
    if (sessionNotesLength(value) > SESSION_NOTES_MAX_LENGTH) {
      return refuse(field, `${fieldName(field)} is over the ${LIMIT_TEXT}-character limit.`);
    }
    notes[field] = value;
  }
  return { ok: true, notes };
}

/** The 409 code of a save made from an older copy of the notes. */
export const SESSION_NOTES_STALE_CODE = "stale";

/** The caller's own draft for a Student, as the history route returns it. */
export interface SessionNotesDraft extends SessionNotesFields {
  /** The draft's revision; the next save sends it as `expectedRevision`. */
  revision: number;
}

/**
 * Whether the caller may write Session Notes: `write` (feature access `edit`
 * and a User), `no_linked_user` (access `edit`, no User) or `read`.
 */
export type SessionNotesAccess = "write" | "no_linked_user" | "read";

/** `GET /api/ai-test-insights/students/[studentId]/sessions`. */
export interface AiTestInsightsSessionsResponse {
  /** The Student's history; always empty until the timeline (#576). */
  timeline: never[];
  /** The caller's own draft, or null. */
  draft: SessionNotesDraft | null;
  notesAccess: SessionNotesAccess;
}

/** `PUT …/sessions/draft`: the four fields and the revision the form last saw (0 for none). */
export interface SessionNotesDraftRequest extends SessionNotesFields {
  expectedRevision: number;
}

/**
 * A write body: the four fields under `rule`, and `expectedRevision`, a whole
 * number 0 or more. Returns the first failing field; never echoes a value.
 */
export function parseSessionNotesRequest(
  raw: unknown,
  rule: SessionNotesRule,
): { ok: true; value: SessionNotesDraftRequest } | { ok: false; field: string; error: string } {
  const checked = validateSessionNotes(raw, rule);
  if (!checked.ok) return checked;
  const { expectedRevision } = raw as Record<string, unknown>;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    return { ok: false, field: "expectedRevision", error: "expectedRevision must be a whole number, 0 or more." };
  }
  return { ok: true, value: { ...checked.notes, expectedRevision } };
}

/** `PUT …/sessions/draft` 200: the draft's revision now (0 while nothing is stored). */
export interface SessionNotesDraftResponse {
  revision: number;
}

/** `PUT …/sessions/draft` 409 `stale`: the notes changed in another tab. */
export interface SessionNotesStaleResponse {
  error: string;
  code: typeof SESSION_NOTES_STALE_CODE;
  currentRevision: number;
}

/** The history route of a Student (`student.id`); a centre the page named carries over. */
export function aiTestInsightsSessionsUrl(studentId: number, centreId: number | null): string {
  return aiTestInsightsStudentApiUrl(studentId, "sessions", centreId);
}

/** The draft save route of a Student (`student.id`); a centre the page named carries over. */
export function aiTestInsightsSessionDraftUrl(studentId: number, centreId: number | null): string {
  return aiTestInsightsStudentApiUrl(studentId, "sessions/draft", centreId);
}
