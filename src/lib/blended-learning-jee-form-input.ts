// The JEE form's exam, reasons and limits, and the validation the JEE Form
// tab and the route share (client-safe: no server imports).
//
// One exam is hard-coded for now: JEE Main 2027, stored against the existing
// `exam` row named "JEE Mains" with exam_year 2027.
//
// A Filled form also takes the exam-portal password. It is write-only: the
// tab only ever learns whether one is saved (`passwordSaved`), never the
// password, which the server stores as KMS ciphertext and shows only through
// the logged reveal (`/api/blended-learning/students/[id]/jee-form/password`).
//
// A Filled form also says which JEE Main session(s) the Student applied for
// (Session 1, Session 2 or both; at least one). They are stored only on the
// exam record (`student_exam_record.sessions_applied`), as the Exams tab
// stores them, and checked against the same allowed values
// (`canonicalizeSessions`).

import { APPLICATION_PASSWORD_MAX_LENGTH, examSessionsFor } from "./competitive-exams";
import { canonicalizeSessions } from "./exam-records-payload";

export const JEE_FORM_EXAM = { label: "JEE Main 2027", examName: "JEE Mains", examYear: 2027 } as const;

export type JeeFormStatus = "filled" | "not_filled";

// The sittings a Filled form can name: Session 1 and Session 2.
export const JEE_FORM_SESSIONS: readonly number[] = examSessionsFor(JEE_FORM_EXAM.examName);

// Worded exactly as the program team's sheet. The codes are stored
// (blended_learning_jee_form_updates.reasons), and the db-service CHECK lists
// the same codes, so a new reason needs a migration too.
export const JEE_FORM_REASONS = [
  { value: "certificate_not_available", label: "Certificate is not available" },
  { value: "document_issue", label: "Issue In Documents" },
  { value: "form_difficulty", label: "Difficulty in filling the form" },
  { value: "awaiting_parent_salary", label: "Will fill the form after parent's get the salary" },
  { value: "personal_issues", label: "Personal Issues" },
  { value: "not_interested", label: "Not interested for JEE exam" },
  { value: "not_prepared", label: "Not prepared for the exam" },
  { value: "phase_two", label: "Will attempt Phase -2 test" },
  { value: "not_sharing_details", label: "Not sharing registration details" },
  { value: "not_aware", label: "Not aware about the exam" },
  { value: "other", label: "Other" },
] as const;

export type JeeFormReason = (typeof JEE_FORM_REASONS)[number]["value"];

const REASON_LABELS = new Map<string, string>(JEE_FORM_REASONS.map((reason) => [reason.value, reason.label]));

export function jeeFormReasonLabel(reason: JeeFormReason): string {
  return REASON_LABELS.get(reason) ?? reason;
}

// The reminder's usual text. The Common Action Item a filled form ticks is
// found by its key, not this text (blended-learning-jee-reminder); a Common
// Action Item created with this text (case and spacing aside) while no active
// one holds the key gets the key.
export const JEE_FORM_REMINDER_TEXT = "JEE Form Filling (Reminder)";

export const JEE_FORM_STATUS_LABEL: Record<JeeFormStatus, string> = {
  filled: "Filled",
  not_filled: "Not filled",
};

export const JEE_APPLICATION_NUMBER_MAX_LENGTH = 255;
export const JEE_FORM_DETAILS_MAX_LENGTH = 2000;
const JEE_CONFIRMATION_MAX_BYTES = 5 * 1024 * 1024;

export type JeeFormUpdate = {
  id: number;
  status: JeeFormStatus;
  applicationNumber: string | null;
  hasConfirmation: boolean;
  reasons: JeeFormReason[];
  details: string | null;
  // IST calendar date the update was recorded.
  recordedOn: string;
  // A not-filled update raised a flag for the program team.
  flagRaised: boolean;
};

export type JeeReminderItem = { id: number; text: string; status: "open" | "done" };

export type JeeFormView = {
  // Null until anything is recorded ("Not recorded yet").
  current: JeeFormUpdate | null;
  // Earlier updates, newest first.
  earlier: JeeFormUpdate[];
  // The Student's "JEE Form Filling (Reminder)" Action Items.
  reminderItems: JeeReminderItem[];
  // The JEE Main 2027 record holds an exam-portal password (as ciphertext).
  // Only ever this flag: the password itself never reaches page data.
  passwordSaved: boolean;
  // The JEE Main 2027 record's sessions applied, sorted; [] when it has none
  // (or there is no record). Shown for Filled and pre-fills the form.
  sessionsApplied: number[];
};

// The JEE status a view-only viewer (a team lead on a supervised Mentor's
// Mentee) gets: whether the form is filled, the Not filled reasons and when it
// was recorded. Never the application number, the details, the confirmation,
// the history or anything about the exam-portal password: the server builds
// it from a read that selects only these columns.
export type JeeFormStatusSummary = Pick<JeeFormUpdate, "status" | "reasons" | "recordedOn">;

export type JeeStatusOnlyView = {
  statusOnly: true;
  // Null until anything is recorded.
  current: JeeFormStatusSummary | null;
};

// What the Mentee page's JEE line shows: the whole form (full scope) or the
// status only (view only).
export type JeeFormLineView = JeeFormView | JeeStatusOnlyView;

type JeeFormRowBase = {
  studentId: number;
  // `student.student_id` as text (leading zeros kept); may be NULL.
  programStudentId: string | null;
  name: string;
  mentorUserId: number;
  mentorName: string;
};

// One Student's row in the JEE Form tab: the whole form for a Student in full
// scope, the status only for a team lead's supervised Mentor's Mentee
// (`viewOnly`).
export type JeeFormRow = JeeFormRowBase &
  ({ viewOnly: false; form: JeeFormView } | { viewOnly: true; form: JeeStatusOnlyView });

// The tab's status filter: "not_recorded" is a Student with no update yet.
export type JeeFormStatusFilter = "all" | "not_recorded" | JeeFormStatus;

export function jeeRowStatus(form: { current: { status: JeeFormStatus } | null }): Exclude<JeeFormStatusFilter, "all"> {
  return form.current?.status ?? "not_recorded";
}

export type JeeFormInput =
  // `password` null keeps the saved password (allowed only when one is saved).
  // `sessions`: sorted, without repeats, at least one.
  | { status: "filled"; applicationNumber: string; password: string | null; sessions: number[] }
  | { status: "not_filled"; reasons: JeeFormReason[]; details: string | null };

export type JeeFormFieldErrors = Partial<
  Record<"status" | "applicationNumber" | "password" | "sessions" | "reasons" | "details" | "confirmation", string>
>;

export type JeeFormValidation = { ok: true; input: JeeFormInput } | { ok: false; fieldErrors: JeeFormFieldErrors };

export type RawJeeForm = {
  status?: unknown;
  applicationNumber?: unknown;
  password?: unknown;
  // Numbers from the tab; the route passes the multipart values as text.
  sessions?: unknown;
  reasons?: unknown;
  details?: unknown;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export const JEE_PASSWORD_REQUIRED = "Enter the exam portal password.";
const JEE_SESSIONS_REQUIRED = "Choose the session the student applied for: Session 1, Session 2 or both.";

function applicationNumberError(applicationNumber: string): string | null {
  if (!applicationNumber) return "Enter the application number.";
  if (applicationNumber.length > JEE_APPLICATION_NUMBER_MAX_LENGTH) return "This application number is too long.";
  return null;
}

// Trimmed as the Exams tab trims it; blank means "keep the saved one".
function passwordError(raw: unknown, password: string, requirePassword: boolean): string | null {
  if (raw != null && typeof raw !== "string") return "The password must be text.";
  if (!password) return requirePassword ? JEE_PASSWORD_REQUIRED : null;
  if (password.length > APPLICATION_PASSWORD_MAX_LENGTH) return "This password is too long.";
  return null;
}

// Multipart sends each session as text ("1"), the tab as a number; both go
// through the Exams tab's canonicalizeSessions (deduped, sorted, only the
// exam's sessions), and at least one is required.
function parseSessions(raw: unknown): { ok: true; sessions: number[] } | { ok: false; error: string } {
  const values = Array.isArray(raw)
    ? raw.map((value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value))
    : raw;
  const result = canonicalizeSessions(values, JEE_FORM_EXAM.examName);
  if (!result.ok) return { ok: false, error: result.error };
  if (!result.sessions) return { ok: false, error: JEE_SESSIONS_REQUIRED };
  return { ok: true, sessions: result.sessions };
}

function validateFilled(raw: RawJeeForm, requirePassword: boolean): JeeFormValidation {
  const applicationNumber = trimmed(raw.applicationNumber);
  const password = trimmed(raw.password);
  const fieldErrors: JeeFormFieldErrors = {};
  const numberError = applicationNumberError(applicationNumber);
  if (numberError) fieldErrors.applicationNumber = numberError;
  const secretError = passwordError(raw.password, password, requirePassword);
  if (secretError) fieldErrors.password = secretError;
  const sessions = parseSessions(raw.sessions);
  if (!sessions.ok) fieldErrors.sessions = sessions.error;
  if (Object.keys(fieldErrors).length > 0 || !sessions.ok) return { ok: false, fieldErrors };
  return {
    ok: true,
    input: { status: "filled", applicationNumber, password: password || null, sessions: sessions.sessions },
  };
}

function validateNotFilled(raw: RawJeeForm): JeeFormValidation {
  const fieldErrors: JeeFormFieldErrors = {};
  const picked = Array.isArray(raw.reasons) ? raw.reasons : [];
  const reasons = JEE_FORM_REASONS.map((reason) => reason.value).filter((value) => picked.includes(value));
  if (!Array.isArray(raw.reasons) || picked.some((value) => !REASON_LABELS.has(value as string))) {
    fieldErrors.reasons = "Choose reasons from the list.";
  } else if (reasons.length === 0) {
    fieldErrors.reasons = "Choose at least one reason.";
  }

  if (raw.details != null && typeof raw.details !== "string") fieldErrors.details = "Details must be text.";
  const details = trimmed(raw.details) || null;
  if (details && details.length > JEE_FORM_DETAILS_MAX_LENGTH) {
    fieldErrors.details = `Keep the details to ${JEE_FORM_DETAILS_MAX_LENGTH} characters.`;
  } else if (!details && reasons.includes("other")) {
    fieldErrors.details = "Describe the other reason.";
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  return { ok: true, input: { status: "not_filled", reasons, details } };
}

// Reasons come back in the list's order, without repeats. The fields of the
// other status are ignored, so the form can keep them while the Mentor
// switches back and forth. `requirePassword` is set when no password is saved
// yet: a Filled form can't be saved without one (the program team won't take
// the details now and the password later). The server, which knows whether
// one is saved only once the Student is in scope, checks that itself.
export function validateJeeForm(raw: RawJeeForm, { requirePassword = false } = {}): JeeFormValidation {
  if (raw.status === "filled") return validateFilled(raw, requirePassword);
  if (raw.status === "not_filled") return validateNotFilled(raw);
  return { ok: false, fieldErrors: { status: "Choose Filled or Not filled." } };
}

// A confirmation page is one PDF up to 5 MB. Phones sometimes send no type,
// so a `.pdf` name with an empty type passes too.
export function confirmationError(file: { name: string; type: string; size: number }): string | null {
  const isPdf = file.type === "application/pdf" || (file.type === "" && /\.pdf$/i.test(file.name));
  if (!isPdf) return "Choose a PDF file.";
  if (file.size < 1) return "This PDF is empty.";
  if (file.size > JEE_CONFIRMATION_MAX_BYTES) return "The PDF must be 5 MB or smaller.";
  return null;
}

// The flag's comment for the program team: the reasons, then the details.
export function jeeFormFlagComment(input: { reasons: JeeFormReason[]; details: string | null }): string {
  const reasons = input.reasons.map(jeeFormReasonLabel).join("; ");
  const lines = [`${JEE_FORM_EXAM.label} form not filled: ${reasons}`];
  if (input.details) lines.push(`Details: ${input.details}`);
  return lines.join("\n");
}
