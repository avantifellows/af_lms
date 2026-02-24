export interface QuizSession {
  id: number;
  name: string;
  quiz_id: string | null;
  start_time: string;
  end_time: string | null;
  batch_name: string;
}

export interface QuizResult {
  student_name: string;
  attendance_status: string;
  marks_obtained: number | null;
  total_marks: number | null;
  percentage: number | null;
}

export interface SubjectScore {
  subject_name: string;
  avg_percentage: number;
  student_count: number;
}

export interface QuizSummary {
  total_students: number;
  present_count: number;
  absent_count: number;
  avg_score: number;
  min_score: number;
  max_score: number;
  score_distribution: ScoreDistribution[];
  subject_scores: SubjectScore[];
  student_results: QuizResult[];
}

export interface ScoreDistribution {
  range: string;
  count: number;
}

// --- Batch Overview types ---

export interface TestTrendPoint {
  session_id: string;
  test_name: string;
  start_date: string;
  student_count: number;
  avg_percentage: number;
  male_avg_percentage: number | null;
  female_avg_percentage: number | null;
  test_format: string | null;
}

export interface SubjectTrendPoint {
  session_id: string;
  test_name: string;
  subject: string;
  avg_percentage: number;
  test_format: string | null;
}

export interface BatchSummary {
  tests_conducted: number;
  avg_participation: number;
  overall_avg: number;
  trend_direction: "up" | "down" | "flat";
  weakest_subject: string | null;
}

export interface BatchOverviewData {
  summary: BatchSummary;
  tests: TestTrendPoint[];
  subjectTrend: SubjectTrendPoint[];
  totalEnrolled: number | null;
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

export interface StudentSubjectScore {
  subject: string;
  percentage: number;
  marks_scored: number;
  max_marks: number;
  accuracy: number;
  attempt_rate: number;
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
