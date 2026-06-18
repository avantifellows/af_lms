import { compareCurriculumCodes } from "./curriculum-code-sort";
import { query } from "./db";

export const CLASSROOM_OBSERVATION_CURRICULUM_IDS = [1, 2, 9] as const;

export interface ClassroomObservationCurriculumOption {
  id: number;
  name: string;
  code: string | null;
}

export interface ClassroomObservationChapterOption {
  id: number;
  code: string | null;
  name: string;
  grade: number;
  subjectId: number;
  subjectName: string;
  curriculumId: number;
  topicCount: number;
}

export interface ClassroomObservationTopicOption {
  id: number;
  code: string | null;
  name: string;
  chapterId: number;
  curriculumId: number;
}

export interface ClassroomObservationCurriculumOptions {
  curricula: ClassroomObservationCurriculumOption[];
  chapters: ClassroomObservationChapterOption[];
  topics: ClassroomObservationTopicOption[];
}

interface CurriculumRow {
  id: number | string;
  name: string | null;
  code: string | null;
}

interface ChapterRow {
  chapter_id: number | string;
  chapter_code: string | null;
  chapter_name: unknown;
  grade: number | string;
  subject_id: number | string;
  subject_name: unknown;
  curriculum_id: number | string;
  topic_count: number | string | null;
}

interface TopicRow {
  topic_id: number | string;
  topic_code: string | null;
  topic_name: unknown;
  chapter_id: number | string;
  curriculum_id: number | string;
}

function extractEnglishName(value: unknown, field: string, fallback: string): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return extractEnglishName(parsed, field, fallback);
    } catch {
      return value.trim() || fallback;
    }
  }

  if (!Array.isArray(value)) {
    return fallback;
  }

  const english = value.find(
    (item): item is Record<string, unknown> =>
      item !== null &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      item.lang_code === "en"
  );
  const label = english?.[field];
  return typeof label === "string" && label.trim() ? label.trim() : fallback;
}

function normalizeSubjectName(value: unknown): string {
  const subject = extractEnglishName(value, "subject", "Unknown subject");
  return subject === "Mathematics" ? "Maths" : subject;
}

function numberFromDb(value: number | string | null): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapCurriculum(row: CurriculumRow): ClassroomObservationCurriculumOption {
  return {
    id: numberFromDb(row.id),
    name: row.name?.trim() || "Unknown curriculum",
    code: row.code?.trim() || null,
  };
}

function mapChapter(row: ChapterRow): ClassroomObservationChapterOption {
  const code = row.chapter_code?.trim() || null;
  return {
    id: numberFromDb(row.chapter_id),
    code,
    name: extractEnglishName(row.chapter_name, "chapter", code ?? "Unknown chapter"),
    grade: numberFromDb(row.grade),
    subjectId: numberFromDb(row.subject_id),
    subjectName: normalizeSubjectName(row.subject_name),
    curriculumId: numberFromDb(row.curriculum_id),
    topicCount: numberFromDb(row.topic_count),
  };
}

function mapTopic(row: TopicRow): ClassroomObservationTopicOption {
  const code = row.topic_code?.trim() || null;
  return {
    id: numberFromDb(row.topic_id),
    code,
    name: extractEnglishName(row.topic_name, "topic", code ?? "Unknown topic"),
    chapterId: numberFromDb(row.chapter_id),
    curriculumId: numberFromDb(row.curriculum_id),
  };
}

export function isClassroomObservationGrade(value: number): boolean {
  return value === 10 || value === 11 || value === 12;
}

export async function getClassroomObservationCurriculumOptions(params: {
  grade: number;
}): Promise<ClassroomObservationCurriculumOptions> {
  const curricula = await query<CurriculumRow>(
    `SELECT id, name, code
     FROM curriculum
     WHERE id = ANY($1::int[])
     ORDER BY CASE id
       WHEN 1 THEN 1
       WHEN 2 THEN 2
       WHEN 9 THEN 3
       ELSE 99
     END`,
    [CLASSROOM_OBSERVATION_CURRICULUM_IDS]
  );

  if (!isClassroomObservationGrade(params.grade)) {
    return {
      curricula: curricula.map(mapCurriculum),
      chapters: [],
      topics: [],
    };
  }

  const chapters = await query<ChapterRow>(
    `SELECT
       ch.id AS chapter_id,
       ch.code AS chapter_code,
       ch.name AS chapter_name,
       g.number AS grade,
       s.id AS subject_id,
       s.name AS subject_name,
       cc.curriculum_id,
       COUNT(DISTINCT tc.topic_id)::int AS topic_count
     FROM chapter_curriculum cc
     JOIN chapter ch ON ch.id = cc.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     JOIN subject s ON s.id = ch.subject_id
     LEFT JOIN topic t
       ON t.chapter_id = ch.id
      AND t.cms_status_id IS NULL
     LEFT JOIN topic_curriculum tc
       ON tc.topic_id = t.id
      AND tc.curriculum_id = cc.curriculum_id
     WHERE cc.curriculum_id = ANY($1::int[])
       AND g.number = $2
       AND ch.cms_status_id IS NULL
     GROUP BY ch.id, ch.code, ch.name, g.number, s.id, s.name, cc.curriculum_id
     ORDER BY cc.curriculum_id ASC, s.id ASC, ch.code ASC`,
    [CLASSROOM_OBSERVATION_CURRICULUM_IDS, params.grade]
  );

  const topics = await query<TopicRow>(
    `SELECT DISTINCT
       t.id AS topic_id,
       t.code AS topic_code,
       t.name AS topic_name,
       t.chapter_id,
       tc.curriculum_id
     FROM topic_curriculum tc
     JOIN topic t
       ON t.id = tc.topic_id
      AND t.cms_status_id IS NULL
     JOIN chapter ch
       ON ch.id = t.chapter_id
      AND ch.cms_status_id IS NULL
     JOIN grade g ON g.id = ch.grade_id
     WHERE tc.curriculum_id = ANY($1::int[])
       AND g.number = $2
     ORDER BY tc.curriculum_id ASC, t.chapter_id ASC, t.code ASC, t.id ASC`,
    [CLASSROOM_OBSERVATION_CURRICULUM_IDS, params.grade]
  );

  const mappedChapters = chapters.map(mapChapter).sort((a, b) => {
    if (a.curriculumId !== b.curriculumId) return a.curriculumId - b.curriculumId;
    if (a.subjectId !== b.subjectId) return a.subjectId - b.subjectId;
    return compareCurriculumCodes(a.code, b.code);
  });

  const mappedTopics = topics.map(mapTopic).sort((a, b) => {
    if (a.curriculumId !== b.curriculumId) return a.curriculumId - b.curriculumId;
    if (a.chapterId !== b.chapterId) return a.chapterId - b.chapterId;
    return compareCurriculumCodes(a.code, b.code);
  });

  return {
    curricula: curricula.map(mapCurriculum),
    chapters: mappedChapters,
    topics: mappedTopics,
  };
}
