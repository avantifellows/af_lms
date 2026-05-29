// Types for the Curriculum Tracker feature

export interface Topic {
  id: number;
  code: string;
  name: string;
  chapterId: number;
}

export interface Chapter {
  id: number;
  code: string;
  name: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  examTrack?: ExamTrack;
  prescribedMinutes?: number;
  coverageSequence?: number;
  topics: Topic[];
}

export interface TeachingSession {
  id: string;
  date: string; // ISO date string (YYYY-MM-DD)
  durationMinutes: number;
  topicIds: number[];
  // Derived for display
  topics: {
    topicId: number;
    topicName: string;
    chapterName: string;
  }[];
}

export interface ChapterProgress {
  chapterId: number;
  completedTopicIds: number[];
  totalTimeMinutes: number;
  lastTaughtDate: string | null;
  allTopicsCovered: boolean; // true when all topics have been taught
  isChapterComplete: boolean; // true only after explicit "Mark Complete" action
  chapterCompletedDate: string | null; // when chapter was marked complete
}

export type SubjectName = "Physics" | "Chemistry" | "Maths" | "Biology";
export type GradeNumber = 11 | 12;
export type ExamTrack = "jee_main" | "jee_advanced" | "neet";

export interface CurriculumProgramOption {
  id: number;
  name: string;
}

export interface CurriculumGradeSubjectOption {
  examTrack: ExamTrack;
  grade: GradeNumber;
  gradeId: number;
  subject: SubjectName;
  subjectId: number;
}

export interface CurriculumOptionsResponse {
  programs: CurriculumProgramOption[];
  examTracks: ExamTrack[];
  gradeSubjects: CurriculumGradeSubjectOption[];
  defaults: {
    programId: number | null;
    examTrack: ExamTrack | null;
    grade: GradeNumber | null;
    gradeId: number | null;
    subject: SubjectName | null;
    subjectId: number | null;
  };
}

export interface CurriculumTrackerState {
  // Filters
  selectedGrade: GradeNumber;
  selectedSubject: SubjectName;

  // Data (fetched from API)
  chapters: Chapter[];
  isLoading: boolean;
  error: string | null;

  // Progress (persisted to localStorage)
  sessions: TeachingSession[];
  progress: Record<number, ChapterProgress>; // chapterId -> progress

  // UI state
  expandedChapterIds: number[];
  activeTab: "chapters" | "history";
  isLogSessionModalOpen: boolean;
}

// API response types
export interface ChaptersApiResponse {
  chapters: Chapter[];
}

// Subject ID mapping (from database)
export const SUBJECT_IDS: Record<SubjectName, number> = {
  Maths: 1,
  Chemistry: 2,
  Biology: 3,
  Physics: 4,
};

// Grade ID mapping (from database)
export const GRADE_IDS: Record<GradeNumber, number> = {
  11: 3,
  12: 4,
};
