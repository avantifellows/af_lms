/**
 * Teacher Feedback report — scores student responses from
 * `assessments.all_responses_form_level` (what the quiz ETL writes for forms).
 *
 * Questions are matched by TEXT and options by their LABEL, never by position;
 * see the "identity by text" section of `teacher-feedback-form.ts`. No per-batch
 * breakdown: BigQuery's `batch` is the shared *quiz* batch, not the class batch
 * the PM picked.
 */

import { getBigQueryClient } from "@/lib/bigquery";
import {
  PARAMETERS,
  MAX_TOTAL_SCORE,
  FEEDBACK_FORM_VERSION,
  maxScoreForParameter,
  lookUpQuestionByText,
  scoreByOptionText,
  OPEN_QUESTIONS,
  type FeedbackQuestion,
} from "@/lib/teacher-feedback-form";

// Unset in staging and prod (both read prod BQ, as `bigquery.ts` does); set it
// locally to read `avantifellows-staging`.
const BQ_PROJECT = process.env.BIGQUERY_PROJECT?.trim() || "avantifellows";
const FORM_LEVEL_TABLE = `\`${BQ_PROJECT}.assessments.all_responses_form_level\``;
const BQ_LOCATION = "asia-south1";

interface RawRow {
  user_id: string;
  question_text: string | null;
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
  paramTotals: Map<string, number>;
  /** Distinct users who answered ≥1 question in each parameter — the honest
   *  denominator, so a skipped parameter reads "0 rated" rather than a fake 0.0. */
  paramResponders: Map<string, Set<string>>;
  comments: SubjectiveComment[];
  /** Rows whose question text isn't in this form version (an older generation of
   *  the form under the same cms_test_id). Skipped, and counted so the drift is
   *  visible in the logs instead of silently altering the numbers. */
  unrecognizedQuestions: Map<string, number>;
}

function foldScored(
  acc: Accumulator,
  r: RawRow,
  question: FeedbackQuestion,
  parameter: string
): void {
  const score = scoreByOptionText(question, r.user_response_labels);
  if (score === null) return;
  acc.paramTotals.set(parameter, (acc.paramTotals.get(parameter) ?? 0) + score);
  acc.paramResponders.get(parameter)!.add(r.user_id);
}

function foldComment(acc: Accumulator, r: RawRow, role: "liked" | "improve"): void {
  const text = (r.user_response_labels ?? "").trim();
  if (isMeaningful(text)) acc.comments.push({ role, text });
}

/** Fold one row into the accumulator: track responders, sum scores, collect comments. */
function foldRow(acc: Accumulator, r: RawRow): void {
  acc.users.add(r.user_id);

  // Skip rows from an older form generation rather than scoring them against
  // whatever now sits at their position.
  const question = lookUpQuestionByText(r.question_text);
  if (!question) {
    const key = (r.question_text ?? "(empty)").slice(0, 120);
    acc.unrecognizedQuestions.set(key, (acc.unrecognizedQuestions.get(key) ?? 0) + 1);
    return;
  }

  if (question.kind === "scored") {
    foldScored(acc, r, question, question.parameter);
  } else {
    foldComment(acc, r, question.role);
  }
}

/** Reduce all rows into per-student / per-parameter aggregates. */
function accumulate(rows: RawRow[]): Accumulator {
  const acc: Accumulator = {
    users: new Set<string>(),
    paramTotals: new Map<string, number>(),
    paramResponders: new Map<string, Set<string>>(),
    comments: [],
    unrecognizedQuestions: new Map<string, number>(),
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
  // Per quiz id, so an older form generation under the same cms_test_id can't
  // bleed in.
  const sql = `
    SELECT
      user_id,
      question_text,
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

  if (acc.unrecognizedQuestions.size > 0) {
    const skipped = Array.from(acc.unrecognizedQuestions.entries())
      .map(([text, n]) => `${n}× ${JSON.stringify(text)}`)
      .join("; ");
    console.warn(
      `[teacher-feedback] quiz ${quizId}: skipped responses for ` +
        `${acc.unrecognizedQuestions.size} question(s) absent from form ` +
        `${FEEDBACK_FORM_VERSION} — ${skipped}`
    );
  }
  const { users, paramTotals, paramResponders, comments } = acc;

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
  };
}
