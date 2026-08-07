import { query } from "@/lib/db";
import { dbIstTimestampToUtcIso } from "@/lib/quiz-session-time";

/**
 * When a combined student report may be generated.
 *
 * Two rules, both enforced server-side (the UI mirrors them, but the route is
 * the authority):
 *  1. Not until the test's session window has closed — a report built mid-test
 *     silently omits students who haven't submitted yet, and looks complete.
 *  2. Once per test — a successful or in-flight job blocks another. Ops print
 *     these, so two near-identical PDFs for one test is worse than none.
 */

export type GenerationBlockedReason =
  | "session_not_ended"
  | "job_in_progress"
  | "already_generated";

export interface SessionWindow {
  /** Session end as a true instant, or null when we can't determine one. */
  endTimeUtcIso: string | null;
  /**
   * False only when we positively know the window is still open. Unknown
   * timing counts as ended — see getSessionWindow for why.
   */
  hasEnded: boolean;
}

interface SessionEndRow {
  end_time: string | null;
}

/**
 * Look up when a quiz session's window closes.
 *
 * `session.end_time` is `timestamp without time zone` holding **IST wall-clock**,
 * so it must go through `dbIstTimestampToUtcIso`. Passing it to `new Date(...)`
 * would read it as UTC and land 5h30m early — which would unblock generation
 * while a test was still running, i.e. exactly the bug this gate exists to stop.
 *
 * Fails **open** (hasEnded: true) when there is no row or no end_time. The
 * Performance tab lists tests from BigQuery, not Postgres, so a visible test is
 * not guaranteed a `session` row — an absent one means a legacy session that
 * ended long ago, and blocking those would break generation that works today.
 * Recent sessions (the only ones that can still be open, and so the only ones
 * this gate needs to catch) are always written to Postgres at creation.
 */
export async function getSessionWindow(
  sessionId: string,
  now: Date = new Date(),
): Promise<SessionWindow> {
  const rows = await query<SessionEndRow>(
    `SELECT end_time::text AS end_time FROM session WHERE session_id = $1 LIMIT 1`,
    [sessionId],
  );

  const raw = rows[0]?.end_time ?? null;
  if (!raw) return { endTimeUtcIso: null, hasEnded: true };

  // Convert unconditionally — never branch on a trailing `Z`. Session timestamps
  // are IST wall-clock even when something upstream has stamped a `Z` on them
  // (the API layer does), so that `Z` does not mean UTC: session 18259's window
  // end reads "2026-08-12T23:45:00Z" through the API but means 23:45 IST.
  // Trusting it would put the gate 5h30m early. dbIstTimestampToUtcIso handles
  // both the bare `YYYY-MM-DD HH:mm:ss` this query returns and the Z-suffixed
  // form, so one unconditional call is correct for every shape — matching what
  // the quiz-sessions routes do.
  //
  // It THROWS on a value it can't parse (falling through to
  // `new Date(x).toISOString()`), so a malformed timestamp must not be allowed
  // to turn a report listing into a 502.
  let endMs = NaN;
  try {
    endMs = Date.parse(dbIstTimestampToUtcIso(raw));
  } catch {
    endMs = NaN;
  }
  if (Number.isNaN(endMs)) return { endTimeUtcIso: null, hasEnded: true };

  return {
    endTimeUtcIso: new Date(endMs).toISOString(),
    hasEnded: now.getTime() >= endMs,
  };
}

/** Minimal shape of a reporting job needed to judge eligibility. */
export interface JobLike {
  status: string;
}

const ACTIVE_STATUSES = new Set(["queued", "started", "processing"]);

/**
 * Decide whether a new job may be submitted, given the session window and the
 * jobs that already exist for this school + test.
 *
 * Errored-only history stays generatable: retry handles the usual recovery, but
 * if a job failed for a reason retry can't fix (wrong roster at submit time),
 * refusing outright would leave ops with no route to a report at all.
 */
export function evaluateGenerationEligibility(
  window: SessionWindow,
  jobs: JobLike[],
): { allowed: boolean; reason?: GenerationBlockedReason } {
  if (!window.hasEnded) return { allowed: false, reason: "session_not_ended" };
  if (jobs.some((j) => ACTIVE_STATUSES.has(j.status))) {
    return { allowed: false, reason: "job_in_progress" };
  }
  if (jobs.some((j) => j.status === "done")) {
    return { allowed: false, reason: "already_generated" };
  }
  return { allowed: true };
}

export const BLOCKED_MESSAGE: Record<GenerationBlockedReason, string> = {
  session_not_ended:
    "This test is still open. The combined report can be generated once the session end time has passed.",
  job_in_progress: "A combined report for this test is already being generated.",
  already_generated:
    "A combined report has already been generated for this test.",
};
