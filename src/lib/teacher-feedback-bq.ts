/**
 * Teacher Feedback report — scores student responses from
 * `assessments.all_responses_form_level` (what the quiz ETL writes for forms).
 *
 * Questions are matched by TEXT and options by their LABEL, never by position;
 * see the "identity by text" section of `teacher-feedback-form.ts`. No per-batch
 * breakdown within a round: BigQuery's `batch` is the shared *quiz* batch, not the
 * class batch the PM picked. (Across rounds, each round's batches are known.)
 */

import { getBigQueryClient } from "@/lib/bigquery";
import {
  PARAMETERS,
  MAX_TOTAL_SCORE,
  FEEDBACK_FORM_VERSION,
  MAX_QUESTION_SCORE,
  maxScoreForParameter,
  lookUpQuestionByText,
  scoreByOptionText,
  OPEN_QUESTIONS,
  SCORED_QUESTIONS,
  type FeedbackScoredQuestion,
} from "@/lib/teacher-feedback-form";

// Unset in staging and prod (both read prod BQ, as `bigquery.ts` does); set it
// locally to read `avantifellows-staging`.
const BQ_PROJECT = process.env.BIGQUERY_PROJECT?.trim() || "avantifellows";
const FORM_LEVEL_TABLE = `\`${BQ_PROJECT}.assessments.all_responses_form_level\``;
const BQ_LOCATION = "asia-south1";
// The "Admin test" link submits as this user; a PM trying the form isn't a student.
const ADMIN_TEST_USER = "test_admin";

interface RawRow {
  user_id: string;
  question_text: string | null;
  user_response: string | null;
  user_response_labels: string | null;
}

export interface QuestionScore {
  questionTag: string;
  text: string;
  /** Average score as a % of the question's max. */
  percentage: number;
  answeredBy: number;
  /** Option texts and students per option, in form order (best option first). */
  options: string[];
  optionCounts: number[];
}

export interface ParameterScore {
  parameter: string;
  score: number;
  maxScore: number;
  percentage: number;
  /** Distinct students who answered at least one question in this parameter. */
  answeredBy: number;
  questions: QuestionScore[];
}

export interface SubjectiveComment {
  role: "liked" | "improve";
  text: string;
}

/** Headline numbers only: what a trend or a teacher card needs. */
export interface ScoreSummary {
  responseCount: number;
  percentage: number;
  parameters: { parameter: string; percentage: number; answeredBy: number }[];
}

export type Gender = "female" | "male";

export interface TeacherFeedbackReport {
  quizId: string;
  responseCount: number;
  totalScore: number;
  maxTotalScore: number;
  percentage: number;
  parameters: ParameterScore[];
  comments: SubjectiveComment[];
  /** Students whose answer amounted to "nothing", per open question. */
  nothingCounts: Record<SubjectiveComment["role"], number>;
  /** Only groups with at least MIN_GROUP_SIZE responses, so a split can't single anyone out. */
  byGender: Partial<Record<Gender, ScoreSummary>>;
}

/** Smallest group shown on its own in a split. */
const MIN_GROUP_SIZE = 5;

// "Nothing", "nothing sir", "No comments." — a real answer (no complaints), but
// listing each one buries the comments that say something. Counted instead.
const NOTHING_WORDS = new Set(["no", "na", "n/a", "none", "nil", "nothing", "nope", "nothing much"]);
const NOTHING_FILLER = /\b(sir|mam|madam|maam|ma'am|as such|to improve|to say|comments?|everything is (fine|good|perfect)|all good|all is good|as per me|so far)\b/g;

function isNothing(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z/' ]/g, " ").replace(NOTHING_FILLER, " ").replace(/\s+/g, " ").trim();
  return t === "" || NOTHING_WORDS.has(t);
}

function isMeaningful(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return false;
  if (!Number.isNaN(Number(t))) return false; // pure numbers aren't comments
  return true;
}

interface QuestionTally {
  total: number;
  responders: Set<string>;
  optionCounts: number[];
}

interface Accumulator {
  users: Set<string>;
  /** Keyed by question text, in form order. */
  questions: Map<string, QuestionTally>;
  /** Distinct users who answered ≥1 question in each parameter — the honest
   *  denominator, so a skipped parameter reads "0 rated" rather than a fake 0.0. */
  paramResponders: Map<string, Set<string>>;
  comments: SubjectiveComment[];
  nothingCounts: Record<SubjectiveComment["role"], number>;
  /** Rows whose question text isn't in this form version (an older generation of
   *  the form under the same cms_test_id). Skipped, and counted so the drift is
   *  visible in the logs instead of silently altering the numbers. */
  unrecognizedQuestions: Map<string, number>;
}

function foldScored(acc: Accumulator, r: RawRow, question: FeedbackScoredQuestion): void {
  const score = scoreByOptionText(question, r.user_response_labels);
  if (score === null) return;
  const tally = acc.questions.get(question.text)!;
  tally.total += score;
  tally.responders.add(r.user_id);
  tally.optionCounts[question.options.findIndex((o) => o.score === score)] += 1;
  acc.paramResponders.get(question.parameter)!.add(r.user_id);
}

function foldComment(acc: Accumulator, r: RawRow, role: "liked" | "improve"): void {
  const text = (r.user_response_labels ?? "").trim();
  if (text && isNothing(text)) acc.nothingCounts[role] += 1;
  else if (isMeaningful(text)) acc.comments.push({ role, text });
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
    foldScored(acc, r, question);
  } else {
    foldComment(acc, r, question.role);
  }
}

/** Reduce all rows into per-question / per-parameter aggregates. */
function accumulate(rows: RawRow[]): Accumulator {
  const acc: Accumulator = {
    users: new Set<string>(),
    questions: new Map(),
    paramResponders: new Map<string, Set<string>>(),
    comments: [],
    nothingCounts: { liked: 0, improve: 0 },
    unrecognizedQuestions: new Map<string, number>(),
  };
  for (const q of SCORED_QUESTIONS) {
    acc.questions.set(q.text, { total: 0, responders: new Set(), optionCounts: q.options.map(() => 0) });
  }
  for (const p of PARAMETERS) acc.paramResponders.set(p, new Set());
  for (const r of rows) foldRow(acc, r);
  return acc;
}

const pct = (score: number, max: number) => (max > 0 ? (score / max) * 100 : 0);

/**
 * Average each parameter across the students who actually rated it (not all
 * responders), so a partially-skipped parameter isn't diluted toward 0.
 */
function scoreParameters(acc: Accumulator): ParameterScore[] {
  return PARAMETERS.map((parameter) => {
    const answeredBy = acc.paramResponders.get(parameter)?.size ?? 0;
    const questions = SCORED_QUESTIONS.filter((q) => q.parameter === parameter).map((q) => {
      const tally = acc.questions.get(q.text)!;
      const n = tally.responders.size;
      return {
        questionTag: q.questionTag,
        text: q.text,
        percentage: n > 0 ? pct(tally.total / n, MAX_QUESTION_SCORE) : 0,
        answeredBy: n,
        options: q.options.map((o) => o.text),
        optionCounts: tally.optionCounts,
      };
    });
    const total = SCORED_QUESTIONS.filter((q) => q.parameter === parameter).reduce(
      (sum, q) => sum + acc.questions.get(q.text)!.total,
      0
    );
    const score = answeredBy > 0 ? total / answeredBy : 0;
    const maxScore = maxScoreForParameter(parameter);
    return { parameter, score, maxScore, percentage: pct(score, maxScore), answeredBy, questions };
  });
}

function summarize(acc: Accumulator): ScoreSummary {
  const parameters = scoreParameters(acc);
  const totalScore = parameters.reduce((sum, p) => sum + p.score, 0);
  return {
    responseCount: acc.users.size,
    percentage: pct(totalScore, MAX_TOTAL_SCORE),
    parameters: parameters.map(({ parameter, percentage, answeredBy }) => ({ parameter, percentage, answeredBy })),
  };
}

function warnUnrecognized(quizId: string, acc: Accumulator): void {
  if (acc.unrecognizedQuestions.size === 0) return;
  const skipped = Array.from(acc.unrecognizedQuestions.entries())
    .map(([text, n]) => `${n}× ${JSON.stringify(text)}`)
    .join("; ");
  console.warn(
    `[teacher-feedback] quiz ${quizId}: skipped responses for ` +
      `${acc.unrecognizedQuestions.size} question(s) absent from form ` +
      `${FEEDBACK_FORM_VERSION} — ${skipped}`
  );
}

/** Answered rows for each quiz, keyed by quiz id. */
async function fetchRows(quizIds: string[]): Promise<Map<string, RawRow[]>> {
  const byQuiz = new Map<string, RawRow[]>(quizIds.map((id) => [id, []]));
  if (quizIds.length === 0) return byQuiz;
  // Per quiz id, so an older form generation under the same cms_test_id can't
  // bleed in.
  const [rows] = await getBigQueryClient().query({
    query: `
      SELECT test_id, user_id, question_text, user_response, user_response_labels
      FROM ${FORM_LEVEL_TABLE}
      WHERE test_id IN UNNEST(@quizIds)
        AND is_answered = TRUE
        AND user_id != '${ADMIN_TEST_USER}'
    `,
    params: { quizIds },
    location: BQ_LOCATION,
  });
  for (const r of rows as Array<RawRow & { test_id: string }>) byQuiz.get(r.test_id)?.push(r);
  return byQuiz;
}

/**
 * Build the per-teacher report for one feedback quiz. `genderOf` (LMS user id →
 * gender) adds a split by gender; groups under MIN_GROUP_SIZE are left out.
 */
export async function getTeacherFeedbackReport(
  quizId: string,
  genderOf?: (userIds: string[]) => Promise<Map<string, Gender>>
): Promise<TeacherFeedbackReport> {
  const rows = (await fetchRows([quizId])).get(quizId) ?? [];
  const acc = accumulate(rows);
  warnUnrecognized(quizId, acc);

  const parameters = scoreParameters(acc);
  const totalScore = parameters.reduce((sum, p) => sum + p.score, 0);

  // Order comments liked-first then improve, for stable rendering.
  const order = OPEN_QUESTIONS.map((q) => q.role);
  acc.comments.sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));

  const byGender: Partial<Record<Gender, ScoreSummary>> = {};
  if (genderOf && acc.users.size > 0) {
    const genders = await genderOf([...acc.users]);
    for (const g of ["female", "male"] as const) {
      const groupRows = rows.filter((r) => genders.get(r.user_id) === g);
      const summary = summarize(accumulate(groupRows));
      if (summary.responseCount >= MIN_GROUP_SIZE) byGender[g] = summary;
    }
  }

  return {
    quizId,
    responseCount: acc.users.size,
    totalScore,
    maxTotalScore: MAX_TOTAL_SCORE,
    percentage: pct(totalScore, MAX_TOTAL_SCORE),
    parameters,
    comments: acc.comments,
    nothingCounts: acc.nothingCounts,
    byGender,
  };
}

/** Headline scores for many quizzes in one query (trends, teacher cards). */
export async function getTeacherFeedbackSummaries(
  quizIds: string[]
): Promise<Map<string, ScoreSummary>> {
  const rows = await fetchRows(quizIds);
  return new Map([...rows].map(([id, r]) => [id, summarize(accumulate(r))]));
}

/** user_ids (LMS user.id) who answered each feedback quiz, keyed by quiz id. */
export async function getRespondersByQuiz(quizIds: string[]): Promise<Map<string, Set<string>>> {
  const byQuiz = new Map<string, Set<string>>();
  if (quizIds.length === 0) return byQuiz;
  const [rows] = await getBigQueryClient().query({
    query: `
      SELECT test_id, ARRAY_AGG(DISTINCT user_id) AS user_ids
      FROM ${FORM_LEVEL_TABLE}
      WHERE test_id IN UNNEST(@quizIds) AND is_answered = TRUE
        AND user_id != '${ADMIN_TEST_USER}'
      GROUP BY test_id
    `,
    params: { quizIds },
    location: BQ_LOCATION,
  });
  for (const r of rows as Array<{ test_id: string; user_ids: string[] }>) {
    byQuiz.set(r.test_id, new Set((r.user_ids ?? []).map(String)));
  }
  return byQuiz;
}
