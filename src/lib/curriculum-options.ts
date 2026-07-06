import { compareCurriculumCodes } from "./curriculum-code-sort";
import { query } from "./db";
import {
  PROGRAM_IDS,
  canAccessSchoolSync,
  getProgramContextSync,
  type UserPermission,
} from "./permissions";
import type {
  Chapter,
  CurriculumOptionsResponse,
  CurriculumProgramOption,
  ExamTrack,
  GradeNumber,
  SubjectName,
  Topic,
} from "@/types/curriculum";

export const EXAM_TRACKS: ExamTrack[] = ["jee_main", "jee_advanced", "neet"];
const CURRICULUM_PROGRAM_IDS: number[] = [PROGRAM_IDS.COE, PROGRAM_IDS.NODAL];
const SUBJECT_ORDER: SubjectName[] = ["Physics", "Chemistry", "Maths", "Biology"];
const EXAM_TRACK_CURRICULUM_IDS: Record<ExamTrack, number> = {
  jee_main: 1,
  jee_advanced: 9,
  neet: 2,
};
interface SchoolScopeRow {
  code: string;
  region: string | null;
}

interface PreferredSeatProgramRow {
  program_id: number | string | null;
}

interface ConfigScopeRow {
  exam_track: ExamTrack;
  grade_id: number;
  grade: number;
  subject_id: number;
  subject: unknown;
}

interface ChapterScopeRow {
  chapter_id: number;
  chapter_code: string;
  chapter_name: unknown;
  grade_id: number;
  grade: number;
  subject_id: number;
  subject_name: unknown;
  exam_track: ExamTrack;
  prescribed_minutes: number;
  coverage_sequence: number;
  topic_id: number | null;
  topic_code: string | null;
  topic_name: unknown;
}

type ScopeFailureStatus = 403 | 404;

interface ScopeFailure {
  ok: false;
  status: ScopeFailureStatus;
  error: string;
}

interface ScopeSuccess {
  ok: true;
  school: SchoolScopeRow;
  programs: CurriculumProgramOption[];
  allowedProgramIds: number[];
  preferredProgramId: number | null;
}

type ProgramScopeResult = ScopeSuccess | ScopeFailure;

export interface CurriculumValidationFailure {
  ok: false;
  status: 400 | 403 | 422;
  error: string;
}

export type CurriculumOptionsResult =
  | ({ ok: true } & CurriculumOptionsResponse)
  | ScopeFailure;

export type CurriculumChaptersResult =
  | { ok: true; chapters: Chapter[] }
  | ScopeFailure
  | CurriculumValidationFailure;

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

function normalizeSubjectName(value: unknown): SubjectName {
  const subject = extractEnglishName(value, "subject");
  return subject === "Mathematics" ? "Maths" : (subject as SubjectName);
}

export function isExamTrack(value: string): value is ExamTrack {
  return EXAM_TRACKS.includes(value as ExamTrack);
}

export function isGradeNumber(value: number): value is GradeNumber {
  return value === 11 || value === 12;
}

export function isSubjectName(value: string): value is SubjectName {
  return SUBJECT_ORDER.includes(value as SubjectName);
}

export function curriculumIdForExamTrack(examTrack: ExamTrack): number {
  return EXAM_TRACK_CURRICULUM_IDS[examTrack];
}

function sortByCurriculumOrder<T extends { examTrack: ExamTrack; grade: number; subject: SubjectName }>(
  rows: T[]
): T[] {
  return [...rows].sort((a, b) => {
    const examDiff = EXAM_TRACKS.indexOf(a.examTrack) - EXAM_TRACKS.indexOf(b.examTrack);
    if (examDiff !== 0) return examDiff;
    if (a.grade !== b.grade) return a.grade - b.grade;
    return SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject);
  });
}

export async function resolveCurriculumProgramScope(
  schoolCode: string,
  permission: UserPermission
): Promise<ProgramScopeResult> {
  const schools = await query<SchoolScopeRow>(
    `SELECT code, region
     FROM school
     WHERE code = $1
     LIMIT 1`,
    [schoolCode]
  );

  const school = schools[0];
  if (!school) {
    return { ok: false, status: 404, error: "School not found" };
  }

  if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }

  const callerProgramIds =
    permission.role === "admin"
      ? CURRICULUM_PROGRAM_IDS
      : getProgramContextSync(permission).programIds;
  const allowedProgramIds = CURRICULUM_PROGRAM_IDS.filter((id) =>
    callerProgramIds.includes(id)
  );

  const programs = allowedProgramIds.length
    ? (await query<CurriculumProgramOption>(
        `SELECT id, name
         FROM program
         WHERE id = ANY($1::int[])
         ORDER BY array_position(ARRAY[1, 2]::int[], id)`,
        [allowedProgramIds]
      )).map((program) => ({ ...program, id: Number(program.id) }))
    : [];
  const seatCentreIds = permission.scope?.centres;
  const preferredProgramRows =
    allowedProgramIds.length > 0 && seatCentreIds instanceof Set && seatCentreIds.size > 0
      ? await query<PreferredSeatProgramRow>(
          `SELECT c.program_id
           FROM centres c
           JOIN school s ON s.id = c.school_id
           WHERE c.id = ANY($1::int[])
             AND s.code = $2
             AND c.program_id = ANY($3::int[])
           ORDER BY array_position($3::int[], c.program_id), c.id
           LIMIT 1`,
          [[...seatCentreIds], schoolCode, allowedProgramIds]
        )
      : [];
  const preferredProgramId =
    preferredProgramRows[0]?.program_id == null
      ? null
      : Number(preferredProgramRows[0].program_id);

  return {
    ok: true,
    school,
    programs,
    allowedProgramIds: programs.map((program) => program.id),
    preferredProgramId,
  };
}

export async function getCurriculumOptions(params: {
  schoolCode: string;
  programIdOverride?: number | null;
  permission: UserPermission;
}): Promise<CurriculumOptionsResult> {
  const scope = await resolveCurriculumProgramScope(params.schoolCode, params.permission);
  if (!scope.ok) return scope;

  if (scope.programs.length === 0) {
    return {
      ok: true,
      programs: [],
      examTracks: [],
      gradeSubjects: [],
      defaults: {
        programId: null,
        examTrack: null,
        grade: null,
        gradeId: null,
        subject: null,
        subjectId: null,
      },
    };
  }

  const configRows = await query<ConfigScopeRow>(
    `SELECT DISTINCT
       cfg.exam_track,
       g.id AS grade_id,
       g.number AS grade,
       s.id AS subject_id,
       s.name AS subject
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     JOIN subject s ON s.id = ch.subject_id
     WHERE cfg.is_in_syllabus = true`,
  );

  const gradeSubjects = sortByCurriculumOrder(
    configRows
      .map((row) => ({
        examTrack: row.exam_track,
        grade: row.grade as GradeNumber,
        gradeId: Number(row.grade_id),
        subject: normalizeSubjectName(row.subject),
        subjectId: Number(row.subject_id),
      }))
      .filter(
        (row) =>
          isExamTrack(row.examTrack) &&
          isGradeNumber(row.grade) &&
          isSubjectName(row.subject)
      )
  );

  const configuredTracks = new Set(gradeSubjects.map((row) => row.examTrack));
  const examTracks = EXAM_TRACKS.filter((track) => configuredTracks.has(track));
  const firstGradeSubject = gradeSubjects[0] ?? null;
  const overrideProgramId =
    params.programIdOverride != null &&
    scope.allowedProgramIds.includes(params.programIdOverride)
      ? params.programIdOverride
      : null;

  return {
    ok: true,
    programs: scope.programs,
    examTracks,
    gradeSubjects,
    defaults: {
      programId: overrideProgramId ?? scope.preferredProgramId ?? scope.programs[0]?.id ?? null,
      examTrack: examTracks[0] ?? null,
      grade: firstGradeSubject?.grade ?? null,
      gradeId: firstGradeSubject?.gradeId ?? null,
      subject: firstGradeSubject?.subject ?? null,
      subjectId: firstGradeSubject?.subjectId ?? null,
    },
  };
}

export async function getCurriculumChapters(params: {
  schoolCode: string;
  programId: number;
  examTrack: string;
  grade: number;
  subject: string;
  permission: UserPermission;
}): Promise<CurriculumChaptersResult> {
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

  const rows = await query<ChapterScopeRow>(
    `SELECT
       ch.id AS chapter_id,
       ch.code AS chapter_code,
       ch.name AS chapter_name,
       g.id AS grade_id,
       g.number AS grade,
       s.id AS subject_id,
       s.name AS subject_name,
       cfg.exam_track,
       cfg.prescribed_minutes,
       cfg.coverage_sequence,
       t.id AS topic_id,
       t.code AS topic_code,
       t.name AS topic_name
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN grade g ON g.id = ch.grade_id
     JOIN subject s ON s.id = ch.subject_id
     LEFT JOIN (
       topic t
       JOIN topic_curriculum tc
         ON tc.topic_id = t.id
        AND tc.curriculum_id = $4
     ) ON t.chapter_id = ch.id
     WHERE cfg.exam_track = $1
       AND cfg.is_in_syllabus = true
       AND g.number = $2
       AND s.id = $3
     ORDER BY cfg.coverage_sequence ASC, ch.code ASC, t.code ASC`,
    [
      params.examTrack,
      params.grade,
      ({ Maths: 1, Chemistry: 2, Biology: 3, Physics: 4 } as Record<SubjectName, number>)[
        params.subject
      ],
      curriculumId,
    ]
  );

  const chaptersById = new Map<number, Chapter>();
  for (const row of rows) {
    let chapter = chaptersById.get(row.chapter_id);
    if (!chapter) {
      chapter = {
        id: row.chapter_id,
        code: row.chapter_code,
        name: extractEnglishName(row.chapter_name, "chapter"),
        grade: row.grade,
        subjectId: row.subject_id,
        subjectName: normalizeSubjectName(row.subject_name),
        examTrack: row.exam_track,
        prescribedMinutes: row.prescribed_minutes,
        coverageSequence: row.coverage_sequence,
        topics: [],
      };
      chaptersById.set(row.chapter_id, chapter);
    }

    if (row.topic_id != null && row.topic_code != null) {
      const topic: Topic = {
        id: row.topic_id,
        code: row.topic_code,
        name: extractEnglishName(row.topic_name, "topic"),
        chapterId: row.chapter_id,
      };
      chapter.topics.push(topic);
    }
  }

  const chapters = [...chaptersById.values()].sort((a, b) => {
    const sequenceDiff = (a.coverageSequence ?? 0) - (b.coverageSequence ?? 0);
    if (sequenceDiff !== 0) return sequenceDiff;
    return compareCurriculumCodes(a.code, b.code);
  });
  for (const chapter of chapters) {
    chapter.topics.sort((a, b) => compareCurriculumCodes(a.code, b.code));
  }

  return { ok: true, chapters };
}
