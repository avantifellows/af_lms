// --- Batch Overview types ---

export interface TestTrendPoint {
  session_id: string;
  test_name: string;
  start_date: string;
  student_count: number;
  stream_student_count: number;
  test_format: string | null;
  test_stream: string | null;
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
