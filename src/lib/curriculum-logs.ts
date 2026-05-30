import type { PoolClient } from "pg";
import { query, withTransaction } from "./db";
import {
  isExamTrack,
  isGradeNumber,
  isSubjectName,
  resolveCurriculumProgramScope,
  type CurriculumValidationFailure,
} from "./curriculum-options";
import { isFutureIST, isPastOrTodayIST } from "./curriculum-date-helpers";
import {
  markChapterComplete,
  unmarkChapterComplete,
  validateChapterCompletionDeltas,
  type ChapterCompletionState,
} from "./curriculum-chapter-completion";
import type {
  ExamTrack,
  GradeNumber,
  LmsCurriculumLog,
  LmsCurriculumLogTopic,
  SubjectName,
} from "@/types/curriculum";
import { GRADE_IDS, SUBJECT_IDS } from "@/types/curriculum";
import type { UserPermission } from "./permissions";

interface LogTopicRow {
  id: number;
  log_date: string | Date;
  duration_minutes: number;
  program_id: number;
  grade_id: number;
  subject_id: number;
  exam_track: ExamTrack;
  inserted_at: string | Date;
  updated_at: string | Date;
  topic_id: number;
  topic_name: unknown;
  chapter_id: number;
  chapter_name: unknown;
  topic_currently_in_syllabus: boolean;
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
  if (value instanceof Date) return value.toISOString().slice(0, 10);
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
    let log = logsById.get(row.id);
    if (!log) {
      log = {
        id: Number(row.id),
        logDate: toDateString(row.log_date),
        durationMinutes: row.duration_minutes,
        programId: Number(row.program_id),
        gradeId: Number(row.grade_id),
        subjectId: Number(row.subject_id),
        examTrack: row.exam_track,
        topics: [],
        isEditable: true,
        createdAt: toTimestampString(row.inserted_at),
        updatedAt: toTimestampString(row.updated_at),
        _editable: true,
      };
      logsById.set(Number(row.id), log);
    }

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

  return {
    ok: true,
    examTrack: params.examTrack,
    grade: params.grade,
    subject: params.subject,
    gradeId: GRADE_IDS[params.grade],
    subjectId: SUBJECT_IDS[params.subject],
  };
}

async function loadValidTopics(params: {
  topicIds: number[];
  examTrack: ExamTrack;
  grade: GradeNumber;
  subjectId: number;
}): Promise<ValidTopicRow[]> {
  return query<ValidTopicRow>(
    `SELECT
       t.id AS topic_id,
       t.name AS topic_name,
       ch.id AS chapter_id,
       ch.name AS chapter_name
     FROM topic t
     JOIN chapter ch ON ch.id = t.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     JOIN lms_chapter_exam_configs cfg
       ON cfg.chapter_id = ch.id
      AND cfg.exam_track = $1
      AND cfg.is_in_syllabus = true
     WHERE t.id = ANY($2::int[])
       AND g.number = $3
       AND ch.subject_id = $4`,
    [params.examTrack, params.topicIds, params.grade, params.subjectId]
  );
}

async function loadValidTopicsForStoredScope(params: {
  topicIds: number[];
  examTrack: ExamTrack;
  gradeId: number;
  subjectId: number;
}): Promise<ValidTopicRow[]> {
  return query<ValidTopicRow>(
    `SELECT
       t.id AS topic_id,
       t.name AS topic_name,
       ch.id AS chapter_id,
       ch.name AS chapter_name
     FROM topic t
     JOIN chapter ch ON ch.id = t.chapter_id
     JOIN lms_chapter_exam_configs cfg
       ON cfg.chapter_id = ch.id
      AND cfg.exam_track = $1
      AND cfg.is_in_syllabus = true
     WHERE t.id = ANY($2::int[])
       AND ch.grade_id = $3
       AND ch.subject_id = $4`,
    [params.examTrack, params.topicIds, params.gradeId, params.subjectId]
  );
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
       COALESCE(
         bool_and(
           EXISTS (
             SELECT 1
             FROM lms_chapter_exam_configs current_cfg
             JOIN topic current_topic ON current_topic.chapter_id = current_cfg.chapter_id
             WHERE current_topic.id = lt.topic_id
               AND current_cfg.exam_track = l.exam_track
               AND current_cfg.is_in_syllabus = true
           )
         ),
         false
       ) AS is_editable
     FROM lms_curriculum_logs l
     JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = l.id
     WHERE l.id = $1
       AND l.deleted_at IS NULL
     GROUP BY l.id, l.school_code, l.program_id, l.grade_id, l.subject_id, l.exam_track`,
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
    logDate: string;
    durationMinutes: number;
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
       log_date,
       duration_minutes,
       created_by_email,
       updated_by_email
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     RETURNING id, log_date, duration_minutes, program_id, grade_id, subject_id, exam_track, inserted_at, updated_at`,
    [
      params.schoolCode,
      params.programId,
      params.gradeId,
      params.subjectId,
      params.examTrack,
      params.logDate,
      params.durationMinutes,
      params.actorEmail,
    ]
  );

  const logId = Number(inserted.rows[0]?.id);
  if (!logId) throw new Error("Failed to create LMS Curriculum Log");

  await client.query(
    `INSERT INTO lms_curriculum_log_topics (curriculum_log_id, topic_id)
     SELECT $1::int, unnest($2::int[])`,
    [logId, params.topicIds]
  );

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
): Promise<void> {
  await client.query(
    `UPDATE lms_curriculum_logs
     SET log_date = $2,
         duration_minutes = $3,
         updated_by_email = $4,
         updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1
       AND deleted_at IS NULL`,
    [params.logId, params.logDate, params.durationMinutes, params.actorEmail]
  );

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
       l.log_date,
       l.duration_minutes,
       l.program_id,
       l.grade_id,
       l.subject_id,
       l.exam_track,
       l.inserted_at,
       l.updated_at,
       lt.topic_id,
       t.name AS topic_name,
       ch.id AS chapter_id,
       ch.name AS chapter_name,
       EXISTS (
         SELECT 1
         FROM lms_chapter_exam_configs current_cfg
         WHERE current_cfg.chapter_id = ch.id
           AND current_cfg.exam_track = l.exam_track
           AND current_cfg.is_in_syllabus = true
       ) AS topic_currently_in_syllabus
     FROM lms_curriculum_logs l
     JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = l.id
     JOIN topic t ON t.id = lt.topic_id
     JOIN chapter ch ON ch.id = t.chapter_id
     WHERE l.school_code = $1
       AND l.program_id = $2
       AND l.grade_id = $3
       AND l.subject_id = $4
       AND l.exam_track = $5
       AND l.deleted_at IS NULL
     ORDER BY l.log_date DESC, l.inserted_at DESC, lt.id ASC`,
    [
      params.schoolCode,
      params.programId,
      scope.gradeId,
      scope.subjectId,
      scope.examTrack,
    ]
  );

  return { ok: true, logs: logsFromRows(rows) };
}

export async function getCurriculumLogById(id: number): Promise<LmsCurriculumLog | null> {
  const rows = await query<LogTopicRow>(
    `SELECT
       l.id,
       l.log_date,
       l.duration_minutes,
       l.program_id,
       l.grade_id,
       l.subject_id,
       l.exam_track,
       l.inserted_at,
       l.updated_at,
       lt.topic_id,
       t.name AS topic_name,
       ch.id AS chapter_id,
       ch.name AS chapter_name,
       EXISTS (
         SELECT 1
         FROM lms_chapter_exam_configs current_cfg
         WHERE current_cfg.chapter_id = ch.id
           AND current_cfg.exam_track = l.exam_track
           AND current_cfg.is_in_syllabus = true
       ) AS topic_currently_in_syllabus
     FROM lms_curriculum_logs l
     JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = l.id
     JOIN topic t ON t.id = lt.topic_id
     JOIN chapter ch ON ch.id = t.chapter_id
     WHERE l.id = $1
       AND l.deleted_at IS NULL
     ORDER BY lt.id ASC`,
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
  logDate: string | null;
  durationMinutes: number | null;
  topicIds: unknown;
  completeChapterIds?: unknown;
  uncompleteChapterIds?: unknown;
  permission: UserPermission;
  actorEmail: string;
}): Promise<CurriculumMutationResult> {
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

  const hasCompletionDeltas =
    scope.completeChapterIds.length > 0 ||
    scope.uncompleteChapterIds.length > 0;
  if (topicIds.length === 0 && !hasCompletionDeltas) {
    return { ok: false, status: 422, error: "Nothing to save" };
  }

  const logDate = params.logDate;
  const durationMinutes = params.durationMinutes;

  if (topicIds.length > 0) {
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
    });
    if (validTopics.length !== topicIds.length) {
      return {
        ok: false,
        status: 422,
        error: "Topics do not belong to the selected Grade, Subject, and Exam Track",
      };
    }
  }

  const mutation = await withTransaction(async (client) => {
    const logId = topicIds.length
      ? await insertCurriculumLog(client, {
          schoolCode: params.schoolCode,
          programId: params.programId,
          gradeId: scope.gradeId,
          subjectId: scope.subjectId,
          examTrack: scope.examTrack,
          logDate: logDate as string,
          durationMinutes: durationMinutes as number,
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

  const log = mutation.logId ? await getCurriculumLogById(mutation.logId) : null;
  if (mutation.logId && !log) throw new Error("Created LMS Curriculum Log was not found");

  return {
    ok: true,
    log,
    completions: mutation.completions,
    createdLog: mutation.logId != null,
  };
}

export async function updateCurriculumLog(params: {
  id: number;
  logDate: string | null;
  durationMinutes: number | null;
  topicIds: unknown;
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

  if (!log.is_editable) {
    return { ok: false, status: 422, error: "Historical LMS Curriculum Logs are not editable" };
  }

  const topicIds = normalizeTopicIds(params.topicIds);
  if (topicIds.length === 0) {
    return { ok: false, status: 422, error: "At least one topic is required" };
  }

  const logDate = params.logDate;
  if (!logDate || !isPastOrTodayIST(logDate) || isFutureIST(logDate)) {
    return { ok: false, status: 422, error: "Log date cannot be in the future" };
  }

  const durationMinutes = params.durationMinutes;
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

  const validTopics = await loadValidTopicsForStoredScope({
    topicIds,
    examTrack: log.exam_track,
    gradeId: log.grade_id,
    subjectId: log.subject_id,
  });
  if (validTopics.length !== topicIds.length) {
    return {
      ok: false,
      status: 422,
      error: "Topics do not belong to the LMS Curriculum Log scope",
    };
  }

  await withTransaction((client) =>
    replaceCurriculumLogTopics(client, {
      logId: params.id,
      logDate,
      durationMinutes,
      topicIds,
      actorEmail: params.actorEmail,
    })
  );

  const updatedLog = await getCurriculumLogById(params.id);
  if (!updatedLog) throw new Error("Updated LMS Curriculum Log was not found");

  return { ok: true, log: updatedLog };
}
