export type HolisticProgress = "pending" | "completed" | "skipped" | "no_active_phase";

export type HolisticProgressRow = {
  studentId: number;
  studentName: string;
  externalStudentId: string | null;
  grade: 11 | 12;
  schoolName: string;
  schoolCode: string;
  mentorName: string;
  mentorEmail: string | null;
  phaseId: number | null;
  phaseNumber: number | null;
  phaseTitle: string | null;
  phaseState: "active" | "open" | "locked" | null;
  progress: HolisticProgress;
  completedAt: string | null;
  notesAuthor: string | null;
  notesAuthorEmail: string | null;
  notesLastEditedAt: string | null;
  answers: Array<{ position: number; question: string; answer: string }>;
};
