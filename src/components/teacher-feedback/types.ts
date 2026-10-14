// Shapes the Teacher Feedback tab reads from its API routes.

export interface BatchOption {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
}

export interface FeedbackTeacher {
  id: string | null;
  name: string;
  role: string | null;
  subject: string | null;
}

export interface FeedbackCentre {
  id: number;
  name: string;
  typeCode: string | null;
}

export interface CycleTeacher {
  teacherName: string;
  teacherOrder: number;
  teacherId: string | null;
  quizId: string | null;
  status: string;
  portalLink: string;
  adminTestingLink: string;
  buildFailed: boolean;
}

export interface Cycle {
  setupRunId: string;
  cycleLabel: string;
  centreName: string | null;
  batchClassIds: string[];
  batchClassNames: string[];
  startTime: string | null;
  endTime: string | null;
  createdBy: string;
  createdAt: string;
  teachers: CycleTeacher[];
}

export interface TeacherResponses {
  teacherOrder: number;
  responded: number;
  total: number;
  outsideBatches: number;
  /** Everyone who answered, including outsiders — the same students Analysis scores. */
  responseCount: number;
  percentage: number;
  notResponded: { name: string; studentId: string | null; batchId: string }[];
}
