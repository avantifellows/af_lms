import type { PoolClient } from "pg";
import { query } from "./db";
import {
  isExamTrack,
  isGradeNumber,
  isSubjectName,
  resolveCurriculumProgramScope,
  type CurriculumValidationFailure,
} from "./curriculum-options";
import type { ExamTrack, GradeNumber, SubjectName } from "@/types/curriculum";
import { GRADE_IDS, SUBJECT_IDS } from "@/types/curriculum";
import type { UserPermission } from "./permissions";

interface CompletionScopeRow {
  chapter_id: number;
  is_in_syllabus: boolean;
  active_completed_at: string | Date | null;
}

interface CompletionRow {
  chapter_id: number;
  completed_at: string | Date;
  completed_by_email: string | null;
}

export interface ChapterCompletionState {
  chapterId: number;
  active: boolean;
  completedAt: string | null;
  completedByEmail: string | null;
}

export type ChapterCompletionValidationResult =
  | {
      ok: true;
      examTrack: ExamTrack;
      grade: GradeNumber;
      gradeId: number;
      subject: SubjectName;
      subjectId: number;
      completeChapterIds: number[];
      uncompleteChapterIds: number[];
    }
  | CurriculumValidationFailure
  | { ok: false; status: 403 | 404; error: string };

function toTimestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function normalizeChapterIds(chapterIds: unknown): number[] {
  if (!Array.isArray(chapterIds)) return [];
  return Array.from(
    new Set(
      chapterIds
        .map((id) => (typeof id === "number" ? id : Number.parseInt(String(id), 10)))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
}

export async function validateChapterCompletionDeltas(params: {
  schoolCode: string;
  programId: number;
  examTrack: string;
  grade: number;
  subject: string;
  completeChapterIds: unknown;
  uncompleteChapterIds: unknown;
  permission: UserPermission;
}): Promise<ChapterCompletionValidationResult> {
  if (!isExamTrack(params.examTrack)) {
    return { ok: false, status: 422, error: "Invalid Exam Track" };
  }
  if (!isGradeNumber(params.grade)) {
    return { ok: false, status: 422, error: "Grade must be 11 or 12" };
  }
  if (!isSubjectName(params.subject)) {
    return {
      ok: false,
      status: 422,
      error: "Subject must be Physics, Chemistry, Maths, or Biology",
    };
  }

  const scope = await resolveCurriculumProgramScope(params.schoolCode, params.permission);
  if (!scope.ok) return scope;
  if (!scope.allowedProgramIds.includes(params.programId)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const completeChapterIds = normalizeChapterIds(params.completeChapterIds);
  const uncompleteChapterIds = normalizeChapterIds(params.uncompleteChapterIds);
  const overlappingChapterIds = completeChapterIds.filter((id) =>
    uncompleteChapterIds.includes(id)
  );
  if (overlappingChapterIds.length > 0) {
    return {
      ok: false,
      status: 422,
      error: "Chapter cannot be both marked and unmarked in the same save",
    };
  }

  const chapterIds = [...completeChapterIds, ...uncompleteChapterIds];
  if (chapterIds.length === 0) {
    return {
      ok: true,
      examTrack: params.examTrack,
      grade: params.grade,
      gradeId: GRADE_IDS[params.grade],
      subject: params.subject,
      subjectId: SUBJECT_IDS[params.subject],
      completeChapterIds,
      uncompleteChapterIds,
    };
  }

  const rows = await query<CompletionScopeRow>(
    `SELECT
       ch.id AS chapter_id,
       cfg.is_in_syllabus,
       active.completed_at AS active_completed_at
     FROM chapter ch
     JOIN grade g ON g.id = ch.grade_id
     JOIN lms_chapter_exam_configs cfg
       ON cfg.chapter_id = ch.id
      AND cfg.exam_track = $1
     LEFT JOIN lms_curriculum_chapter_completions active
       ON active.school_code = $5
      AND active.program_id = $6
      AND active.chapter_id = ch.id
      AND active.exam_track = $1
      AND active.deleted_at IS NULL
     WHERE ch.id = ANY($2::int[])
       AND g.number = $3
       AND ch.subject_id = $4`,
    [
      params.examTrack,
      chapterIds,
      params.grade,
      SUBJECT_IDS[params.subject],
      params.schoolCode,
      params.programId,
    ]
  );

  if (rows.length !== chapterIds.length) {
    return {
      ok: false,
      status: 422,
      error: "Chapters do not belong to the selected Grade, Subject, and Exam Track",
    };
  }

  const rowsByChapterId = new Map(rows.map((row) => [Number(row.chapter_id), row]));
  for (const chapterId of completeChapterIds) {
    if (!rowsByChapterId.get(chapterId)?.is_in_syllabus) {
      return {
        ok: false,
        status: 422,
        error: "Chapter is not in syllabus for the selected Exam Track",
      };
    }
  }

  for (const chapterId of uncompleteChapterIds) {
    const row = rowsByChapterId.get(chapterId);
    if (row && !row.is_in_syllabus && row.active_completed_at == null) {
      return {
        ok: false,
        status: 422,
        error: "Chapter is not in syllabus for the selected Exam Track",
      };
    }
  }

  return {
    ok: true,
    examTrack: params.examTrack,
    grade: params.grade,
    gradeId: GRADE_IDS[params.grade],
    subject: params.subject,
    subjectId: SUBJECT_IDS[params.subject],
    completeChapterIds,
    uncompleteChapterIds,
  };
}

export async function markChapterComplete(
  client: PoolClient,
  params: {
    schoolCode: string;
    programId: number;
    chapterId: number;
    examTrack: ExamTrack;
    actorEmail: string;
  }
): Promise<ChapterCompletionState> {
  await client.query<CompletionRow>(
    `INSERT INTO lms_curriculum_chapter_completions (
       school_code,
       program_id,
       chapter_id,
       exam_track,
       completed_by_email,
       inserted_by_email,
       updated_by_email
     )
     VALUES ($1, $2, $3, $4, $5, $5, $5)
     ON CONFLICT (school_code, program_id, chapter_id, exam_track)
       WHERE deleted_at IS NULL
       DO NOTHING`,
    [
      params.schoolCode,
      params.programId,
      params.chapterId,
      params.examTrack,
      params.actorEmail,
    ]
  );

  const rows = await client.query<CompletionRow>(
    `SELECT chapter_id, completed_at, completed_by_email
     FROM lms_curriculum_chapter_completions
     WHERE school_code = $1
       AND program_id = $2
       AND chapter_id = $3
       AND exam_track = $4
       AND deleted_at IS NULL
     LIMIT 1`,
    [params.schoolCode, params.programId, params.chapterId, params.examTrack]
  );

  const row = rows.rows[0];
  if (!row) throw new Error("Failed to mark Chapter Completion");
  return {
    chapterId: Number(row.chapter_id),
    active: true,
    completedAt: toTimestampString(row.completed_at),
    completedByEmail: row.completed_by_email,
  };
}

export async function unmarkChapterComplete(
  client: PoolClient,
  params: {
    schoolCode: string;
    programId: number;
    chapterId: number;
    examTrack: ExamTrack;
    actorEmail: string;
  }
): Promise<ChapterCompletionState> {
  await client.query(
    `UPDATE lms_curriculum_chapter_completions
     SET deleted_at = (NOW() AT TIME ZONE 'UTC'),
         updated_at = (NOW() AT TIME ZONE 'UTC'),
         updated_by_email = $5
     WHERE school_code = $1
       AND program_id = $2
       AND chapter_id = $3
       AND exam_track = $4
       AND deleted_at IS NULL`,
    [
      params.schoolCode,
      params.programId,
      params.chapterId,
      params.examTrack,
      params.actorEmail,
    ]
  );

  return {
    chapterId: params.chapterId,
    active: false,
    completedAt: null,
    completedByEmail: null,
  };
}
