// AI Test Insights Session Notes (#551): the rules the form and the server
// share, so they never disagree. Client-safe: keep server-only imports
// (`@/lib/db`, `@/lib/permissions`) out of this module.
//
// Two rules: `draft` (#574) for any draft save, and `final` (#575) for a
// submit, which also needs the two required fields and a date not after today.
import { aiSummaryTitle, aiTestInsightsStudentApiUrl, type InsightRequestView } from "@/lib/ai-test-insights-shared";
import type { TimelineEntry } from "@/lib/ai-test-insights-timeline";
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

/**
 * `draft`: what any save of a draft must meet. `final`: what a submit must
 * meet (the draft rule, the two required fields, a date not after today).
 */
export type SessionNotesRule = "draft" | "final";

export type SessionNotesValidation =
  | { ok: true; notes: SessionNotesFields }
  | { ok: false; field: SessionNotesField; error: string };

const LIMIT_TEXT = SESSION_NOTES_MAX_LENGTH.toLocaleString("en-IN");

/** A field's label without "(optional)", for messages and the History timeline. */
export const sessionNotesFieldName = (field: SessionNotesField) => SESSION_NOTES_LABELS[field].replace(/ \(optional\)$/, "");

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
 * refused). Final rule: the draft rule, plus Areas of concern and Immediate
 * actions non-blank after trim, plus a date that is present and not after
 * `today` (`YYYY-MM-DD`, today in India: the server reads it from its own
 * clock, never from the browser). Text is returned exactly as typed; trimming
 * is the save's job. Only the four fields come back; anything else in `input`
 * is left out. The first failing field is named.
 */
export function validateSessionNotes(input: unknown, rule: "draft"): SessionNotesValidation;
export function validateSessionNotes(input: unknown, rule: SessionNotesRule, today: string): SessionNotesValidation;
export function validateSessionNotes(input: unknown, rule: SessionNotesRule, today?: string): SessionNotesValidation {
  const checked = validateDraftRule(input);
  if (!checked.ok || rule === "draft") return checked;

  const { sessionDate } = checked.notes;
  if (sessionDate === null) return refuse("sessionDate", `${sessionNotesFieldName("sessionDate")} is required.`);
  if (today === undefined || sessionDate > today) {
    return refuse("sessionDate", `${sessionNotesFieldName("sessionDate")} can't be after today.`);
  }
  for (const field of SESSION_NOTES_REQUIRED_FIELDS) {
    if (isBlankNote(checked.notes[field])) return refuse(field, `${sessionNotesFieldName(field)} is required.`);
  }
  return checked;
}

/** The text fields the final rule needs non-blank. */
const SESSION_NOTES_REQUIRED_FIELDS = ["areasOfConcern", "immediateActions"] as const;

function validateDraftRule(input: unknown): SessionNotesValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return refuse("sessionDate", "Session Notes are missing.");
  }
  const raw = input as Record<string, unknown>;

  const sessionDate = raw.sessionDate;
  if (sessionDate !== null && (typeof sessionDate !== "string" || !isDateString(sessionDate))) {
    return refuse("sessionDate", `${sessionNotesFieldName("sessionDate")} is not a real date.`);
  }

  const notes: SessionNotesFields = { sessionDate, areasOfConcern: null, immediateActions: null, otherNotes: null };
  for (const field of SESSION_NOTES_TEXT_FIELDS) {
    const value = raw[field];
    if (value !== null && typeof value !== "string") return refuse(field, `${sessionNotesFieldName(field)} must be text.`);
    if (sessionNotesLength(value) > SESSION_NOTES_MAX_LENGTH) {
      return refuse(field, `${sessionNotesFieldName(field)} is over the ${LIMIT_TEXT}-character limit.`);
    }
    notes[field] = value;
  }
  return { ok: true, notes };
}

/**
 * The Insight Request a submit links: the key of the request the AI Summary
 * card shows when it is `completed`; null for none or any other state.
 */
export function openInsightRequestKey(request: InsightRequestView | null): string | null {
  return request?.state === "completed" ? request.requestKey : null;
}

/** The line under the form saying which AI Summary a submit links, dated by its request day in India. */
export function sessionNotesLinkText(request: InsightRequestView | null): string {
  if (openInsightRequestKey(request) === null || !request) {
    return "No AI Summary is open, so these notes won't be linked to one.";
  }
  return `Linked to the ${aiSummaryTitle(request)}`;
}

/** The line under the form saying who reads submitted notes. */
export const SESSION_NOTES_VISIBILITY_TEXT =
  "Submitted notes are visible to staff with access to this School and are used for the next AI Summary.";

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
  /** The Student's History timeline, newest first (#576). */
  timeline: TimelineEntry[];
  /** The caller's own draft, or null. */
  draft: SessionNotesDraft | null;
  notesAccess: SessionNotesAccess;
}

/** `PUT …/sessions/draft`: the four fields and the revision the form last saw (0 for none). */
export interface SessionNotesDraftRequest extends SessionNotesFields {
  expectedRevision: number;
}

/** `POST …/sessions`: a submit of the draft at `expectedRevision`, linked to the open AI Summary. */
export interface SessionNotesSubmitRequest extends SessionNotesDraftRequest {
  /** The key of the `completed` Insight Request the AI Summary card shows, or null when none is open. */
  openRequestKey: string | null;
}

/** The longest open request key a submit body may carry. */
const MAX_REQUEST_KEY_LENGTH = 200;

type ParsedRequest<B> = { ok: true; value: B } | { ok: false; field: string; error: string };

/** `expectedRevision`: a whole number, `min` or more. */
function parseExpectedRevision(raw: Record<string, unknown>, min: number): ParsedRequest<number> {
  const { expectedRevision } = raw;
  if (typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) || expectedRevision < min) {
    return { ok: false, field: "expectedRevision", error: `expectedRevision must be a whole number, ${min} or more.` };
  }
  return { ok: true, value: expectedRevision };
}

/**
 * A draft save body: the four fields under the draft rule, and
 * `expectedRevision`, a whole number 0 or more. Returns the first failing
 * field; never echoes a value.
 */
export function parseSessionNotesRequest(raw: unknown, rule: "draft"): ParsedRequest<SessionNotesDraftRequest> {
  const checked = validateSessionNotes(raw, rule);
  if (!checked.ok) return checked;
  const revision = parseExpectedRevision(raw as Record<string, unknown>, 0);
  if (!revision.ok) return revision;
  return { ok: true, value: { ...checked.notes, expectedRevision: revision.value } };
}

/**
 * A submit body: the four fields under the final rule with `today` (today in
 * India, from the server's clock), `expectedRevision` 1 or more (a submit
 * needs a saved draft), and `openRequestKey`, null or a key of 1 to 200
 * characters. Returns the first failing field; never echoes a value.
 */
export function parseSessionNotesSubmitRequest(raw: unknown, today: string): ParsedRequest<SessionNotesSubmitRequest> {
  const checked = validateSessionNotes(raw, "final", today);
  if (!checked.ok) return checked;
  const fields = raw as Record<string, unknown>;
  const revision = parseExpectedRevision(fields, 1);
  if (!revision.ok) return revision;
  const { openRequestKey } = fields;
  if (
    openRequestKey !== null &&
    (typeof openRequestKey !== "string" || openRequestKey.length < 1 || openRequestKey.length > MAX_REQUEST_KEY_LENGTH)
  ) {
    return { ok: false, field: "openRequestKey", error: "openRequestKey must be a request key or null." };
  }
  return { ok: true, value: { ...checked.notes, expectedRevision: revision.value, openRequestKey } };
}

/** `PUT …/sessions/draft` 200: the draft's revision now (0 while nothing is stored). */
export interface SessionNotesDraftResponse {
  revision: number;
}

/** `POST …/sessions` 201: the submitted Insight Session and its revision. */
export interface SessionNotesSubmitResponse {
  sessionId: number;
  revision: number;
}

/** `PUT …/sessions/draft` or `POST …/sessions` 409 `stale`: the notes changed in another tab. */
export interface SessionNotesStaleResponse {
  error: string;
  code: typeof SESSION_NOTES_STALE_CODE;
  currentRevision: number;
}

/**
 * The history route of a Student (`student.id`), which a submit also posts
 * to; a centre the page named carries over.
 */
export function aiTestInsightsSessionsUrl(studentId: number, centreId: number | null): string {
  return aiTestInsightsStudentApiUrl(studentId, "sessions", centreId);
}

/** The draft save route of a Student (`student.id`); a centre the page named carries over. */
export function aiTestInsightsSessionDraftUrl(studentId: number, centreId: number | null): string {
  return aiTestInsightsStudentApiUrl(studentId, "sessions/draft", centreId);
}
