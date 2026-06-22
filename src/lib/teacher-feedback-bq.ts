/**
 * Teacher Feedback report — reads student responses from BigQuery and scores
 * them against the V2 form config.
 *
 * Source: avantifellows.assessments.all_responses_form_level (the form-specific
 * table the quiz ETL writes; NOT the graded production_dbt_final tables). Each
 * row is one (test_id, user_id, question_position_index) with `user_response`
 * (the selected option index as a string) and `user_response_labels` (option
 * text, or raw subjective text). We join to the form by question_position_index.
 *
 * A feedback session can span grades, so analysis is BATCH-WISE: rows carry the
 * student's `batch`, and we report per-batch breakdowns alongside the overall.
 */

import { getBigQueryClient } from "@/lib/bigquery";
import {
  FEEDBACK_QUESTIONS,
  PARAMETERS,
  MAX_TOTAL_SCORE,
  maxScoreForParameter,
  scoreUserResponse,
  OPEN_QUESTIONS,
} from "@/lib/teacher-feedback-form";

const FORM_LEVEL_TABLE = "`avantifellows.assessments.all_responses_form_level`";
const BQ_LOCATION = "asia-south1";

interface RawRow {
  user_id: string;
  batch: string | null;
  qpi: number | string;
  user_response: string | null;
  user_response_labels: string | null;
}

export interface ParameterScore {
  parameter: string;
  score: number;
  maxScore: number;
}

export interface SubjectiveComment {
  role: "liked" | "improve";
  text: string;
}

export interface TeacherFeedbackReport {
  quizId: string;
  responseCount: number;
  totalScore: number;
  maxTotalScore: number;
  percentage: number;
  parameters: ParameterScore[];
  comments: SubjectiveComment[];
  /** Per-batch response counts (analysis is batch-wise). */
  batches: { batch: string; responseCount: number }[];
}

function isMeaningful(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (["no", "na", "n/a", "none", "nil", "-"].includes(t.toLowerCase())) return false;
  if (!Number.isNaN(Number(t))) return false; // pure numbers aren't comments
  return true;
}

/**
 * Build the per-teacher report for one feedback quiz. Averages each scored
 * parameter across all responding students (so the % is comparable regardless
 * of how many students answered).
 */
export async function getTeacherFeedbackReport(
  quizId: string
): Promise<TeacherFeedbackReport> {
  const client = getBigQueryClient();
  const sql = `
    SELECT
      user_id,
      batch,
      question_position_index AS qpi,
      user_response,
      user_response_labels
    FROM ${FORM_LEVEL_TABLE}
    WHERE test_id = @quizId
      AND is_answered = TRUE
  `;
  const [rows] = await client.query({
    query: sql,
    params: { quizId },
    location: BQ_LOCATION,
  });

  const raw = rows as RawRow[];

  // Per-student, per-parameter score totals.
  const users = new Set<string>();
  const batchCounts = new Map<string, Set<string>>();
  const paramTotals = new Map<string, number>(); // summed across students
  for (const p of PARAMETERS) paramTotals.set(p, 0);
  const comments: SubjectiveComment[] = [];

  for (const r of raw) {
    users.add(r.user_id);
    if (r.batch) {
      if (!batchCounts.has(r.batch)) batchCounts.set(r.batch, new Set());
      batchCounts.get(r.batch)!.add(r.user_id);
    }

    const qpi = typeof r.qpi === "number" ? r.qpi : Number(r.qpi);
    const question = FEEDBACK_QUESTIONS[qpi];
    if (!question) continue;

    if (question.kind === "scored") {
      const score = scoreUserResponse(qpi, r.user_response);
      if (score !== null) {
        paramTotals.set(question.parameter, (paramTotals.get(question.parameter) ?? 0) + score);
      }
    } else {
      const text = (r.user_response_labels ?? "").trim();
      if (isMeaningful(text)) {
        comments.push({ role: question.role, text });
      }
    }
  }

  const responseCount = users.size;

  // Average each parameter across responding students.
  const parameters: ParameterScore[] = PARAMETERS.map((p) => ({
    parameter: p,
    score: responseCount > 0 ? (paramTotals.get(p) ?? 0) / responseCount : 0,
    maxScore: maxScoreForParameter(p),
  }));
  const totalScore = parameters.reduce((acc, p) => acc + p.score, 0);

  const batches = Array.from(batchCounts.entries())
    .map(([batch, set]) => ({ batch, responseCount: set.size }))
    .sort((a, b) => b.responseCount - a.responseCount);

  // Order comments liked-first then improve, for stable rendering.
  const order = OPEN_QUESTIONS.map((q) => q.role);
  comments.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

  return {
    quizId,
    responseCount,
    totalScore,
    maxTotalScore: MAX_TOTAL_SCORE,
    percentage: MAX_TOTAL_SCORE > 0 ? (totalScore / MAX_TOTAL_SCORE) * 100 : 0,
    parameters,
    comments,
    batches,
  };
}
