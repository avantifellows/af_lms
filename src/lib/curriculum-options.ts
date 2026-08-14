import { compareCurriculumCodes } from "./curriculum-code-sort";
import { EXAM_TRACKS, formatExamTrack, isExamTrack } from "./exam-tracks";
import { query } from "./db";
import { resolveActivePhysicalCentre } from "./centre-resolver";
import { GRADE_IDS } from "@/types/curriculum";
import {
  PHYSICAL_CENTRE_PROGRAM_IDS,
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

// Curriculum applies to every physical-centre program (all non-NVS programs),
// not just JNV CoE/Nodal — otherwise a Punjab/EMRS/RGNV teacher's programs
// intersect to empty and their curriculum tab loads blank.
const CURRICULUM_PROGRAM_IDS: number[] = PHYSICAL_CENTRE_PROGRAM_IDS;
const SUBJECT_ORDER: SubjectName[] = ["Physics", "Chemistry", "Maths", "Biology"];
const EXAM_TRACK_CURRICULUM_IDS = {
  jee_main: 1,
  jee_advanced: 9,
  neet: 2,
} as const satisfies Partial<Record<ExamTrack, number>>;
type ContentExamTrack = keyof typeof EXAM_TRACK_CURRICULUM_IDS;
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

interface CentreExamTrackRow {
  exam_track: ExamTrack;
  grade: number;
}

type HistoricalLogScopeRow = ConfigScopeRow;

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

function isGradeNumber(value: number): value is GradeNumber {
  return value === 11 || value === 12;
}

function isSubjectName(value: string): value is SubjectName {
  return SUBJECT_ORDER.includes(value as SubjectName);
}

export function validateCurriculumSelection(params: {
  examTrack: string;
  grade: number;
  subject: string;
}):
  | { ok: true; examTrack: ExamTrack; grade: GradeNumber; subject: SubjectName }
  | CurriculumValidationFailure {
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
  return {
    ok: true,
    examTrack: params.examTrack,
    grade: params.grade,
    subject: params.subject,
  };
}

export function curriculumIdForExamTrack(examTrack: ContentExamTrack): number;
export function curriculumIdForExamTrack(examTrack: ExamTrack): number | null;
export function curriculumIdForExamTrack(examTrack: ExamTrack): number | null {
  return examTrack in EXAM_TRACK_CURRICULUM_IDS
    ? EXAM_TRACK_CURRICULUM_IDS[examTrack as ContentExamTrack]
    : null;
}

// CMS grade id from the grade table (grade number -> id). Both CMS routes resolve it via
// the DB rather than a client-supplied map (which could drift), so the lookup lives here
// once. Returns null when no grade row matches.
export async function resolveGradeId(gradeNumber: number): Promise<number | null> {
  const rows = await query<{ id: number }>(
    `SELECT id FROM grade WHERE number = $1 LIMIT 1`,
    [gradeNumber]
  );
  return rows[0]?.id ?? null;
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

function mapGradeSubjectRows(rows: ConfigScopeRow[]) {
  return sortByCurriculumOrder(
    rows
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
}

// fallow-ignore-next-line complexity
async function resolveCurriculumProgramScope(
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
        `SELECT p.id, p.name
         FROM program p
         WHERE p.id = ANY($1::int[])
           AND EXISTS (
             SELECT 1
             FROM centres c
             JOIN school s ON s.id = c.school_id
             WHERE c.program_id = p.id
               AND s.code = $2
               AND c.is_active IS TRUE
               AND c.is_physical IS TRUE
           )
         ORDER BY array_position(ARRAY[1, 2]::int[], p.id)`,
        [allowedProgramIds, schoolCode]
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

export async function requireCurriculumProgramAccess(params: {
  schoolCode: string;
  programId: number;
  permission: UserPermission;
}): Promise<{ ok: true } | ScopeFailure> {
  const scope = await resolveCurriculumProgramScope(params.schoolCode, params.permission);
  if (!scope.ok) return scope;
  return scope.allowedProgramIds.includes(params.programId)
    ? { ok: true }
    : { ok: false, status: 403, error: "Forbidden" };
}

// fallow-ignore-next-line complexity
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
      centreExamTracks: [],
      gradeSubjects: [],
      configurationError: null,
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

  const overrideProgramId =
    params.programIdOverride != null &&
    scope.allowedProgramIds.includes(params.programIdOverride)
      ? params.programIdOverride
      : null;
  const selectedProgramId =
    overrideProgramId ?? scope.preferredProgramId ?? scope.programs[0]?.id ?? null;
  const centre = await resolveActivePhysicalCentre({
    schoolCode: params.schoolCode,
    programId: selectedProgramId as number,
  });

  if (!centre.ok) {
    return {
      ok: true,
      programs: scope.programs,
      examTracks: [],
      centreExamTracks: [],
      gradeSubjects: [],
      configurationError: centre.error,
      defaults: {
        programId: selectedProgramId,
        examTrack: null,
        grade: 11,
        gradeId: GRADE_IDS[11],
        subject: null,
        subjectId: null,
      },
    };
  }

  const mappedRows = await query<CentreExamTrackRow>(
    `SELECT mapping.exam_track_code AS exam_track, grade.number AS grade
     FROM centre_exam_tracks mapping
     JOIN grade ON grade.id = mapping.grade_id
     WHERE mapping.centre_id = $1
       AND grade.number = ANY($2::int[])
     ORDER BY grade.number, mapping.exam_track_code`,
    [centre.centre.id, [11, 12]]
  );

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
  const historicalLogRows = await query<HistoricalLogScopeRow>(
    `SELECT DISTINCT
       logs.exam_track,
       grade.id AS grade_id,
       grade.number AS grade,
       subject.id AS subject_id,
       subject.name AS subject
     FROM lms_curriculum_logs logs
     JOIN grade ON grade.id = logs.grade_id
     JOIN subject ON subject.id = logs.subject_id
     WHERE logs.school_code = $1
       AND logs.program_id = $2
       AND logs.deleted_at IS NULL`,
    [params.schoolCode, selectedProgramId]
  );

  const mappedKeys = new Set(
    mappedRows
      .filter((row) => isExamTrack(row.exam_track) && isGradeNumber(row.grade))
      .map((row) => `${row.exam_track}:${row.grade}`)
  );
  const allGradeSubjects = mapGradeSubjectRows(configRows);
  const mappedGradeSubjects = allGradeSubjects.filter((row) =>
    mappedKeys.has(`${row.examTrack}:${row.grade}`)
  );
  const configuredKeys = new Set(
    allGradeSubjects.map((row) => `${row.examTrack}:${row.grade}`)
  );
  const historicalGradeSubjects = mapGradeSubjectRows(historicalLogRows);
  const gradeSubjects = sortByCurriculumOrder(
    [...mappedGradeSubjects, ...historicalGradeSubjects].filter(
      (row, index, rows) =>
        rows.findIndex(
          (candidate) =>
            candidate.examTrack === row.examTrack &&
            candidate.grade === row.grade &&
            candidate.subjectId === row.subjectId
        ) === index
    )
  );
  const historicalKeys = new Set(
    historicalGradeSubjects.map((row) => `${row.examTrack}:${row.grade}`)
  );
  const centreExamTracks = [...new Set([...mappedKeys, ...historicalKeys])]
    .map((key) => {
      const [examTrack, rawGrade] = key.split(":");
      return { examTrack, grade: Number(rawGrade) };
    })
    .filter(
      (row): row is { examTrack: ExamTrack; grade: GradeNumber } =>
        isExamTrack(row.examTrack) && isGradeNumber(row.grade)
    )
    .map((row) => ({
      examTrack: row.examTrack,
      grade: row.grade,
      hasCurriculumConfig: configuredKeys.has(`${row.examTrack}:${row.grade}`),
      isMapped: mappedKeys.has(`${row.examTrack}:${row.grade}`),
      hasHistoricalLogs: historicalKeys.has(`${row.examTrack}:${row.grade}`),
    }))
    .sort((a, b) =>
      a.grade === b.grade
        ? Number(b.isMapped) - Number(a.isMapped) ||
          EXAM_TRACKS.indexOf(a.examTrack) - EXAM_TRACKS.indexOf(b.examTrack)
        : a.grade - b.grade
    );
  const defaultGrade = centreExamTracks.find((option) => option.isMapped)?.grade ??
    centreExamTracks[0]?.grade ??
    11;
  const defaultTrackOption =
    centreExamTracks.find(
      (option) =>
        option.grade === defaultGrade &&
        option.isMapped &&
        option.hasCurriculumConfig
    ) ??
    centreExamTracks.find(
      (option) => option.grade === defaultGrade && option.isMapped
    ) ??
    centreExamTracks.find((option) => option.grade === defaultGrade) ??
    null;
  const examTracks = centreExamTracks
    .filter((option) => option.grade === defaultGrade)
    .map((option) => option.examTrack);
  const firstGradeSubject = gradeSubjects.find(
    (row) =>
      row.grade === defaultGrade && row.examTrack === defaultTrackOption?.examTrack
  ) ?? null;

  return {
    ok: true,
    programs: scope.programs,
    examTracks,
    centreExamTracks,
    gradeSubjects,
    configurationError: null,
    defaults: {
      programId: selectedProgramId,
      examTrack: defaultTrackOption?.examTrack ?? null,
      grade: defaultGrade,
      gradeId: GRADE_IDS[defaultGrade],
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
  const selection = validateCurriculumSelection(params);
  if (!selection.ok) return selection;

  const curriculumId = curriculumIdForExamTrack(selection.examTrack);
  if (curriculumId === null) {
    return {
      ok: false,
      status: 422,
      error: `Curriculum configuration is not available for ${formatExamTrack(selection.examTrack)}`,
    };
  }

  const access = await requireCurriculumProgramAccess(params);
  if (!access.ok) return access;
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
      selection.examTrack,
      selection.grade,
      ({ Maths: 1, Chemistry: 2, Biology: 3, Physics: 4 } as Record<SubjectName, number>)[selection.subject],
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
