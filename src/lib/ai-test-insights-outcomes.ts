// AI Test Insights (#550): the plain words the AI Summary card shows for an
// Insight Request that ended `no_data` or `failed`. AI Mentorship Guide (or
// the LMS, for `timed_out`) records an outcome code on the request; known
// codes get their own sentence, every other code one general message.
// Client-safe: keep server-only imports (`@/lib/db`, `@/lib/permissions`) out.

const SAME_PROGRAM = "This student's program does not match their test records.";
const NO_USABLE_SCORES = "The newest ticked test has no usable scores for this student. Choose other tests.";

const OUTCOME_MESSAGES: ReadonlyMap<string, string> = new Map([
  ["missing_category_for_cutoff", "This student has no category on record. Add it in Edit Student, then try again."],
  ["unsupported_stream", "AI Summaries are available for JEE students only."],
  ["no_usable_overall_stats", NO_USABLE_SCORES],
  ["no_candidate_tests", NO_USABLE_SCORES],
  ["outside_current_active_scope", "This student is not in a current batch of this program."],
  ["program_unavailable", SAME_PROGRAM],
  ["program_mismatch", SAME_PROGRAM],
  ["missing_external_student_id", "This student has no Student ID on record."],
  ["timed_out", "The AI Summary took too long and was stopped."],
  ["interrupted", "The run was interrupted."],
]);

const GENERAL_MESSAGE = "Something went wrong while writing the AI Summary.";

/** Why a request ended without an AI Summary, in plain words. */
export function outcomeMessage(code: string | null): string {
  return (code !== null && OUTCOME_MESSAGES.get(code)) || GENERAL_MESSAGE;
}
