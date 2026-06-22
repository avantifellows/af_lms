/**
 * Thin client for the quiz-backend (quiz-engine) service.
 *
 * Teacher Feedback creates one form-quiz per teacher directly here (no CMS
 * template, no sessionCreator Lambda). This is WRITE-ONLY for now — the report
 * reads responses from BigQuery, not from here.
 *
 * Endpoint contract (from scripts/create_teacher_feedback_pilot.py post_quiz):
 *   POST {QUIZ_BACKEND_URL}/quiz   body = the quiz JSON   -> { id: "<quiz_id>" }
 */

const QUIZ_BACKEND_URL = process.env.QUIZ_BACKEND_URL;
const QUIZ_AF_API_KEY = process.env.QUIZ_AF_API_KEY;

export interface CreateFormQuizResult {
  id: string;
}

/**
 * Create a quiz in the quiz-backend and return its id.
 * `quizBody` is the full quiz document (see buildFeedbackQuizBody()).
 * Throws on a missing config or a non-OK response.
 */
export async function createFormQuiz(
  quizBody: Record<string, unknown>
): Promise<CreateFormQuizResult> {
  if (!QUIZ_BACKEND_URL) {
    throw new Error("QUIZ_BACKEND_URL is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    accept: "application/json",
  };
  // The create call historically did not require the API key, but include it
  // when present so the request is accepted under either configuration.
  if (QUIZ_AF_API_KEY) {
    headers.apiKey = QUIZ_AF_API_KEY;
  }

  const response = await fetch(`${QUIZ_BACKEND_URL.replace(/\/$/, "")}/quiz`, {
    method: "POST",
    headers,
    body: JSON.stringify(quizBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("quiz-backend create error:", response.status, errorText);
    throw new Error(`Failed to create quiz (status ${response.status})`);
  }

  const data = (await response.json()) as { id?: unknown };
  if (typeof data?.id !== "string" || data.id.length === 0) {
    console.error("quiz-backend create returned no id:", data);
    throw new Error("quiz-backend did not return a quiz id");
  }

  return { id: data.id };
}
