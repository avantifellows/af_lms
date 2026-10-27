// Response shapes for the Student support view (Score journey + Student report).
// Client-safe: no server imports.

export type AlStatus = "Sliding" | "Same" | "Improving";
export type ChapterFlag = "C" | "S";

/** "Questions to next mode AL", already decided server-side. */
export type ToNextLevel =
  | { kind: "top" }
  | { kind: "reached" }
  | { kind: "none" }
  | {
      kind: "count";
      questions: number;
      /** Median marks of the tests used, and the cutoff for the next level. */
      median: number;
      cutoff: number;
      nextLevel: string;
      tests: string[];
    };

export interface ScoreJourneyRow {
  /** enrollment_user_id: the row key and the report's student param. */
  uid: string;
  /** Business Student ID, for display. */
  studentId: string | null;
  name: string;
  gender: string | null;
  category: string | null;
  /** "engineering" | "medical" | null (not a JEE/NEET stream). */
  examStream: string | null;
  /** Predicted AL from grade-10 marks (JEE Main only). */
  predicted: string | null;
  predictedPct: number | null;
  /** dim_student.academic_level: mode of the last 3 major tests. */
  mode: string | null;
  status: AlStatus | null;
  /** Per-test ALs of the latest ≤3 levelled tests, oldest first. */
  last3: string[];
  /** Score % on the latest levelled test. */
  latestPct: number | null;
  toNext: ToNextLevel;
}

export interface ScoreJourneyData {
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
