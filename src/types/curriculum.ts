// Types for the Curriculum Tracker feature

import type { ExamTrack } from "@/lib/exam-tracks";
import type { CurriculumLogType } from "@/lib/curriculum-log-types";

// Re-exported so the many existing `@/types/curriculum` importers keep one import site,
// while @/lib/exam-tracks stays the single place the track codes are declared.
export type { ExamTrack };
export type { CurriculumLogType } from "@/lib/curriculum-log-types";

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

export interface LmsCurriculumLogTopic {
  topicId: number;
  topicName: string;
  chapterId: number;
  chapterName: string;
}

export interface LmsCurriculumLog {
  id: number;
  logType: CurriculumLogType;
  logDate: string;
  // Null only for Class Cancelled logs, which record no teaching time.
  durationMinutes: number | null;
  programId: number;
  gradeId: number;
  subjectId: number;
  examTrack: ExamTrack;
  // Set only by the non-regular types; Regular Class derives chapters from topics.
  chapterId: number | null;
  chapterName: string | null;
  topics: LmsCurriculumLogTopic[];
  isEditable: boolean;
  createdAt: string;
  updatedAt: string;
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

export interface CurriculumCentreExamTrackOption {
  examTrack: ExamTrack;
  grade: GradeNumber;
  hasCurriculumConfig: boolean;
  isMapped: boolean;
  hasHistoricalLogs: boolean;
}

export interface CurriculumOptionsResponse {
  programs: CurriculumProgramOption[];
  examTracks: ExamTrack[];
  centreExamTracks: CurriculumCentreExamTrackOption[];
  gradeSubjects: CurriculumGradeSubjectOption[];
  configurationError: string | null;
  defaults: {
    programId: number | null;
    examTrack: ExamTrack | null;
    grade: GradeNumber | null;
    gradeId: number | null;
    subject: SubjectName | null;
    subjectId: number | null;
  };
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
