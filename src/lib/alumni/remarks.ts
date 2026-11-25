// The call remark: what happened on this call, picked from the Alumni team's
// list (Nov 2026). Shared by the form (browser) and the save (server); no
// server-only imports here.
//
// A remark belongs to one call, not to the alumnus, so it is not an alumni
// column: it is saved as the `notes` of that call's alumni_journey row, as
// "<option>" or "<option>: <details>".

export interface RemarkOption {
  label: string;
  /** Shows a text box for details. */
  details?: { placeholder: string; required?: boolean };
  hint?: string;
}

export const OTHER_REMARK = "Other";

export const REMARK_OPTIONS: readonly RemarkOption[] = [
  { label: "Updated by Parents/Siblings" },
  { label: "Updated by student" },
  { label: "Updated by Friends" },
  { label: "College ID not found", details: { placeholder: "College name, city and state" }, hint: "To collect college details" },
  { label: "Wrong UUID/AFID" },
  { label: "Name change - Mismatch UUID", hint: "Wrong student is tagged to the UUID" },
  { label: "Under Counseling Process", hint: "Counseling for college admission is going on" },
  { label: "Awaiting college admission/Counseling results" },
  { label: "Wrong Phone number" },
  { label: "Willing for Mentorship" },
  { label: "Preparing for other exams", details: { placeholder: "Which exam?" } },
  { label: "Not Interested/Disconnecting calls" },
  { label: OTHER_REMARK, details: { placeholder: "Write the remark", required: true } },
];

export const MAX_REMARK_DETAILS = 500;

const BY_LABEL = new Map(REMARK_OPTIONS.map((o) => [o.label, o]));

export interface Remark {
  option: string;
  details: string;
}

/**
 * The remark as the journey row's `notes`, or an error to show. An empty
 * option means no remark (null); details count only for options with a box.
 */
export function remarkNote(remark: Remark): { note: string | null } | { error: string } {
  if (!remark.option) return { note: null };
  const option = BY_LABEL.get(remark.option);
  if (!option) return { error: "Pick a remark from the list." };
  const details = option.details ? remark.details.trim().replace(/\s+/g, " ") : "";
  if (option.details?.required && !details) return { error: "Write the remark." };
  if (details.length > MAX_REMARK_DETAILS) return { error: `Keep it under ${MAX_REMARK_DETAILS} characters.` };
  return { note: details ? `${option.label}: ${details}` : option.label };
}
