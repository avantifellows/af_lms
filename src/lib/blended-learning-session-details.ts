import { isCalendarDate, MODES, oneOf, SPOKE_WITH } from "./blended-learning-format";

// Session details validation (pure): the date, mode, who was spoken with and
// the length, which a logged Conversation requires and a Conversation Draft
// takes as far as the Mentor had entered them. Errors are keyed by field and
// reported in field order.

export type FieldErrors = Record<string, string>;

export type SessionDetails = {
  occurredOn: string | null;
  mode: (typeof MODES)[number] | null;
  spokeWith: (typeof SPOKE_WITH)[number] | null;
  durationMinutes: number | null;
};

export function isDurationMinutes(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 240;
}

function absent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

function never(): boolean {
  return false;
}

// The session fields after the date, each with its rule and error.
const SESSION_FIELDS: { field: keyof SessionDetails; valid: (value: unknown) => boolean; message: string }[] = [
  { field: "mode", valid: (value) => oneOf(MODES, value), message: "Choose call or in person." },
  { field: "spokeWith", valid: (value) => oneOf(SPOKE_WITH, value), message: "Choose who you spoke with." },
  { field: "durationMinutes", valid: isDurationMinutes, message: "Duration must be between 1 and 240 minutes." },
];

// `today` is the IST calendar date; a session can be dated today or earlier.
function dateError(value: unknown, today: string, invalidMessage: string): string | null {
  if (!isCalendarDate(value)) return invalidMessage;
  return value > today ? "The date can't be in the future." : null;
}

// The error for a required date, or null.
export function requiredDateError(value: unknown, today: string): string | null {
  return dateError(value, today, "Enter the date.");
}

// `skip` says which values go unchecked: none when the details are required,
// absent ones when they are optional.
function sessionErrors(
  body: Record<string, unknown>,
  today: string,
  skip: (value: unknown) => boolean,
  invalidDate: string
): FieldErrors {
  const errors: FieldErrors = {};
  const date = skip(body.occurredOn) ? null : dateError(body.occurredOn, today, invalidDate);
  if (date) errors.occurredOn = date;
  for (const { field, valid, message } of SESSION_FIELDS) {
    if (!skip(body[field]) && !valid(body[field])) errors[field] = message;
  }
  return errors;
}

// A logged Conversation's session details: every one is required.
export function requiredSessionErrors(body: Record<string, unknown>, today: string): FieldErrors {
  return sessionErrors(body, today, never, "Enter the date.");
}

function presentOrNull<T>(value: unknown): T | null {
  return absent(value) ? null : (value as T);
}

// A Conversation Draft's session details: each is optional, and an entered
// one must be valid.
export function validateSessionDetails(
  body: Record<string, unknown>,
  today: string
): { ok: true; details: SessionDetails } | { ok: false; fieldErrors: FieldErrors } {
  const errors = sessionErrors(body, today, absent, "Enter a valid date.");
  if (Object.keys(errors).length > 0) return { ok: false, fieldErrors: errors };
  return {
    ok: true,
    details: {
      occurredOn: presentOrNull(body.occurredOn),
      mode: presentOrNull(body.mode),
      spokeWith: presentOrNull(body.spokeWith),
      durationMinutes: presentOrNull(body.durationMinutes),
    },
  };
}
