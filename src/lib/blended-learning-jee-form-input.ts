// The JEE form card's exam, reasons and limits, and the validation the card
// and the route share (client-safe: no server imports).
//
// One exam is hard-coded for now: JEE Main 2027, stored against the existing
// `exam` row named "JEE Mains" with exam_year 2027. There is deliberately no
// application password anywhere in this module, the card or its route: a
// secure (encrypted, write-only for Mentors) password field comes later.

export const JEE_FORM_EXAM = { label: "JEE Main 2027", examName: "JEE Mains", examYear: 2027 } as const;

export type JeeFormStatus = "filled" | "not_filled";

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

// The Common Action Item a filled form ticks, matched on its text (case and
// spacing aside) so no id is hard-coded.
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
};

export type JeeFormInput =
  | { status: "filled"; applicationNumber: string }
  | { status: "not_filled"; reasons: JeeFormReason[]; details: string | null };

export type JeeFormFieldErrors = Partial<Record<"status" | "applicationNumber" | "reasons" | "details" | "confirmation", string>>;

export type JeeFormValidation = { ok: true; input: JeeFormInput } | { ok: false; fieldErrors: JeeFormFieldErrors };

export type RawJeeForm = {
  status?: unknown;
  applicationNumber?: unknown;
  reasons?: unknown;
  details?: unknown;
};

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateFilled(raw: RawJeeForm): JeeFormValidation {
  const applicationNumber = trimmed(raw.applicationNumber);
  if (!applicationNumber) return { ok: false, fieldErrors: { applicationNumber: "Enter the application number." } };
  if (applicationNumber.length > JEE_APPLICATION_NUMBER_MAX_LENGTH) {
    return { ok: false, fieldErrors: { applicationNumber: "This application number is too long." } };
  }
  return { ok: true, input: { status: "filled", applicationNumber } };
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
// other status are ignored, so the card can keep them while the Mentor
// switches back and forth.
export function validateJeeForm(raw: RawJeeForm): JeeFormValidation {
  if (raw.status === "filled") return validateFilled(raw);
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
