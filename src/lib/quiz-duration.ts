/**
 * Session meta_data.quiz_duration_seconds, from the quiz's time_limit as quiz-backend
 * returns it ({min, max} in seconds, or null for an untimed test; 0 = untimed, as
 * sessionCreator writes it). Returns undefined when the response carries no time_limit
 * (quiz-backend before it returned one), so the caller leaves the key alone rather than
 * recording a wrong 0.
 */
export function quizDurationSeconds(response: { time_limit?: unknown }): number | undefined {
  if (!("time_limit" in response)) return undefined;
  const max = Number((response.time_limit as { max?: unknown } | null)?.max);
  return Number.isFinite(max) && max > 0 ? Math.round(max) : 0;
}
