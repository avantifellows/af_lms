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
  /** Distinct students who answered at least one question in this parameter. */
  answeredBy: number;
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
  /**
   * Per-batch response counts (analysis is batch-wise). `batch` is the raw
   * batch_id; `batchName` is the human-readable name, resolved by the API route
   * (this module only talks to BigQuery). Falls back to the id when unknown.
   */
  batches: { batch: string; batchName: string; responseCount: number }[];
}

function isMeaningful(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (["no", "na", "n/a", "none", "nil", "-"].includes(t.toLowerCase())) return false;
  if (!Number.isNaN(Number(t))) return false; // pure numbers aren't comments
  return true;
}

interface Accumulator {
  users: Set<string>;
  batchCounts: Map<string, Set<string>>;
  paramTotals: Map<string, number>;
  /** Distinct users who answered ≥1 question in each parameter — the honest
   *  denominator, so a skipped parameter reads "0 rated" rather than a fake 0.0. */
  paramResponders: Map<string, Set<string>>;
  comments: SubjectiveComment[];
}

function trackBatch(acc: Accumulator, r: RawRow): void {
  if (!r.batch) return;
  if (!acc.batchCounts.has(r.batch)) acc.batchCounts.set(r.batch, new Set());
  acc.batchCounts.get(r.batch)!.add(r.user_id);
}

function foldScored(acc: Accumulator, r: RawRow, qpi: number, parameter: string): void {
  const score = scoreUserResponse(qpi, r.user_response);
  if (score === null) return;
  acc.paramTotals.set(parameter, (acc.paramTotals.get(parameter) ?? 0) + score);
  acc.paramResponders.get(parameter)!.add(r.user_id);
}

function foldComment(acc: Accumulator, r: RawRow, role: "liked" | "improve"): void {
  const text = (r.user_response_labels ?? "").trim();
  if (isMeaningful(text)) acc.comments.push({ role, text });
}

/** Fold one row into the accumulator: track responders/batches, sum scores, collect comments. */
function foldRow(acc: Accumulator, r: RawRow): void {
  acc.users.add(r.user_id);
  trackBatch(acc, r);

  const qpi = typeof r.qpi === "number" ? r.qpi : Number(r.qpi);
  const question = FEEDBACK_QUESTIONS[qpi];
  if (!question) return;

  if (question.kind === "scored") {
    foldScored(acc, r, qpi, question.parameter);
  } else {
    foldComment(acc, r, question.role);
  }
}

/** Reduce all rows into per-student / per-parameter aggregates. */
function accumulate(rows: RawRow[]): Accumulator {
  const acc: Accumulator = {
    users: new Set<string>(),
    batchCounts: new Map<string, Set<string>>(),
    paramTotals: new Map<string, number>(),
    paramResponders: new Map<string, Set<string>>(),
    comments: [],
  };
  for (const p of PARAMETERS) {
    acc.paramTotals.set(p, 0);
    acc.paramResponders.set(p, new Set());
  }
  for (const r of rows) foldRow(acc, r);
  return acc;
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

  const acc = accumulate(rows as RawRow[]);
  const { users, batchCounts, paramTotals, paramResponders, comments } = acc;

  const responseCount = users.size;

  // Average each parameter across the students who actually rated it (not all
  // responders), so a partially-skipped parameter isn't diluted toward 0.
  const parameters: ParameterScore[] = PARAMETERS.map((p) => {
    const answeredBy = paramResponders.get(p)?.size ?? 0;
    return {
      parameter: p,
      score: answeredBy > 0 ? (paramTotals.get(p) ?? 0) / answeredBy : 0,
      maxScore: maxScoreForParameter(p),
      answeredBy,
    };
  });
  const totalScore = parameters.reduce((acc, p) => acc + p.score, 0);

  const batches = Array.from(batchCounts.entries())
    // batchName defaults to the id; the API route fills in the readable name.
    .map(([batch, set]) => ({ batch, batchName: batch, responseCount: set.size }))
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
