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
