// Client-safe actions and limits for Visit Concern history writes. The write module
// (`visit-concern-events.ts`) imports the database, so client components import from here instead.

export const VISIT_CONCERN_EVENT_BODY_MAX_LENGTH = 2000;

const VISIT_CONCERN_ACTIONS = ["resolve", "comment", "reopen"] as const;
export type VisitConcernAction = (typeof VISIT_CONCERN_ACTIONS)[number];

export function isVisitConcernAction(value: unknown): value is VisitConcernAction {
  return typeof value === "string" && (VISIT_CONCERN_ACTIONS as readonly string[]).includes(value);
}

// The body is trimmed and must be 1–2000 characters, with no NUL character (Postgres text rejects
// it, so it would fail the write).
export function validateConcernEventBody(
  raw: unknown
): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "body must be a string" };
  const body = raw.trim();
  if (body.length === 0) return { ok: false, error: "Please write a note" };
  if (body.includes("\u0000")) return { ok: false, error: "Note can't contain a NUL character" };
  if (body.length > VISIT_CONCERN_EVENT_BODY_MAX_LENGTH) {
    return { ok: false, error: `Note must be at most ${VISIT_CONCERN_EVENT_BODY_MAX_LENGTH} characters` };
  }
  return { ok: true, body };
}
