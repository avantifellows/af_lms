// Question-level analytics shared by the chapter-test report and, later, Teacher
// View v2 (#324). Client-safe: no server imports.

/** One question's responses within a scope (one test session at one School today;
 *  one student across tests for #324). Counts are over submitted attempts only. */
export interface QuestionStat {
  /** Quiz-side question id; unique within a test session. */
  question_id: string;
  /** CMS problem id for new-CMS questions (question_source_id); null for old CMS. */
  cms_question_id: number | null;
  /** 0-based position in the test. */
  position: number | null;
  /** easy | medium | hard (the question's own difficulty); null when untagged. */
  difficulty: string | null;
  subject: string | null;
  /** Topic names, primary topic first. Empty for old-CMS or untagged questions. */
  topics: string[];
  responses: number;
  attempted: number;
  correct: number;
  /** Attempted but not correct (includes partially correct). */
  incorrect: number;
  skipped: number;
  /** Mean seconds on the question across all responses; null when not recorded. */
  avg_time_seconds: number | null;
}

/** Totals for a group of questions (a topic, a difficulty level). */
export interface QuestionGroupStat {
  label: string;
  questions: number;
  responses: number;
  attempted: number;
  correct: number;
  incorrect: number;
  skipped: number;
  /** skipped / responses, 0–100. */
  skip_pct: number;
  /** correct / attempted, 0–100; null when nothing was attempted. */
  accuracy_pct: number | null;
}

/** Average results for one slice of the students who sat a test. */
export interface CohortStat {
  students: number;
  avg_attempt_rate: number;
  /** Over students who attempted something: a student who attempted nothing has
   *  no accuracy, not 0%. */
  avg_accuracy: number;
  avg_score: number;
  /** Students with an accuracy (who attempted something); defaults to `students`.
   *  Weights avg_accuracy when slices are combined. */
  accuracy_students?: number;
}

export interface GenderStat extends CohortStat {
  /** female | male | other | "" (not recorded) */
  gender: string;
}

export interface SchoolComparisonRow extends CohortStat {
  school: string;
  udise: string;
  program: string | null;
  is_this_school: boolean;
}

export interface ChapterTestMeta {
  session_id: string;
  test_name: string;
  test_format: string | null;
  start_date: string | null;
  test_grade: number | null;
  /** JEE Mains, NEET, … (test_course). */
  exam: string | null;
  subject: string | null;
  /** CMS test id: numeric for new CMS; null when the session has none. */
  cms_test_id: string | null;
  /** From the CMS curriculum dimensions; null for old-CMS tests. */
  chapter_code: string | null;
  chapter_name: string | null;
  /** High | Medium | Low for the test's stream; null when untagged. */
  priority: string | null;
  duration_minutes: number | null;
  total_questions: number | null;
  max_marks: number | null;
}

export interface ChapterTestOverview extends CohortStat {
  /** Students who submitted: like every number in the report, only those in the
   *  test's stream when it has one (the overview card's rule). Equals `students`. */
  appeared: number;
  /** Students enrolled in the test's stream at this School and grade; null when unknown. */
  enrolled: number | null;
  avg_time_minutes: number | null;
}

export interface ChapterTestReportData {
  test: ChapterTestMeta;
  overview: ChapterTestOverview;
  gender: GenderStat[];
  questions: QuestionStat[];
  comparison: SchoolComparisonRow[];
}

/** One question's content from the CMS, for display. HTML may contain LaTeX
 *  (\( … \), \[ … \]) and inline base64 images; render only after sanitising. */
export interface QuestionContent {
  id: number;
  type: string;
  text: string;
  options: string[];
  /** Raw CMS answer values: 1-based option numbers for MCQs, the value otherwise. */
  answer: string[];
  solutions: string[];
}
