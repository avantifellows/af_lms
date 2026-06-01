import { query } from "./db";
import { validateSelectedScope } from "./curriculum-logs";
import type { ChapterProgress } from "@/types/curriculum";
import type { UserPermission } from "./permissions";

interface SubjectTotalRow {
  subject_total_time_minutes: string | number | null;
}

interface ProgressRow {
  chapter_id: number;
  topic_id: number | null;
  log_id: number | null;
  log_date: string | Date | null;
  duration_minutes: number | null;
  total_topics_in_log: number | null;
}

interface CompletionRow {
  chapter_id: number;
  completed_at: string | Date;
}

type CurriculumProgressResult =
  | {
      ok: true;
      subjectTotalTimeMinutes: number;
      progress: Record<number, ChapterProgress>;
    }
  | { ok: false; status: 400 | 403 | 404 | 422; error: string };

function toDateString(value: string | Date | null): string | null {
  if (!value) return null;
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

export async function getCurriculumProgress(params: {
  schoolCode: string;
  programId: number;
  examTrack: string;
  grade: number;
  subject: string;
  permission: UserPermission;
}): Promise<CurriculumProgressResult> {
  const scope = await validateSelectedScope(params);
  if (!scope.ok) return scope;

  const totalRows = await query<SubjectTotalRow>(
    `SELECT COALESCE(SUM(duration_minutes), 0) AS subject_total_time_minutes
     FROM lms_curriculum_logs
     WHERE school_code = $1
       AND program_id = $2
       AND grade_id = $3
       AND subject_id = $4
       AND exam_track = $5
       AND deleted_at IS NULL`,
    [
      params.schoolCode,
      params.programId,
      scope.gradeId,
      scope.subjectId,
      scope.examTrack,
    ]
  );

  const rows = await query<ProgressRow>(
    `WITH scoped_log_topics AS (
       SELECT
         l.id AS log_id,
         l.log_date,
         l.duration_minutes,
         lt.topic_id,
         COUNT(*) OVER (PARTITION BY l.id) AS total_topics_in_log
       FROM lms_curriculum_logs l
       JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = l.id
       WHERE l.school_code = $1
         AND l.program_id = $2
         AND l.grade_id = $3
         AND l.subject_id = $4
         AND l.exam_track = $5
         AND l.deleted_at IS NULL
     )
     SELECT
       ch.id AS chapter_id,
       t.id AS topic_id,
       slt.log_id,
       slt.log_date,
       slt.duration_minutes,
       slt.total_topics_in_log
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     LEFT JOIN topic t ON t.chapter_id = ch.id
     LEFT JOIN scoped_log_topics slt ON slt.topic_id = t.id
     WHERE cfg.exam_track = $5
       AND cfg.is_in_syllabus = true
       AND g.number = $6
       AND ch.subject_id = $4
     ORDER BY cfg.coverage_sequence ASC, ch.code ASC, t.code ASC, slt.log_date ASC, slt.log_id ASC`,
    [
      params.schoolCode,
      params.programId,
      scope.gradeId,
      scope.subjectId,
      scope.examTrack,
      scope.grade,
    ]
  );

  const chapterIds = Array.from(new Set(rows.map((row) => row.chapter_id)));
  const completionRows = chapterIds.length
    ? await query<CompletionRow>(
        `SELECT chapter_id, completed_at
         FROM lms_curriculum_chapter_completions
         WHERE school_code = $1
           AND program_id = $2
           AND exam_track = $3
           AND chapter_id = ANY($4::int[])
           AND deleted_at IS NULL`,
        [params.schoolCode, params.programId, scope.examTrack, chapterIds]
      )
    : [];

  const completedAtByChapter = new Map(
    completionRows.map((row) => [row.chapter_id, toTimestampString(row.completed_at)])
  );
  const topicIdsByChapter = new Map<number, Set<number>>();
  const coveredTopicIdsByChapter = new Map<number, Set<number>>();
  const lastTaughtByChapter = new Map<number, string>();
  const logChapterAllocations = new Map<
    string,
    {
      chapterId: number;
      durationMinutes: number;
      totalTopicsInLog: number;
      topicIds: Set<number>;
    }
  >();

  for (const row of rows) {
    if (!topicIdsByChapter.has(row.chapter_id)) {
      topicIdsByChapter.set(row.chapter_id, new Set());
    }
    if (row.topic_id != null) {
      topicIdsByChapter.get(row.chapter_id)?.add(row.topic_id);
    }

    if (
      row.topic_id == null ||
      row.log_id == null ||
      row.duration_minutes == null ||
      row.total_topics_in_log == null
    ) {
      continue;
    }

    if (!coveredTopicIdsByChapter.has(row.chapter_id)) {
      coveredTopicIdsByChapter.set(row.chapter_id, new Set());
    }
    coveredTopicIdsByChapter.get(row.chapter_id)?.add(row.topic_id);

    const taughtDate = toDateString(row.log_date);
    const previousDate = lastTaughtByChapter.get(row.chapter_id);
    if (taughtDate && (!previousDate || taughtDate > previousDate)) {
      lastTaughtByChapter.set(row.chapter_id, taughtDate);
    }

    const allocationKey = `${row.log_id}:${row.chapter_id}`;
    if (!logChapterAllocations.has(allocationKey)) {
      logChapterAllocations.set(allocationKey, {
        chapterId: row.chapter_id,
        durationMinutes: row.duration_minutes,
        totalTopicsInLog: row.total_topics_in_log,
        topicIds: new Set(),
      });
    }
    logChapterAllocations.get(allocationKey)?.topicIds.add(row.topic_id);
  }

  const timeByChapter = new Map<number, number>();
  for (const allocation of logChapterAllocations.values()) {
    const allocated = Math.round(
      allocation.durationMinutes *
        (allocation.topicIds.size / allocation.totalTopicsInLog)
    );
    timeByChapter.set(
      allocation.chapterId,
      (timeByChapter.get(allocation.chapterId) ?? 0) + allocated
    );
  }

  const progress: Record<number, ChapterProgress> = {};
  for (const chapterId of chapterIds) {
    const topicIds = topicIdsByChapter.get(chapterId) ?? new Set();
    const coveredTopicIds = Array.from(coveredTopicIdsByChapter.get(chapterId) ?? []);
    const chapterCompletedDate = completedAtByChapter.get(chapterId) ?? null;
    progress[chapterId] = {
      chapterId,
      completedTopicIds: coveredTopicIds,
      totalTimeMinutes: timeByChapter.get(chapterId) ?? 0,
      lastTaughtDate: lastTaughtByChapter.get(chapterId) ?? null,
      allTopicsCovered: topicIds.size > 0 && coveredTopicIds.length >= topicIds.size,
      isChapterComplete: chapterCompletedDate != null,
      chapterCompletedDate,
    };
  }

  return {
    ok: true,
    subjectTotalTimeMinutes: Number(totalRows[0]?.subject_total_time_minutes ?? 0),
    progress,
  };
}
