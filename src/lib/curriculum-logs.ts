import type { PoolClient } from "pg";
import { query, withTransaction } from "./db";
import {
  curriculumIdForExamTrack,
  isGradeNumber,
  isSubjectName,
  resolveCurriculumProgramScope,
  type CurriculumValidationFailure,
} from "./curriculum-options";
import { validateCentreExamTrackMapping } from "./centre-resolver";
import { formatExamTrack, isExamTrack } from "./exam-tracks";
import { getSubjectExamTrackCompatibilityError } from "./curriculum-subject-track";
import { isFutureIST, isPastOrTodayIST } from "./curriculum-date-helpers";
import {
  markChapterComplete,
  unmarkChapterComplete,
  validateChapterCompletionDeltas,
  type ChapterCompletionState,
} from "./curriculum-chapter-completion";
import type {
  CurriculumLogType,
  ExamTrack,
  GradeNumber,
  LmsCurriculumLog,
  LmsCurriculumLogTopic,
  SubjectName,
  WritableCurriculumLogType,
} from "@/types/curriculum";
import {
  GRADE_IDS,
  SUBJECT_IDS,
  isWritableCurriculumLogType,
} from "@/types/curriculum";
import type { UserPermission } from "./permissions";

interface LogTopicRow {
  id: number;
  log_type: CurriculumLogType;
  log_date: string | Date;
  duration_minutes: number | null;
  program_id: number;
  grade_id: number;
  subject_id: number;
  exam_track: ExamTrack;
  inserted_at: string | Date;
  updated_at: string | Date;
  topic_id: number | null;
  topic_name: unknown;
  chapter_id: number | null;
  chapter_name: unknown;
  topic_currently_in_syllabus: boolean | null;
  log_chapter_id: number | null;
  log_chapter_name: unknown;
}

interface ValidTopicRow {
  topic_id: number;
  topic_name: unknown;
  chapter_id: number;
  chapter_name: unknown;
}

interface LogMutationScopeRow {
  id: number;
  school_code: string;
  program_id: number;
  grade_id: number;
  subject_id: number;
  exam_track: ExamTrack;
  log_type: CurriculumLogType;
  is_editable: boolean;
}

type CurriculumMutationResult =
  | { ok: true; log: LmsCurriculumLog | null; completions: ChapterCompletionState[]; createdLog: boolean }
  | CurriculumValidationFailure
  | { ok: false; status: 404; error: string };

type CurriculumEditResult =
  | { ok: true; log: LmsCurriculumLog }
  | CurriculumValidationFailure
  | { ok: false; status: 404; error: string };

type CurriculumDeleteResult =
  | { ok: true; deleted: true }
  | CurriculumValidationFailure
  | { ok: false; status: 404; error: string };

type CurriculumLogsResult =
  | { ok: true; logs: LmsCurriculumLog[] }
  | CurriculumValidationFailure
  | { ok: false; status: 403 | 404; error: string };

function extractEnglishName(jsonbData: unknown, field: string): string {
  try {
    const parsed = typeof jsonbData === "string" ? JSON.parse(jsonbData) : jsonbData;
    if (!Array.isArray(parsed)) return `Unknown ${field}`;
    const english = parsed.find((item: Record<string, string>) => item.lang_code === "en");
    return english?.[field] || `Unknown ${field}`;
  } catch {
    return `Unknown ${field}`;
  }
}

function toDateString(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return value.slice(0, 10);
}

function toTimestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeTopicIds(topicIds: unknown): number[] {
  if (!Array.isArray(topicIds)) return [];
  return Array.from(
    new Set(
      topicIds
        .map((id) => (typeof id === "number" ? id : Number.parseInt(String(id), 10)))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );
}

function logsFromRows(rows: LogTopicRow[]): LmsCurriculumLog[] {
  const logsById = new Map<number, LmsCurriculumLog & { _editable: boolean }>();

  for (const row of rows) {
    const logId = Number(row.id);
    let log = logsById.get(logId);
    if (!log) {
      log = {
        id: logId,
        logType: row.log_type ?? "regular",
        logDate: toDateString(row.log_date),
        durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
        programId: Number(row.program_id),
        gradeId: Number(row.grade_id),
        subjectId: Number(row.subject_id),
        examTrack: row.exam_track,
        chapterId: row.log_chapter_id == null ? null : Number(row.log_chapter_id),
        chapterName:
          row.log_chapter_id == null
            ? null
            : extractEnglishName(row.log_chapter_name, "chapter"),
        topics: [],
        isEditable: true,
        createdAt: toTimestampString(row.inserted_at),
        updatedAt: toTimestampString(row.updated_at),
        _editable: true,
      };
      logsById.set(logId, log);
    }

    // Types that store a Chapter directly have no topic rows, so there is no
    // syllabus drift that could make them historical.
    if (row.topic_id == null) continue;

    if (!row.topic_currently_in_syllabus) {
      log._editable = false;
      log.isEditable = false;
    }

    const topic: LmsCurriculumLogTopic = {
      topicId: Number(row.topic_id),
      topicName: extractEnglishName(row.topic_name, "topic"),
      chapterId: Number(row.chapter_id),
      chapterName: extractEnglishName(row.chapter_name, "chapter"),
    };
    log.topics.push(topic);
  }

  return [...logsById.values()].map((entry) => {
    const { _editable, ...log } = entry;
    void _editable;
    return log;
  });
}

export async function validateSelectedScope(params: {
  schoolCode: string;
  programId: number;
  examTrack: string;
  grade: number;
  subject: string;
  permission: UserPermission;
}): Promise<
  | {
      ok: true;
      examTrack: ExamTrack;
      grade: GradeNumber;
      subject: SubjectName;
      gradeId: number;
      subjectId: number;
      curriculumId: number;
    }
  | CurriculumValidationFailure
  | { ok: false; status: 403 | 404; error: string }
> {
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

  const curriculumId = curriculumIdForExamTrack(params.examTrack);
  if (curriculumId === null) {
    return {
      ok: false,
      status: 422,
      error: `Curriculum configuration is not available for ${formatExamTrack(params.examTrack)}`,
    };
  }

  return {
    ok: true,
    examTrack: params.examTrack,
    grade: params.grade,
    subject: params.subject,
    gradeId: GRADE_IDS[params.grade],
    subjectId: SUBJECT_IDS[params.subject],
    curriculumId,
  };
}

async function loadValidTopics(params: {
  topicIds: number[];
  examTrack: ExamTrack;
  grade: GradeNumber;
  subjectId: number;
  curriculumId: number;
}): Promise<ValidTopicRow[]> {
  return query<ValidTopicRow>(
    `SELECT
       t.id AS topic_id,
       t.name AS topic_name,
       ch.id AS chapter_id,
       ch.name AS chapter_name
     FROM topic t
     JOIN chapter ch ON ch.id = t.chapter_id
     JOIN topic_curriculum tc
       ON tc.topic_id = t.id
      AND tc.curriculum_id = $5
     JOIN grade g ON g.id = ch.grade_id
     JOIN lms_chapter_exam_configs cfg
       ON cfg.chapter_id = ch.id
      AND cfg.exam_track = $1
      AND cfg.is_in_syllabus = true
     WHERE t.id = ANY($2::int[])
       AND g.number = $3
       AND ch.subject_id = $4`,
    [
      params.examTrack,
      params.topicIds,
      params.grade,
      params.subjectId,
      params.curriculumId,
    ]
  );
}

async function loadValidTopicsForStoredScope(params: {
  topicIds: number[];
  examTrack: ExamTrack;
  gradeId: number;
  subjectId: number;
  curriculumId: number;
}): Promise<ValidTopicRow[]> {
  return query<ValidTopicRow>(
    `SELECT
       t.id AS topic_id,
       t.name AS topic_name,
       ch.id AS chapter_id,
       ch.name AS chapter_name
     FROM topic t
     JOIN chapter ch ON ch.id = t.chapter_id
     JOIN topic_curriculum tc
       ON tc.topic_id = t.id
      AND tc.curriculum_id = $5
     JOIN lms_chapter_exam_configs cfg
       ON cfg.chapter_id = ch.id
      AND cfg.exam_track = $1
      AND cfg.is_in_syllabus = true
     WHERE t.id = ANY($2::int[])
       AND ch.grade_id = $3
       AND ch.subject_id = $4`,
    [
      params.examTrack,
      params.topicIds,
      params.gradeId,
      params.subjectId,
      params.curriculumId,
    ]
  );
}

const DUPLICATE_CLASS_CANCELLED_ERROR =
  "A Class Cancelled log already exists for this Chapter and date";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

function normalizeChapterId(chapterId: unknown): number | null {
  const parsed = typeof chapterId === "number"
    ? chapterId
    : typeof chapterId === "string" && /^\d+$/.test(chapterId)
      ? Number(chapterId)
      : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

// Chapter-backed log types offer the same Chapter list the Curriculum tab shows,
// so they validate against the in-syllabus config for the scope.
async function chapterIsInSelectedScope(params: {
  chapterId: number;
  examTrack: ExamTrack;
  grade: GradeNumber;
  subjectId: number;
}): Promise<boolean> {
  const rows = await query<{ chapter_id: number }>(
    `SELECT ch.id AS chapter_id
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     WHERE cfg.exam_track = $1
       AND cfg.is_in_syllabus = true
       AND ch.id = $2
       AND g.number = $3
       AND ch.subject_id = $4`,
    [params.examTrack, params.chapterId, params.grade, params.subjectId]
  );
  return rows.length > 0;
}

async function chapterIsInStoredScope(params: {
  chapterId: number;
  examTrack: ExamTrack;
  gradeId: number;
  subjectId: number;
}): Promise<boolean> {
  const rows = await query<{ chapter_id: number }>(
    `SELECT ch.id AS chapter_id
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     WHERE cfg.exam_track = $1
       AND cfg.is_in_syllabus = true
       AND ch.id = $2
       AND ch.grade_id = $3
       AND ch.subject_id = $4`,
    [params.examTrack, params.chapterId, params.gradeId, params.subjectId]
  );
  return rows.length > 0;
}

async function activeClassCancelledLogExists(params: {
  schoolCode: string;
  programId: number;
  gradeId: number;
  subjectId: number;
  examTrack: ExamTrack;
  chapterId: number;
  logDate: string;
  excludeLogId?: number | null;
}): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `SELECT id
     FROM lms_curriculum_logs
     WHERE log_type = 'class_cancelled'
       AND school_code = $1
       AND program_id = $2
       AND grade_id = $3
       AND subject_id = $4
       AND exam_track = $5
       AND chapter_id = $6
       AND log_date = $7::date
       AND deleted_at IS NULL
       AND ($8::bigint IS NULL OR id <> $8::bigint)
     LIMIT 1`,
    [
      params.schoolCode,
      params.programId,
      params.gradeId,
      params.subjectId,
      params.examTrack,
      params.chapterId,
      params.logDate,
      params.excludeLogId ?? null,
    ]
  );
  return rows.length > 0;
}

async function loadLogMutationScope(id: number): Promise<LogMutationScopeRow | null> {
  const rows = await query<LogMutationScopeRow>(
    `SELECT
       l.id,
       l.school_code,
       l.program_id,
       l.grade_id,
       l.subject_id,
       l.exam_track,
       l.log_type,
       COALESCE(
         bool_and(
           lt.topic_id IS NULL
           OR EXISTS (
             SELECT 1
             FROM lms_chapter_exam_configs current_cfg
             JOIN topic current_topic ON current_topic.chapter_id = current_cfg.chapter_id
             JOIN topic_curriculum current_tc
               ON current_tc.topic_id = current_topic.id
             WHERE current_topic.id = lt.topic_id
               AND current_cfg.exam_track = l.exam_track
               AND current_cfg.is_in_syllabus = true
               AND current_tc.curriculum_id = CASE l.exam_track
                 WHEN 'jee_main' THEN 1
                 WHEN 'jee_advanced' THEN 9
                 WHEN 'neet' THEN 2
               END
           )
         ),
         true
       ) AS is_editable
     FROM lms_curriculum_logs l
     LEFT JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = l.id
     WHERE l.id = $1
       AND l.deleted_at IS NULL
     GROUP BY l.id, l.school_code, l.program_id, l.grade_id, l.subject_id, l.exam_track, l.log_type`,
    [id]
  );

  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    id: Number(row.id),
    program_id: Number(row.program_id),
    grade_id: Number(row.grade_id),
    subject_id: Number(row.subject_id),
    log_type: row.log_type ?? "regular",
  };
}

async function insertCurriculumLog(
  client: PoolClient,
  params: {
    schoolCode: string;
    programId: number;
    gradeId: number;
    subjectId: number;
    examTrack: ExamTrack;
    logType: WritableCurriculumLogType;
    logDate: string;
    durationMinutes: number | null;
    chapterId: number | null;
    topicIds: number[];
    actorEmail: string;
  }
): Promise<number> {
  const inserted = await client.query<{ id: number }>(
    `INSERT INTO lms_curriculum_logs (
       school_code,
       program_id,
       grade_id,
       subject_id,
       exam_track,
       log_type,
       log_date,
       duration_minutes,
       chapter_id,
       created_by_email,
       inserted_by_email,
       updated_by_email
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10)
     RETURNING id`,
    [
      params.schoolCode,
      params.programId,
      params.gradeId,
      params.subjectId,
      params.examTrack,
      params.logType,
      params.logDate,
      params.durationMinutes,
      params.chapterId,
      params.actorEmail,
    ]
  );

  const logId = Number(inserted.rows[0]?.id);
  if (!logId) throw new Error("Failed to create LMS Curriculum Log");

  if (params.topicIds.length > 0) {
    await client.query(
      `INSERT INTO lms_curriculum_log_topics (curriculum_log_id, topic_id)
       SELECT $1::int, unnest($2::int[])`,
      [logId, params.topicIds]
    );
  }

  return logId;
}

async function replaceCurriculumLogTopics(
  client: PoolClient,
  params: {
    logId: number;
    logDate: string;
    durationMinutes: number;
    topicIds: number[];
    actorEmail: string;
  }
): Promise<boolean> {
  const updated = await client.query(
    `UPDATE lms_curriculum_logs
     SET log_date = $2,
         duration_minutes = $3,
         updated_by_email = $4,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1
       AND deleted_at IS NULL`,
    [params.logId, params.logDate, params.durationMinutes, params.actorEmail]
  );
  if (updated.rowCount === 0) {
    return false;
  }

  await client.query(
    `DELETE FROM lms_curriculum_log_topics
     WHERE curriculum_log_id = $1`,
    [params.logId]
  );

  await client.query(
    `INSERT INTO lms_curriculum_log_topics (curriculum_log_id, topic_id)
     SELECT $1::int, unnest($2::int[])`,
    [params.logId, params.topicIds]
  );
  return true;
}

async function updateChapterBackedLog(
  client: PoolClient,
  params: {
    logId: number;
    logDate: string;
    durationMinutes: number | null;
    chapterId: number;
    actorEmail: string;
  }
): Promise<boolean> {
  const updated = await client.query(
    `UPDATE lms_curriculum_logs
     SET log_date = $2,
         duration_minutes = $3,
         chapter_id = $4,
         updated_by_email = $5,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1
       AND deleted_at IS NULL`,
    [
      params.logId,
      params.logDate,
      params.durationMinutes,
      params.chapterId,
      params.actorEmail,
    ]
  );
  return updated.rowCount !== 0;
}

export async function getCurriculumLogs(params: {
  schoolCode: string;
  programId: number;
  examTrack: string;
  grade: number;
  subject: string;
  permission: UserPermission;
}): Promise<CurriculumLogsResult> {
  const scope = await validateSelectedScope(params);
  if (!scope.ok) return scope;

  const rows = await query<LogTopicRow>(
    `SELECT
       l.id,
       l.log_type,
       l.log_date,
       l.duration_minutes,
       l.program_id,
       l.grade_id,
       l.subject_id,
       l.exam_track,
       l.inserted_at,
       l.updated_at,
       lt.topic_id,
       lt.topic_name,
       lt.chapter_id,
       lt.chapter_name,
       lt.topic_currently_in_syllabus,
       l.chapter_id AS log_chapter_id,
       log_ch.name AS log_chapter_name
     FROM lms_curriculum_logs l
     LEFT JOIN chapter log_ch ON log_ch.id = l.chapter_id
     LEFT JOIN LATERAL (
       SELECT
         lt.id AS link_id,
         lt.topic_id,
         t.name AS topic_name,
         ch.id AS chapter_id,
         ch.name AS chapter_name,
         EXISTS (
           SELECT 1
           FROM lms_chapter_exam_configs current_cfg
           JOIN topic_curriculum current_tc
             ON current_tc.topic_id = t.id
           WHERE current_cfg.chapter_id = ch.id
             AND current_cfg.exam_track = l.exam_track
             AND current_cfg.is_in_syllabus = true
             AND current_tc.curriculum_id = $6
         ) AS topic_currently_in_syllabus
       FROM lms_curriculum_log_topics lt
       JOIN topic t ON t.id = lt.topic_id
       JOIN topic_curriculum tc
         ON tc.topic_id = t.id
        AND tc.curriculum_id = $6
       JOIN chapter ch ON ch.id = t.chapter_id
       WHERE lt.curriculum_log_id = l.id
     ) lt ON true
     WHERE l.school_code = $1
       AND l.program_id = $2
       AND l.grade_id = $3
       AND l.subject_id = $4
       AND l.exam_track = $5
       AND l.deleted_at IS NULL
     ORDER BY l.log_date DESC, l.inserted_at DESC, lt.link_id ASC`,
    [
      params.schoolCode,
      params.programId,
      scope.gradeId,
      scope.subjectId,
      scope.examTrack,
      scope.curriculumId,
    ]
  );

  return { ok: true, logs: logsFromRows(rows) };
}

export async function getCurriculumLogById(id: number): Promise<LmsCurriculumLog | null> {
  const rows = await query<LogTopicRow>(
    `SELECT
       l.id,
       l.log_type,
       l.log_date,
       l.duration_minutes,
       l.program_id,
       l.grade_id,
       l.subject_id,
       l.exam_track,
       l.inserted_at,
       l.updated_at,
       lt.topic_id,
       lt.topic_name,
       lt.chapter_id,
       lt.chapter_name,
       lt.topic_currently_in_syllabus,
       l.chapter_id AS log_chapter_id,
       log_ch.name AS log_chapter_name
     FROM lms_curriculum_logs l
     LEFT JOIN chapter log_ch ON log_ch.id = l.chapter_id
     LEFT JOIN LATERAL (
       SELECT
         lt.id AS link_id,
         lt.topic_id,
         t.name AS topic_name,
         ch.id AS chapter_id,
         ch.name AS chapter_name,
         EXISTS (
           SELECT 1
           FROM lms_chapter_exam_configs current_cfg
           JOIN topic_curriculum current_tc
             ON current_tc.topic_id = t.id
           WHERE current_cfg.chapter_id = ch.id
             AND current_cfg.exam_track = l.exam_track
             AND current_cfg.is_in_syllabus = true
             AND current_tc.curriculum_id = CASE l.exam_track
               WHEN 'jee_main' THEN 1
               WHEN 'jee_advanced' THEN 9
               WHEN 'neet' THEN 2
             END
         ) AS topic_currently_in_syllabus
       FROM lms_curriculum_log_topics lt
       JOIN topic t ON t.id = lt.topic_id
       JOIN topic_curriculum tc
         ON tc.topic_id = t.id
        AND tc.curriculum_id = CASE l.exam_track
          WHEN 'jee_main' THEN 1
          WHEN 'jee_advanced' THEN 9
          WHEN 'neet' THEN 2
        END
       JOIN chapter ch ON ch.id = t.chapter_id
       WHERE lt.curriculum_log_id = l.id
     ) lt ON true
     WHERE l.id = $1
       AND l.deleted_at IS NULL
     ORDER BY lt.link_id ASC`,
    [id]
  );

  return logsFromRows(rows)[0] ?? null;
}

export async function createCurriculumLog(params: {
  schoolCode: string;
  programId: number;
  examTrack: string;
  grade: number;
  subject: string;
  logType?: unknown;
  logDate: string | null;
  durationMinutes: number | null;
  chapterId?: unknown;
  topicIds: unknown;
  completeChapterIds?: unknown;
  uncompleteChapterIds?: unknown;
  permission: UserPermission;
  actorEmail: string;
}): Promise<CurriculumMutationResult> {
  const logType = params.logType == null ? "regular" : params.logType;
  if (!isWritableCurriculumLogType(logType)) {
    return {
      ok: false,
      status: 422,
      error: "Log type must be Regular Class, Class Cancelled, or Doubt Solving",
    };
  }

  const topicIds = normalizeTopicIds(params.topicIds);
  const scope = await validateChapterCompletionDeltas({
    schoolCode: params.schoolCode,
    programId: params.programId,
    examTrack: params.examTrack,
    grade: params.grade,
    subject: params.subject,
    completeChapterIds: params.completeChapterIds,
    uncompleteChapterIds: params.uncompleteChapterIds,
    permission: params.permission,
  });
  if (!scope.ok) return scope;

  const mapping = await validateCentreExamTrackMapping({
    schoolCode: params.schoolCode,
    programId: params.programId,
    grade: scope.grade,
    examTrack: scope.examTrack,
  });
  if (!mapping.ok) return { ok: false, status: 422, error: mapping.error };

  const curriculumId = curriculumIdForExamTrack(scope.examTrack);
  if (curriculumId === null) {
    return {
      ok: false,
      status: 422,
      error: `Curriculum configuration is not available for ${formatExamTrack(scope.examTrack)}`,
    };
  }

  const hasCompletionDeltas =
    scope.completeChapterIds.length > 0 ||
    scope.uncompleteChapterIds.length > 0;
  const isClassCancelled = logType === "class_cancelled";
  const isDoubtSolving = logType === "doubt_solving";
  const isChapterBacked = isClassCancelled || isDoubtSolving;
  if (isDoubtSolving && hasCompletionDeltas) {
    return {
      ok: false,
      status: 422,
      error: "Doubt Solving logs cannot include Chapter Completion changes",
    };
  }
  if (!isChapterBacked && topicIds.length === 0 && !hasCompletionDeltas) {
    return { ok: false, status: 422, error: "Nothing to save" };
  }

  const logDate = params.logDate;
  const durationMinutes = params.durationMinutes;
  const chapterId = normalizeChapterId(params.chapterId);

  if (isChapterBacked) {
    if (topicIds.length > 0) {
      return {
        ok: false,
        status: 422,
        error: `${isClassCancelled ? "Class Cancelled" : "Doubt Solving"} logs cannot include topics`,
      };
    }
    if (isClassCancelled && durationMinutes != null) {
      return { ok: false, status: 422, error: "Class Cancelled logs cannot have a duration" };
    }
    if (chapterId == null) {
      return {
        ok: false,
        status: 422,
        error: `${isClassCancelled ? "Class Cancelled" : "Doubt Solving"} logs require exactly one Chapter`,
      };
    }
    if (
      isDoubtSolving &&
      (durationMinutes == null ||
        !Number.isInteger(durationMinutes) ||
        durationMinutes <= 0 ||
        durationMinutes > 720)
    ) {
      return {
        ok: false,
        status: 422,
        error: "Duration must be greater than 0 and at most 720 minutes",
      };
    }
    if (!logDate || !isPastOrTodayIST(logDate) || isFutureIST(logDate)) {
      return { ok: false, status: 422, error: "Log date cannot be in the future" };
    }

    const chapterInScope = await chapterIsInSelectedScope({
      chapterId,
      examTrack: scope.examTrack,
      grade: scope.grade,
      subjectId: scope.subjectId,
    });
    if (!chapterInScope) {
      return {
        ok: false,
        status: 422,
        error: "Chapter does not belong to the selected Grade, Subject, and Exam Track",
      };
    }

    if (isClassCancelled) {
      const duplicate = await activeClassCancelledLogExists({
        schoolCode: params.schoolCode,
        programId: params.programId,
        gradeId: scope.gradeId,
        subjectId: scope.subjectId,
        examTrack: scope.examTrack,
        chapterId,
        logDate,
      });
      if (duplicate) {
        return { ok: false, status: 422, error: DUPLICATE_CLASS_CANCELLED_ERROR };
      }
    }
  } else if (chapterId != null) {
    return {
      ok: false,
      status: 422,
      error: "Regular Class logs derive their Chapters from topics",
    };
  } else if (topicIds.length > 0) {
    if (!logDate || !isPastOrTodayIST(logDate) || isFutureIST(logDate)) {
      return { ok: false, status: 422, error: "Log date cannot be in the future" };
    }

    if (
      durationMinutes == null ||
      !Number.isInteger(durationMinutes) ||
      durationMinutes <= 0 ||
      durationMinutes > 720
    ) {
      return {
        ok: false,
        status: 422,
        error: "Duration must be greater than 0 and at most 720 minutes",
      };
    }

    const validTopics = await loadValidTopics({
      topicIds,
      examTrack: scope.examTrack,
      grade: scope.grade,
      subjectId: scope.subjectId,
      curriculumId,
    });
    if (validTopics.length !== topicIds.length) {
      return {
        ok: false,
        status: 422,
        error: "Topics do not belong to the selected Grade, Subject, and Exam Track",
      };
    }
  }

  const shouldInsertLog = isChapterBacked || topicIds.length > 0;
  const runMutation = () => withTransaction(async (client) => {
    const logId = shouldInsertLog
      ? await insertCurriculumLog(client, {
          schoolCode: params.schoolCode,
          programId: params.programId,
          gradeId: scope.gradeId,
          subjectId: scope.subjectId,
          examTrack: scope.examTrack,
          logType,
          logDate: logDate as string,
          durationMinutes: isClassCancelled ? null : (durationMinutes as number),
          chapterId: isChapterBacked ? chapterId : null,
          topicIds,
          actorEmail: params.actorEmail,
        })
      : null;

    const completions: ChapterCompletionState[] = [];
    for (const chapterId of scope.completeChapterIds) {
      completions.push(
        await markChapterComplete(client, {
          schoolCode: params.schoolCode,
          programId: params.programId,
          chapterId,
          examTrack: scope.examTrack,
          actorEmail: params.actorEmail,
        })
      );
    }
    for (const chapterId of scope.uncompleteChapterIds) {
      completions.push(
        await unmarkChapterComplete(client, {
          schoolCode: params.schoolCode,
          programId: params.programId,
          chapterId,
          examTrack: scope.examTrack,
          actorEmail: params.actorEmail,
        })
      );
    }

    return { logId, completions };
  });

  // The partial unique index is the last line of defence when two Class Cancelled
  // saves for the same Chapter and date race past the proactive check.
  let mutation: Awaited<ReturnType<typeof runMutation>>;
  try {
    mutation = await runMutation();
  } catch (error) {
    if (isClassCancelled && isUniqueViolation(error)) {
      return { ok: false, status: 422, error: DUPLICATE_CLASS_CANCELLED_ERROR };
    }
    throw error;
  }

  const log = mutation.logId ? await getCurriculumLogById(mutation.logId) : null;
  if (mutation.logId && !log) throw new Error("Created LMS Curriculum Log was not found");

  return {
    ok: true,
    log,
    completions: mutation.completions,
    createdLog: mutation.logId != null,
  };
}

async function updateClassCancelledLogFields(params: {
  id: number;
  log: LogMutationScopeRow;
  logDate: string | null;
  chapterId: number | null;
  hasTopics: boolean;
  hasDuration: boolean;
  actorEmail: string;
}): Promise<CurriculumEditResult> {
  const { log } = params;

  if (params.hasTopics) {
    return { ok: false, status: 422, error: "Class Cancelled logs cannot include topics" };
  }
  if (params.hasDuration) {
    return { ok: false, status: 422, error: "Class Cancelled logs cannot have a duration" };
  }
  if (params.chapterId == null) {
    return { ok: false, status: 422, error: "Class Cancelled logs require exactly one Chapter" };
  }
  const logDate = params.logDate;
  if (!logDate || !isPastOrTodayIST(logDate) || isFutureIST(logDate)) {
    return { ok: false, status: 422, error: "Log date cannot be in the future" };
  }

  const chapterInScope = await chapterIsInStoredScope({
    chapterId: params.chapterId,
    examTrack: log.exam_track,
    gradeId: log.grade_id,
    subjectId: log.subject_id,
  });
  if (!chapterInScope) {
    return {
      ok: false,
      status: 422,
      error: "Chapter does not belong to the LMS Curriculum Log scope",
    };
  }

  const duplicate = await activeClassCancelledLogExists({
    schoolCode: log.school_code,
    programId: log.program_id,
    gradeId: log.grade_id,
    subjectId: log.subject_id,
    examTrack: log.exam_track,
    chapterId: params.chapterId,
    logDate,
    excludeLogId: params.id,
  });
  if (duplicate) {
    return { ok: false, status: 422, error: DUPLICATE_CLASS_CANCELLED_ERROR };
  }

  let updated: boolean;
  try {
    updated = await withTransaction((client) =>
      updateChapterBackedLog(client, {
        logId: params.id,
        logDate,
        durationMinutes: null,
        chapterId: params.chapterId as number,
        actorEmail: params.actorEmail,
      })
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, status: 422, error: DUPLICATE_CLASS_CANCELLED_ERROR };
    }
    throw error;
  }
  if (!updated) {
    return { ok: false, status: 404, error: "LMS Curriculum Log not found" };
  }

  const updatedLog = await getCurriculumLogById(params.id);
  if (!updatedLog) throw new Error("Updated LMS Curriculum Log was not found");

  return { ok: true, log: updatedLog };
}

async function updateDoubtSolvingLogFields(params: {
  id: number;
  log: LogMutationScopeRow;
  logDate: string | null;
  durationMinutes: number | null;
  chapterId: number | null;
  hasTopics: boolean;
  actorEmail: string;
}): Promise<CurriculumEditResult> {
  if (params.hasTopics) {
    return { ok: false, status: 422, error: "Doubt Solving logs cannot include topics" };
  }
  if (params.chapterId == null) {
    return { ok: false, status: 422, error: "Doubt Solving logs require exactly one Chapter" };
  }
  if (!params.logDate || !isPastOrTodayIST(params.logDate) || isFutureIST(params.logDate)) {
    return { ok: false, status: 422, error: "Log date cannot be in the future" };
  }
  if (
    params.durationMinutes == null ||
    !Number.isInteger(params.durationMinutes) ||
    params.durationMinutes <= 0 ||
    params.durationMinutes > 720
  ) {
    return {
      ok: false,
      status: 422,
      error: "Duration must be greater than 0 and at most 720 minutes",
    };
  }

  const chapterInScope = await chapterIsInStoredScope({
    chapterId: params.chapterId,
    examTrack: params.log.exam_track,
    gradeId: params.log.grade_id,
    subjectId: params.log.subject_id,
  });
  if (!chapterInScope) {
    return {
      ok: false,
      status: 422,
      error: "Chapter does not belong to the LMS Curriculum Log scope",
    };
  }

  const updated = await withTransaction((client) =>
    updateChapterBackedLog(client, {
      logId: params.id,
      logDate: params.logDate as string,
      durationMinutes: params.durationMinutes,
      chapterId: params.chapterId as number,
      actorEmail: params.actorEmail,
    })
  );
  if (!updated) {
    return { ok: false, status: 404, error: "LMS Curriculum Log not found" };
  }

  const updatedLog = await getCurriculumLogById(params.id);
  if (!updatedLog) throw new Error("Updated LMS Curriculum Log was not found");
  return { ok: true, log: updatedLog };
}

export async function updateCurriculumLog(params: {
  id: number;
  patch: Record<string, unknown>;
  permission: UserPermission;
  actorEmail: string;
}): Promise<CurriculumEditResult> {
  const log = await loadLogMutationScope(params.id);
  if (!log) {
    return { ok: false, status: 404, error: "LMS Curriculum Log not found" };
  }

  const scope = await resolveCurriculumProgramScope(log.school_code, params.permission);
  if (!scope.ok) return scope;
  if (!scope.allowedProgramIds.includes(log.program_id)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const subject = (Object.keys(SUBJECT_IDS) as SubjectName[]).find(
    (name) => SUBJECT_IDS[name] === log.subject_id
  );
  const compatibilityError = subject
    ? getSubjectExamTrackCompatibilityError(subject, log.exam_track)
    : null;
  if (compatibilityError) {
    return { ok: false, status: 422, error: compatibilityError };
  }

  if (!log.is_editable) {
    return { ok: false, status: 422, error: "Historical LMS Curriculum Logs are not editable" };
  }

  const patch = params.patch;
  if (patch.log_type != null && patch.log_type !== log.log_type) {
    return {
      ok: false,
      status: 422,
      error:
        "LMS Curriculum Log type cannot be changed — delete the log and create it again",
    };
  }

  const logDate = typeof patch.log_date === "string" ? patch.log_date : null;
  const chapterId = normalizeChapterId(patch.chapter_id);

  if (log.log_type === "class_cancelled") {
    return updateClassCancelledLogFields({
      id: params.id,
      log,
      logDate,
      chapterId,
      hasTopics: normalizeTopicIds(patch.topic_ids).length > 0,
      hasDuration: patch.duration_minutes != null,
      actorEmail: params.actorEmail,
    });
  }

  if (log.log_type === "doubt_solving") {
    return updateDoubtSolvingLogFields({
      id: params.id,
      log,
      logDate,
      durationMinutes:
        typeof patch.duration_minutes === "number" ? patch.duration_minutes : null,
      chapterId,
      hasTopics: normalizeTopicIds(patch.topic_ids).length > 0,
      actorEmail: params.actorEmail,
    });
  }

  if (chapterId != null) {
    return {
      ok: false,
      status: 422,
      error: "Regular Class logs derive their Chapters from topics",
    };
  }

  const topicIds = normalizeTopicIds(patch.topic_ids);
  if (topicIds.length === 0) {
    return { ok: false, status: 422, error: "At least one topic is required" };
  }

  if (!logDate || !isPastOrTodayIST(logDate) || isFutureIST(logDate)) {
    return { ok: false, status: 422, error: "Log date cannot be in the future" };
  }

  const durationMinutes =
    typeof patch.duration_minutes === "number" ? patch.duration_minutes : null;
  if (
    durationMinutes == null ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes <= 0 ||
    durationMinutes > 720
  ) {
    return {
      ok: false,
      status: 422,
      error: "Duration must be greater than 0 and at most 720 minutes",
    };
  }

  const curriculumId = curriculumIdForExamTrack(log.exam_track);
  if (curriculumId === null) {
    return {
      ok: false,
      status: 422,
      error: `Curriculum configuration is not available for ${formatExamTrack(log.exam_track)}`,
    };
  }

  const validTopics = await loadValidTopicsForStoredScope({
    topicIds,
    examTrack: log.exam_track,
    gradeId: log.grade_id,
    subjectId: log.subject_id,
    curriculumId,
  });
  if (validTopics.length !== topicIds.length) {
    return {
      ok: false,
      status: 422,
      error: "Topics do not belong to the LMS Curriculum Log scope",
    };
  }

  const updated = await withTransaction((client) =>
    replaceCurriculumLogTopics(client, {
      logId: params.id,
      logDate,
      durationMinutes,
      topicIds,
      actorEmail: params.actorEmail,
    })
  );
  if (!updated) {
    return { ok: false, status: 404, error: "LMS Curriculum Log not found" };
  }

  const updatedLog = await getCurriculumLogById(params.id);
  if (!updatedLog) throw new Error("Updated LMS Curriculum Log was not found");

  return { ok: true, log: updatedLog };
}

export async function deleteCurriculumLog(params: {
  id: number;
  permission: UserPermission;
  actorEmail: string;
}): Promise<CurriculumDeleteResult> {
  const log = await loadLogMutationScope(params.id);
  if (!log) {
    return { ok: false, status: 404, error: "LMS Curriculum Log not found" };
  }

  const scope = await resolveCurriculumProgramScope(log.school_code, params.permission);
  if (!scope.ok) return scope;
  if (!scope.allowedProgramIds.includes(log.program_id)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE lms_curriculum_logs
       SET deleted_at = (NOW() AT TIME ZONE 'UTC'),
           updated_by_email = $2,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1
         AND deleted_at IS NULL`,
      [params.id, params.actorEmail]
    );
  });

  return { ok: true, deleted: true };
}
