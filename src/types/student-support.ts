// Response shapes for the Student support view (Score journey + Student report).
// Client-safe: no server imports.

export type AlStatus = "Sliding" | "Same" | "Improving";
export type ChapterFlag = "C" | "S";

/** "Questions to next AL", already decided server-side: extra correct
 *  answers (+4 each) the Latest AL's marks need to reach the level above. */
export type ToNextLevel =
  | { kind: "top" }
  | { kind: "none" }
  | {
      kind: "count";
      /** 0 when the latest marks already clear the cutoff. */
      questions: number;
      /** Marks short of the cutoff, rounded up (≤ 0 when cleared). */
      gap: number;
      cutoff: number;
      nextLevel: string;
      /** The latest test and the student's marks on it. */
      test: string;
      marks: number;
    };

/** The level on the student's newest non-retest sitting that has one. */
export interface LatestLevel {
  level: string;
  marks: number | null;
  test: string;
}

export type ScoreDirection = "Improving" | "Same" | "Declining";

/** Score % on every non-retest test the student sat, oldest first, and the
 *  direction over the last few. */
export interface ScoreTrend {
  points: number[];
  direction: ScoreDirection;
  /** Least-squares slope over the last `recent` points, in points per test. */
  slope: number;
  recent: number;
}

/** Marks change on the student's latest non-retest sitting vs the one before. */
export interface TestChange {
  sessionId: string;
  change: number;
  previous: string;
}

export interface ScoreJourneyRow {
  /** enrollment_user_id: the row key and the report's student param. */
  uid: string;
  /** Business Student ID, for display. */
  studentId: string | null;
  name: string;
  gender: string | null;
  category: string | null;
  /** The student's stream as the warehouse spells it. */
  stream: string | null;
  /** "engineering" | "medical" | null (not a JEE/NEET stream). */
  examStream: string | null;
  /** Predicted AL from grade-10 marks (JEE Main only). */
  predicted: string | null;
  predictedPct: number | null;
  /** dim_student.academic_level: mode of the last 3 major tests. */
  mode: string | null;
  status: AlStatus | null;
  latestAl: LatestLevel | null;
  toNext: ToNextLevel;
  /** Null with fewer than two scored tests. */
  trend: ScoreTrend | null;
  change: TestChange | null;
  /** Score % on the newest test the student sat (retests included): the
   *  default order within a group. */
  latestPct: number | null;
  /** Per session_id: the student's result on each test in `tests` they sat. */
  results: Record<string, TestResult>;
}

/** One major test in the Score journey's per-test columns. */
export interface JourneyTest {
  sessionId: string;
  name: string;
  date: string;
  /** Canonical test stream ("engineering", "medical"), if any. */
  stream: string | null;
  /** Maximum marks, from the sittings. */
  max: number | null;
  /** A later sitting of an earlier test's name: shown, never counted. */
  retest: boolean;
}

/** A student's result on one test: the warehouse's per-test AL (M1 … Not
 *  Qualified) and marks. */
export interface TestResult {
  level: string;
  marks: number | null;
  max: number | null;
}

export interface ScoreJourneyData {
  /** Levelled major tests in date order, after the test-grade filter. */
  tests: JourneyTest[];
  students: ScoreJourneyRow[];
}

export interface ChapterRow {
  key: string;
  code: string | null;
  name: string;
  priority: string | null;
  /** Answers (questions seen) across tests. */
  n: number;
  attempt: number | null;
  accuracy: number | null;
  score: number | null;
  tests: number;
  flag: ChapterFlag | null;
  pyq: string[];
  /** The chapter's topics, weakest first. */
  topics: TopicRow[];
}

export interface TopicRow {
  code: string;
  name: string;
  n: number;
  attempt: number | null;
  accuracy: number | null;
  score: number | null;
  flag: ChapterFlag | null;
}

export interface SubjectChapters {
  subject: string;
  passMark: number;
  answers: number;
  attempt: number | null;
  accuracy: number | null;
  chapters: ChapterRow[];
}

export interface ExamChapters {
  exam: string;
  subjects: SubjectChapters[];
}

export interface TestScore {
  marks: number | null;
  max: number | null;
  pct: number | null;
  correct: number | null;
  wrong: number | null;
  partial: number | null;
  skipped: number | null;
}

export interface TestHistoryRow {
  sessionId: string;
  name: string;
  date: string;
  exam: string | null;
  absent: boolean;
  level: string | null;
  rank: number | null;
  takers: number | null;
  overall: TestScore | null;
  subjects: (TestScore & { subject: string })[];
  /** Percentage-point change in overall score vs the previous sitting of the same exam. */
  change: number | null;
}

export interface StudentReportData {
  student: ScoreJourneyRow;
  chapters: ExamChapters[];
  tests: TestHistoryRow[];
}

/** One mentor interaction (a post-session note), answers as written. */
export interface MentorInteraction {
  title: string;
  /** ISO timestamp the notes were submitted; null for imported notes. */
  date: string | null;
  mentor: string | null;
  answers: { question: string; answer: string | null }[];
}

/** Note counts per uid. Students the viewer can't read are absent. */
export interface MentorNoteCounts {
  counts: Record<string, number>;
}
