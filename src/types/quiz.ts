// --- Batch Overview types ---

export interface TestTrendPoint {
  session_id: string;
  test_name: string;
  start_date: string;
  student_count: number;
  stream_student_count: number;
  test_format: string | null;
  test_stream: string | null;
  // Subjects this test covers, derived from non-`overall` `section` values.
  // Empty for tests that have no per-subject breakdown.
  subjects: string[];
}

export interface BatchSummary {
  tests_conducted: number;
  avg_participation: number;
}

export interface BatchOverviewData {
  summary: BatchSummary;
  tests: TestTrendPoint[];
  totalEnrolled: number | null;
  enrolledByStream: Record<string, number>;
  // Canonical (lowercase) stream keys available for this school + grade + program.
  streams: string[];
}

// --- Cumulative Academic Level (AL) types ---

// One major test in chronological order, used as a column in the progression
// matrix. `stream` is the canonical (lowercase) test_stream so the matrix can
// separate JEE (PCM/engineering) from NEET (PCB/medical) tests.
export interface ProgressionTest {
  session_id: string;
  test_name: string;
  start_date: string;
  stream: string | null;
}

// AL the student earned on a specific major test. Only populated for tests
// the student appeared in; missing entries render as "—" in the matrix.
export interface ProgressionEntry {
  session_id: string;
  academic_level: string;
  marks_scored: number | null;
  max_marks_possible: number | null;
}

export interface CumulativeALRow {
  student_id: string;
  student_name: string;
  stream: string | null;
  total_major_tests: number;
  // Counts of each AL value across major tests for this student.
  al_counts: Record<string, number>;
  mode_al: string | null;
  // Per-test AL points in chronological order. Useful when summarising trend
  // (most recent vs earliest) without consulting the test list.
  progression: ProgressionEntry[];
}

export interface CumulativeALData {
  students: CumulativeALRow[];
  // All major tests in chronological order — column headers for the matrix.
  tests: ProgressionTest[];
}

// --- Test Deep Dive types ---

export interface TestDeepDiveSummary {
  test_name: string;
  start_date: string;
  students_appeared: number;
  avg_score: number;
  min_score: number;
  max_score: number;
  avg_accuracy: number;
  avg_attempt_rate: number;
}

export interface SubjectAnalysisRow {
  subject: string;
  avg_score: number;
  avg_accuracy: number;
  avg_attempt_rate: number;
  total_questions: number;
}

export interface ChapterAnalysisRow {
  subject: string;
  chapter_name: string;
  // Stable join key shared with fact_student_test_results_question_level (BQ).
  // Populated by the v2 reports flow; null if upstream chapter_tagging lookup
  // missed and only a raw chapter_name was available.
  chapter_id: string | null;
  // Stream-keyed chapter priority (High/Medium/Low), resolved upstream by
  // etl-next. Null/absent when the chapter has no tag yet.
  priority: string | null;
  avg_score: number;
  accuracy: number;
  attempt_rate: number;
  questions: number;
  avg_time: number | null;
}

export interface StudentChapterScore {
  subject: string;
  chapter_name: string;
  marks_scored: number;
  max_marks: number;
  accuracy: number;
  attempt_rate: number;
  total_questions: number;
}

export interface StudentSubjectScore {
  subject: string;
  percentage: number;
  marks_scored: number;
  max_marks: number;
  accuracy: number;
  attempt_rate: number;
  chapters?: StudentChapterScore[];
}

export interface StudentDeepDiveRow {
  student_name: string;
  gender: string | null;
  marks_scored: number;
  max_marks: number;
  percentage: number;
  accuracy: number;
  attempt_rate: number;
  subject_scores: StudentSubjectScore[];
}

export interface TestDeepDiveData {
  summary: TestDeepDiveSummary;
  subjects: SubjectAnalysisRow[];
  chapters: ChapterAnalysisRow[];
  students: StudentDeepDiveRow[];
}

// --- Question-level types ---

// One row per question across the class for a given test.
export interface TestQuestionLevelRow {
  subject: string;
  chapter_name: string;
  chapter_id: string | null;
  question_id: string;
  position_index: number | null;
  total_students: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  attempt_rate: number; // percentage 0-100
  accuracy: number; // percentage 0-100 (of attempters)
}

export interface TestQuestionLevelData {
  questions: TestQuestionLevelRow[];
}
