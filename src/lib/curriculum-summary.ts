// Curriculum Summary v2 (#417): one row per Summary Class (Centre + Grade) measured against its
// Curriculum Plan, and the chapter timeline for one of those classes. One set-based SQL pass
// loads the whole bounded row set for the user's scope (or one Centre of it); classification,
// Due / Done / Behind, Tests overdue, header numbers, sort and pagination are computed here with
// the shared rules in `curriculum-plan-rules`. Chapter Test sessions come from
// `curriculum-chapter-tests`.

import {
  checkCurriculumPlansSchema,
  checkCurriculumSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { loadChapterTestSessions } from "./curriculum-chapter-tests";
import { chapterSharesCodeSql } from "./chapter-siblings";
import { ELIGIBLE_CENTRE_SQL, ELIGIBLE_CENTRE_TRACKS_FROM_SQL } from "./curriculum-eligible-centres";
import {
  academicYearForDate,
  academicYearStartDate,
  behindPill,
  chapterProgress,
  chapterStatus,
  chapterTestStatus,
  classifySummaryClass,
  hoursWindowStart,
  isAcademicYearDate,
  planStatusAsOf,
  primaryExamTrackForChapter,
  subjectGroupProgress,
  subjectGroupsForClass,
  SUBJECT_GROUPS,
  type BehindPillTone,
  type ChapterStatus,
  type ChapterTestStatus,
  type HoursWindow,
  type SubjectGroup,
} from "./curriculum-plan-rules";
import { query } from "./db";
import { EXAM_TRACKS, formatExamTrack, type ExamTrack } from "./exam-tracks";
import {
  PHYSICAL_CENTRE_PROGRAM_IDS,
  getProgramContextSync,
  type UserPermission,
} from "./permissions";

export const CURRICULUM_SUMMARY_GRADES = [11, 12] as const;
export type CurriculumSummaryGrade = (typeof CURRICULUM_SUMMARY_GRADES)[number];

// Fixed pill columns; "Mathematics" Chapters count under Maths.
export const CURRICULUM_SUMMARY_SUBJECTS = ["Physics", "Chemistry", "Maths", "Biology"] as const;
export type CurriculumSummarySubject = (typeof CURRICULUM_SUMMARY_SUBJECTS)[number];

const PAGE_SIZES = [10, 20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

export type CurriculumSummarySortKey =
  | "centre"
  | "program"
  | "tracks"
  | "region"
  | Lowercase<CurriculumSummarySubject>
  | Lowercase<SubjectGroup>
  | "tests_overdue"
  | "plan";

export type CurriculumSummarySortDirection = "asc" | "desc";

export interface CurriculumSummarySort {
  key: CurriculumSummarySortKey;
  dir: CurriculumSummarySortDirection;
}

export interface CurriculumSummaryQuery {
  // Narrows the user's scoped rows; it never widens scope.
  regions: string[];
  // Centre ids to list; [] = every Centre. Ids that aren't Centre options are ignored.
  centreIds: number[];
  grade: CurriculumSummaryGrade;
  asOf: string;
  // Keeps rows with PCM or PCB Behind ≥ 1; header numbers ignore it.
  onlyBehind: boolean;
  // A column header's sort; null = the default worst-first order.
  sort: CurriculumSummarySort | null;
  page: number;
  pageSize: number;
}

type SearchParamValue = string | string[] | undefined;

function firstValue(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// `regions` and `centres` accept repeated keys (the filter form) and comma-separated values.
function parseList(value: SearchParamValue): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((item) => item.split(",")).map((item) => item.trim()))].filter(
    Boolean
  );
}

// Unknown or removed params (programs, subjects, tracks, date range, flags) are ignored, and so
// is an unknown sort column; an unknown direction falls back to the column's first-click one.
export function normalizeCurriculumSummarySearchParams(
  searchParams: Record<string, SearchParamValue>,
  todayIstDate: string
): CurriculumSummaryQuery {
  const page = Number.parseInt(firstValue(searchParams.page) ?? "1", 10);
  const pageSize = Number.parseInt(firstValue(searchParams.limit) ?? String(DEFAULT_PAGE_SIZE), 10);
  const asOf = firstValue(searchParams.as_of);
  return {
    regions: parseList(searchParams.regions),
    centreIds: parseList(searchParams.centres).filter((id) => /^[1-9]\d*$/.test(id)).map(Number),
    grade: firstValue(searchParams.grade) === "12" ? 12 : 11,
    // Invalid dates, and years too far out to name an academic year (0999, 9999), mean today.
    asOf: asOf && isAcademicYearDate(asOf) ? asOf : todayIstDate,
    onlyBehind: ["1", "true"].includes(firstValue(searchParams.only_behind) ?? ""),
    sort: parseSort(firstValue(searchParams.sort), firstValue(searchParams.dir)),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

function parseSort(key: string | undefined, dir: string | undefined): CurriculumSummarySort | null {
  if (!isSortKey(key)) return null;
  return { key, dir: dir === "asc" || dir === "desc" ? dir : defaultSortDirection(key) };
}

export type CurriculumSummaryRowKind =
  | "plan"
  | "no_plan"
  | "setup_error"
  | "no_content"
  | "configuration_error";

export interface CurriculumSummarySubjectProgress {
  due: number;
  done: number;
  behind: number;
  tone: BehindPillTone;
  label: string;
}

export interface CurriculumSummaryRow {
  centreId: number;
  centreName: string;
  schoolCode: string;
  schoolName: string;
  region: string | null;
  programId: number;
  programName: string;
  tracksLabel: string;
  kind: CurriculumSummaryRowKind;
  explanation: string | null;
  // Set only for rows measured against an Active (or Closed) plan.
  plan: { id: number; title: string; closed: boolean } | null;
  // null = "—": no in-syllabus Chapter of that subject for the class's tracks.
  subjects: Record<CurriculumSummarySubject, CurriculumSummarySubjectProgress | null> | null;
  // PCM Behind and PCB Behind for plan rows, with done/due like the subject pills; null = "—":
  // the group doesn't apply to the class.
  subjectGroups: Record<SubjectGroup, CurriculumSummarySubjectProgress | null> | null;
  // Plan Chapters whose Chapter Test Status is Overdue; 0 for rows without a plan.
  testsOverdue: number;
  // Set only for No plan rows: Chapters with a Conducted Chapter Test.
  testsConducted: number | null;
}

export interface CurriculumSummaryHeader {
  centresOnPlan: number;
  centresTotal: number;
  // PCM and PCB chapters behind: each group's Behind summed over the rows.
  chaptersBehind: Record<SubjectGroup, number>;
  testsOverdue: number;
}

export interface CurriculumSummaryCentreOption {
  id: number;
  name: string;
}

export type CurriculumSummaryResult =
  | {
      ok: true;
      header: CurriculumSummaryHeader;
      // Regions of every scoped row for the Grade, before the Region and Centre filters.
      regionOptions: string[];
      // Centres of the scoped rows in the chosen Regions, A–Z; Only behind doesn't narrow them.
      centreOptions: CurriculumSummaryCentreOption[];
      // The `centreIds` that are Centre options, in option order; the rows listed are these.
      selectedCentreIds: number[];
      rows: CurriculumSummaryRow[];
      pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
    }
  | CurriculumSchemaUnavailable;

interface SummaryChapter {
  chapterId: number;
  code: string;
  name: string;
  subject: string;
  // Lowest coverage sequence across the class's tracks: syllabus order within a subject.
  sequence: number;
  tracks: string[];
  // Exam Track → prescribed lecture minutes, for the tracks whose syllabus has the Chapter.
  prescribedMinutes: Record<string, number>;
  dueDate: string | null;
  testDate: string | null;
  completedOn: string | null;
}

interface SummaryQueryRow {
  centre_id: string | number;
  centre_name: string;
  school_code: string;
  school_name: string | null;
  region: string | null;
  program_id: string | number;
  program_name: string;
  centre_count: string | number;
  mapped_tracks: string[];
  plan_id: string | number | null;
  plan_title: string | null;
  plan_status: "draft" | "active" | null;
  plan_closure_date: string | null;
  chapters: unknown;
}

export async function getCurriculumSummary(
  permission: UserPermission,
  params: CurriculumSummaryQuery
): Promise<CurriculumSummaryResult> {
  const schema = await checkSummarySchemas();
  if (!schema.ok) return schema;

  const scopedRows = (await loadSummaryClasses(permission, params)).map(buildSummaryRow);
  const regionOptions = [
    ...new Set(scopedRows.flatMap((row) => (row.region ? [row.region] : []))),
  ].sort();
  const filtered = applySummaryFilters(scopedRows, params);
  const rows = sortSummaryRows(filtered.rows, params.sort);
  const listedRows = params.onlyBehind ? rows.filter((row) => worstGroupBehind(row) >= 1) : rows;
  const { page, totalPages, pageRows } = paginate(listedRows, params.page, params.pageSize);

  return {
    ok: true,
    header: summaryHeader(rows),
    regionOptions,
    centreOptions: filtered.centreOptions,
    selectedCentreIds: filtered.selectedCentreIds,
    rows: pageRows,
    pagination: { page, pageSize: params.pageSize, totalRows: listedRows.length, totalPages },
  };
}

// Both the Summary and the timeline need the curriculum and Curriculum Plan schemas.
async function checkSummarySchemas(): Promise<{ ok: true } | CurriculumSchemaUnavailable> {
  const curriculum = await checkCurriculumSchema();
  if (!curriculum.ok) return curriculum;
  return checkCurriculumPlansSchema();
}

// Region and Centre narrow the user's scoped rows; they never widen scope. The Centre options
// are the Centres in the chosen Regions, and a Centre id that isn't one (out of scope, another
// Grade or Region, or gone) is ignored; with none left every Centre is listed.
function applySummaryFilters(scopedRows: CurriculumSummaryRow[], params: CurriculumSummaryQuery) {
  const regionRows = scopedRows.filter(
    (row) => params.regions.length === 0 || params.regions.includes(row.region ?? "")
  );
  const centreOptions: CurriculumSummaryCentreOption[] = regionRows
    .map((row) => ({ id: row.centreId, name: row.centreName }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const selectedCentreIds = centreOptions
    .filter((option) => params.centreIds.includes(option.id))
    .map((option) => option.id);
  const rows =
    selectedCentreIds.length > 0
      ? regionRows.filter((row) => selectedCentreIds.includes(row.centreId))
      : regionRows;
  return { rows, centreOptions, selectedCentreIds };
}

// A page past the end shows the last page; no rows is page 1 of 0.
function paginate<T>(rows: T[], requestedPage: number, pageSize: number) {
  const totalPages = Math.ceil(rows.length / pageSize);
  const page = totalPages === 0 ? 1 : Math.min(requestedPage, totalPages);
  const offset = (page - 1) * pageSize;
  return { page, totalPages, pageRows: rows.slice(offset, offset + pageSize) };
}

interface SummaryClassData {
  raw: SummaryQueryRow;
  chapters: SummaryChapter[];
  // Chapter id → Chapter Test session end times for this Centre's class.
  chapterTestSessions: Map<number, (string | null)[]>;
  asOf: string;
}

// Every Summary Class in the user's scope for the Grade, or only `centreId`'s when given (none
// when that Centre is out of scope or maps no Exam Track for the Grade).
async function loadSummaryClasses(
  permission: UserPermission,
  params: { grade: CurriculumSummaryGrade; asOf: string; centreId?: number }
): Promise<SummaryClassData[]> {
  const academicYear = academicYearForDate(params.asOf);
  const rawRows = await query<SummaryQueryRow>(SUMMARY_SQL, [
    ...scopeParams(permission),
    params.grade,
    academicYear,
    academicYearStartDate(academicYear),
    params.asOf,
    params.centreId ?? null,
  ]);
  const chapterTests = await loadChapterTestSessions({
    centreIds: rawRows.map((row) => Number(row.centre_id)),
    grade: params.grade,
    academicYear,
    asOf: params.asOf,
  });
  return rawRows.map((raw) => ({
    raw,
    chapters: parseChapters(raw.chapters),
    chapterTestSessions: chapterTests.get(Number(raw.centre_id)) ?? new Map(),
    asOf: params.asOf,
  }));
}

// $1 all schools, $2 school codes (explicit ∪ seat scope), $3 regions, $4 physical-centre
// Programs, $5 Admin (all Programs), $6 the user's Programs.
function scopeParams(permission: UserPermission): unknown[] {
  const schools = scopedSchoolCodes(permission);
  return [
    permission.level === 3,
    schools.length > 0 ? schools : null,
    permission.level === 2 ? permission.regions ?? [] : null,
    PHYSICAL_CENTRE_PROGRAM_IDS,
    permission.role === "admin",
    getProgramContextSync(permission).programIds,
  ];
}

// The resolved scope's School codes (explicit codes ∪ seat Schools), else a level-1 user's
// explicit codes; empty means no School-code scope.
function scopedSchoolCodes(permission: UserPermission): string[] {
  if (permission.scope && permission.scope.schools !== "all") return [...permission.scope.schools];
  if (permission.level === 1) return permission.school_codes ?? [];
  return [];
}

// $7 Grade number, $8 academic year of as-of, $9 its 1 Apr, $10 as-of, $11 one Centre id (null
// = all). Every in-scope active physical JNV Centre with a Centre Exam Track for the Grade is
// one row; its Chapters are the Grade's in-syllabus Chapters for any mapped track, each with its
// plan due and test dates (only for an Active plan serving one of the Chapter's tracks) and its
// earliest Chapter Completion IST date within [1 Apr, as-of] under any mapped track.
// `scoped_centres` holds one row per in-scope eligible Centre + mapped track for the Grade;
// `mapped` folds them into one row per Centre.
const SUMMARY_SQL = `
  WITH scoped_centres AS (
    SELECT
      c.id AS centre_id,
      c.name AS centre_name,
      c.school_id,
      c.program_id,
      s.code AS school_code,
      s.name AS school_name,
      s.region,
      p.name AS program_name,
      cet.exam_track_code
    FROM ${ELIGIBLE_CENTRE_TRACKS_FROM_SQL}
    JOIN grade g ON g.id = cet.grade_id AND g.number = $7
    JOIN program p ON p.id = c.program_id
    WHERE ${ELIGIBLE_CENTRE_SQL}
      AND (
        $1::boolean
        OR ($2::text[] IS NOT NULL AND s.code = ANY($2::text[]))
        OR ($3::text[] IS NOT NULL AND s.region = ANY($3::text[]))
      )
      AND c.program_id = ANY($4::int[])
      AND ($5::boolean OR c.program_id = ANY($6::int[]))
      AND ($11::int IS NULL OR c.id = $11::int)
  ),
  mapped AS (
    SELECT
      sc.centre_id,
      sc.centre_name,
      sc.school_id,
      sc.program_id,
      sc.school_code,
      sc.school_name,
      sc.region,
      sc.program_name,
      ARRAY_AGG(DISTINCT sc.exam_track_code::text) AS mapped_tracks,
      (
        SELECT COUNT(*)
        FROM centres other
        WHERE other.school_id = sc.school_id
          AND other.program_id = sc.program_id
          AND other.is_active = true
          AND other.is_physical = true
      )::int AS centre_count
    FROM scoped_centres sc
    GROUP BY
      sc.centre_id, sc.centre_name, sc.school_id, sc.program_id,
      sc.school_code, sc.school_name, sc.region, sc.program_name
  ),
  grade_chapters AS (
    SELECT
      ch.id AS chapter_id,
      ch.code AS chapter_code,
      COALESCE(
        (
          SELECT item->>'chapter'
          FROM jsonb_array_elements(ch.name::jsonb) item
          WHERE item->>'lang_code' = 'en'
          LIMIT 1
        ),
        ch.code,
        'Unknown chapter'
      ) AS chapter_name,
      COALESCE(
        (
          SELECT item->>'subject'
          FROM jsonb_array_elements(s.name::jsonb) item
          WHERE item->>'lang_code' = 'en'
          LIMIT 1
        ),
        'Unknown subject'
      ) AS subject_name,
      ARRAY_AGG(DISTINCT cfg.exam_track::text) AS tracks,
      JSONB_OBJECT_AGG(cfg.exam_track::text, cfg.coverage_sequence) AS sequences,
      JSONB_OBJECT_AGG(cfg.exam_track::text, cfg.prescribed_minutes) AS prescribed_minutes
    FROM lms_chapter_exam_configs cfg
    JOIN chapter ch ON ch.id = cfg.chapter_id
    JOIN grade g ON g.id = ch.grade_id AND g.number = $7
    JOIN subject s ON s.id = ch.subject_id
    WHERE cfg.is_in_syllabus = true
    GROUP BY ch.id, ch.code, ch.name, s.name
  ),
  assigned_plans AS (
    SELECT
      a.centre_id,
      p.id AS plan_id,
      p.title,
      p.status,
      p.closure_date,
      p.exam_tracks
    FROM lms_curriculum_plan_assignments a
    JOIN lms_curriculum_plans p ON p.id = a.plan_id
    JOIN grade g ON g.id = a.grade_id AND g.number = $7
    WHERE a.academic_year = $8
  ),
  centre_chapters AS (
    SELECT
      m.centre_id,
      gc.chapter_id,
      gc.chapter_code,
      gc.chapter_name,
      gc.subject_name,
      gc.tracks,
      gc.prescribed_minutes,
      (
        SELECT MIN((gc.sequences->>track)::int)
        FROM unnest(m.mapped_tracks) AS track
      ) AS sequence,
      CASE
        WHEN ap.status = 'active' AND ap.exam_tracks && gc.tracks THEN pc.due_date
      END AS due_date,
      CASE
        WHEN ap.status = 'active' AND ap.exam_tracks && gc.tracks THEN pc.test_date
      END AS test_date,
      (
        SELECT MIN((cc.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date)
        FROM lms_curriculum_chapter_completions cc
        WHERE cc.school_code = m.school_code
          AND cc.program_id = m.program_id
          AND cc.chapter_id = gc.chapter_id
          AND cc.exam_track = ANY(m.mapped_tracks)
          AND cc.deleted_at IS NULL
          AND (cc.completed_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date
            BETWEEN $9::date AND $10::date
      ) AS completed_on
    FROM mapped m
    JOIN grade_chapters gc ON gc.tracks && m.mapped_tracks
    LEFT JOIN assigned_plans ap ON ap.centre_id = m.centre_id
    LEFT JOIN lms_curriculum_plan_chapters pc
      ON pc.plan_id = ap.plan_id
     AND pc.chapter_id = gc.chapter_id
  )
  SELECT
    m.centre_id,
    m.centre_name,
    m.school_code,
    m.school_name,
    m.region,
    m.program_id,
    m.program_name,
    m.centre_count,
    m.mapped_tracks,
    ap.plan_id,
    ap.title AS plan_title,
    ap.status AS plan_status,
    ap.closure_date::text AS plan_closure_date,
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object(
          'chapterId', cch.chapter_id,
          'code', cch.chapter_code,
          'name', cch.chapter_name,
          'subject', cch.subject_name,
          'sequence', cch.sequence,
          'tracks', cch.tracks,
          'prescribedMinutes', cch.prescribed_minutes,
          'dueDate', cch.due_date::text,
          'testDate', cch.test_date::text,
          'completedOn', cch.completed_on::text
        ))
        FROM centre_chapters cch
        WHERE cch.centre_id = m.centre_id
      ),
      '[]'::jsonb
    ) AS chapters
  FROM mapped m
  LEFT JOIN assigned_plans ap ON ap.centre_id = m.centre_id`;

function chapterTestStatusFor(
  { chapterTestSessions, asOf }: SummaryClassData,
  chapter: SummaryChapter
): ChapterTestStatus {
  return chapterTestStatus({
    dueDate: chapter.dueDate,
    testDate: chapter.testDate,
    sessionEndTimes: chapterTestSessions.get(chapter.chapterId) ?? [],
    asOf,
  });
}

function buildSummaryRow(data: SummaryClassData): CurriculumSummaryRow {
  const { raw, chapters, asOf } = data;
  const base = summaryRowBase(raw);
  const problem = summaryClassProblem(raw, chapters);
  if (problem) return { ...base, ...problem };
  if (raw.plan_id === null || raw.plan_status !== "active" || !raw.plan_title) {
    // Without plan dates no Chapter Test can be Overdue; show what was held instead.
    return { ...base, kind: "no_plan", explanation: null, testsConducted: testStatusCount(data, "conducted") };
  }

  const subjects = Object.fromEntries(
    CURRICULUM_SUMMARY_SUBJECTS.map((subject) => [subject, subjectProgress(chapters, subject, asOf)])
  ) as Record<CurriculumSummarySubject, CurriculumSummarySubjectProgress | null>;
  const closureDate = raw.plan_closure_date ?? asOf;

  return {
    ...base,
    kind: "plan",
    explanation: null,
    plan: {
      id: Number(raw.plan_id),
      title: raw.plan_title,
      closed: planStatusAsOf({ status: "active", closureDate }, asOf) === "closed",
    },
    subjects,
    subjectGroups: subjectGroupsBehind(raw, chapters, asOf),
    testsOverdue: testStatusCount(data, "overdue"),
  };
}

function testStatusCount(data: SummaryClassData, kind: ChapterTestStatus["kind"]): number {
  return data.chapters.filter((chapter) => chapterTestStatusFor(data, chapter).kind === kind).length;
}

function summaryRowBase(raw: SummaryQueryRow) {
  const mappedTracks = EXAM_TRACKS.filter((track) => raw.mapped_tracks.includes(track));
  return {
    centreId: Number(raw.centre_id),
    centreName: raw.centre_name,
    schoolCode: raw.school_code,
    schoolName: raw.school_name ?? raw.school_code,
    region: raw.region,
    programId: Number(raw.program_id),
    programName: raw.program_name,
    tracksLabel: mappedTracks.map(formatExamTrack).join(" + "),
    plan: null,
    subjects: null,
    subjectGroups: null,
    testsOverdue: 0,
    testsConducted: null,
  };
}

// Classes the Summary can't measure: an ambiguous Centre, a track setup error, or no content.
function summaryClassProblem(
  raw: SummaryQueryRow,
  chapters: SummaryChapter[]
): { kind: CurriculumSummaryRowKind; explanation: string } | null {
  // Logs and completions are keyed by School + Program, so a second active physical Centre
  // there makes this Centre's progress ambiguous.
  if (Number(raw.centre_count) > 1) {
    return {
      kind: "configuration_error",
      explanation: "Multiple active physical Centres are configured for this School and Program",
    };
  }
  const summaryClass = classifySummaryClass(
    raw.mapped_tracks,
    chapters.flatMap((chapter) => chapter.tracks)
  );
  if (summaryClass.kind === "setup_error") {
    return { kind: "setup_error", explanation: "Fix tracks in Centre Management" };
  }
  if (summaryClass.kind === "no_content") {
    return { kind: "no_content", explanation: "Curriculum configuration is unavailable" };
  }
  return null;
}

// null when the class has no Chapter of the subject.
function subjectProgress(
  chapters: SummaryChapter[],
  subject: string,
  asOf: string
): CurriculumSummarySubjectProgress | null {
  const subjectChapters = chapters.filter((chapter) => chapter.subject === subject);
  if (subjectChapters.length === 0) return null;
  const progress = chapterProgress(subjectChapters, asOf);
  return { ...progress, ...behindPill(progress.behind) };
}

// PCM Behind and PCB Behind with done/due; a group the Summary Class's tracks don't take is null.
function subjectGroupsBehind(
  raw: SummaryQueryRow,
  chapters: SummaryChapter[],
  asOf: string
): Record<SubjectGroup, CurriculumSummarySubjectProgress | null> {
  const classGroups = subjectGroupsForClass(summaryClassTracks(raw.mapped_tracks, chapters));
  return Object.fromEntries(
    SUBJECT_GROUPS.map((group) => {
      if (!classGroups.includes(group)) return [group, null];
      const progress = subjectGroupProgress(chapters, group, asOf);
      return [group, { ...progress, ...behindPill(progress.behind) }];
    })
  ) as Record<SubjectGroup, CurriculumSummarySubjectProgress | null>;
}

function groupBehind(row: CurriculumSummaryRow, group: SubjectGroup): number {
  return row.subjectGroups?.[group]?.behind ?? 0;
}

// The larger of PCM and PCB Behind; a group that doesn't apply counts as 0.
function worstGroupBehind(row: CurriculumSummaryRow): number {
  return Math.max(...SUBJECT_GROUPS.map((group) => groupBehind(row, group)));
}

function parseChapters(value: unknown): SummaryChapter[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map(parseChapter);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseChapter(chapter: Record<string, unknown>): SummaryChapter {
  return {
    chapterId: Number(chapter.chapterId),
    code: stringOrNull(chapter.code) ?? "",
    name: String(chapter.name),
    sequence: typeof chapter.sequence === "number" ? chapter.sequence : Number.MAX_SAFE_INTEGER,
    subject: chapter.subject === "Mathematics" ? "Maths" : String(chapter.subject),
    tracks: Array.isArray(chapter.tracks) ? chapter.tracks.map(String) : [],
    prescribedMinutes: parsePrescribedMinutes(chapter.prescribedMinutes),
    dueDate: stringOrNull(chapter.dueDate),
    testDate: stringOrNull(chapter.testDate),
    completedOn: stringOrNull(chapter.completedOn),
  };
}

function parsePrescribedMinutes(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([track, minutes]) => [track, Number(minutes) || 0])
  );
}

const KIND_ORDER: Record<CurriculumSummaryRowKind, number> = {
  plan: 0,
  no_plan: 1,
  setup_error: 2,
  no_content: 3,
  configuration_error: 4,
};

// Worst first: plan rows by the larger of PCM and PCB Behind desc then Tests overdue desc, then
// No-plan rows, then setup-error, no-content and configuration-error rows; Centre name breaks
// ties.
function compareWorstFirst(a: CurriculumSummaryRow, b: CurriculumSummaryRow): number {
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    worstGroupBehind(b) - worstGroupBehind(a) ||
    b.testsOverdue - a.testsOverdue ||
    compareCentreNames(a, b)
  );
}

function compareCentreNames(a: CurriculumSummaryRow, b: CurriculumSummaryRow): number {
  return a.centreName.localeCompare(b.centreName) || a.centreId - b.centreId;
}

// A row's value in a sorted column: text, or numbers compared in order; null = the cell has no
// value there ("—", "Not measured without an Active plan", No plan, an explanation, a blank).
type SortValue = string | number[] | null;

function textSortValue(value: string | null): SortValue {
  return value?.trim() ? value : null;
}

// A pill sorts by chapters behind ("On track" is 0), then by due count.
function pillSortValue(progress: CurriculumSummarySubjectProgress | null | undefined): SortValue {
  return progress ? [progress.behind, progress.due] : null;
}

const SORT_VALUES: Record<CurriculumSummarySortKey, (row: CurriculumSummaryRow) => SortValue> = {
  centre: (row) => textSortValue(row.centreName),
  program: (row) => textSortValue(row.programName),
  tracks: (row) => textSortValue(row.tracksLabel),
  region: (row) => textSortValue(row.region),
  physics: (row) => pillSortValue(row.subjects?.Physics),
  chemistry: (row) => pillSortValue(row.subjects?.Chemistry),
  maths: (row) => pillSortValue(row.subjects?.Maths),
  biology: (row) => pillSortValue(row.subjects?.Biology),
  pcm: (row) => pillSortValue(row.subjectGroups?.PCM),
  pcb: (row) => pillSortValue(row.subjectGroups?.PCB),
  // No plan rows show Conducted tests instead, and error rows show neither.
  tests_overdue: (row) => (row.kind === "plan" ? [row.testsOverdue] : null),
  plan: (row) => textSortValue(row.plan?.title ?? null),
};

const TEXT_SORT_KEYS: CurriculumSummarySortKey[] = ["centre", "program", "tracks", "region", "plan"];

function isSortKey(key: string | undefined): key is CurriculumSummarySortKey {
  return key !== undefined && Object.prototype.hasOwnProperty.call(SORT_VALUES, key);
}

// A header's first click: A–Z for the text columns, most behind (or overdue) first for the rest.
export function defaultSortDirection(key: CurriculumSummarySortKey): CurriculumSummarySortDirection {
  return TEXT_SORT_KEYS.includes(key) ? "asc" : "desc";
}

// Text case-insensitively; numbers in order (behind, then due for a pill).
function compareSortValues(a: string | number[], b: string | number[]): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const index = a.findIndex((value, i) => value !== b[i]);
    return index === -1 ? 0 : a[index] - b[index];
  }
  return String(a).localeCompare(String(b), "en", { sensitivity: "base" });
}

interface SortEntry {
  row: CurriculumSummaryRow;
  value: SortValue;
}

// Rows without a value go last in both directions, in the default order's row-kind order.
function compareSortEntries(a: SortEntry, b: SortEntry, sign: number): number {
  if (a.value === null || b.value === null) {
    if (a.value !== null) return -1;
    if (b.value !== null) return 1;
    return KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind];
  }
  return sign * compareSortValues(a.value, b.value);
}

// The default worst-first order, or a column header's sort with Centre name (A–Z) breaking ties.
// Runs over every listed row before pagination; each row is one Summary Class.
export function sortSummaryRows(
  rows: CurriculumSummaryRow[],
  sort: CurriculumSummarySort | null
): CurriculumSummaryRow[] {
  if (!sort) return [...rows].sort(compareWorstFirst);
  const sortValue = SORT_VALUES[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return rows
    .map((row): SortEntry => ({ row, value: sortValue(row) }))
    .sort((a, b) => compareSortEntries(a, b, sign) || compareCentreNames(a.row, b.row))
    .map((entry) => entry.row);
}

// Centres on plan = rows with an Active or Closed plan out of every row except setup-error and
// no-content rows; PCM / PCB chapters behind = Σ PCM / PCB Behind; Chapter tests overdue =
// Σ Tests overdue. Covers all rows, not just the current page.
function summaryHeader(rows: CurriculumSummaryRow[]): CurriculumSummaryHeader {
  return {
    centresOnPlan: rows.filter((row) => row.kind === "plan").length,
    centresTotal: rows.filter((row) => row.kind !== "setup_error" && row.kind !== "no_content")
      .length,
    chaptersBehind: Object.fromEntries(
      SUBJECT_GROUPS.map((group) => [group, rows.reduce((sum, row) => sum + groupBehind(row, group), 0)])
    ) as Record<SubjectGroup, number>,
    testsOverdue: rows.reduce((sum, row) => sum + row.testsOverdue, 0),
  };
}

export interface ChapterTimelineChapter {
  chapterId: number;
  code: string;
  name: string;
  subject: string;
  dueDate: string | null;
  // Earliest Chapter Completion IST date within [1 Apr of the academic year, as-of].
  completedOn: string | null;
  status: ChapterStatus;
  testStatus: ChapterTestStatus;
  // Regular-log minutes in the hours window, split to the Chapter by topic share.
  taughtMinutes: number;
  // The Primary Exam Track's prescribed minutes, falling back through the class's other tracks.
  prescribedMinutes: number;
  // Class Cancellation Logs and Doubt Solving Log minutes for the Chapter in the hours window.
  cancellations: number;
  doubtSolvingMinutes: number;
}

export interface ChapterTimeline {
  grade: CurriculumSummaryGrade;
  // Grades with a Summary Class at this Centre (a Centre Exam Track mapped); the timeline's
  // Grade switch links only these, since any other Grade's timeline does not exist.
  grades: CurriculumSummaryGrade[];
  asOf: string;
  hoursWindow: HoursWindow;
  // The class as the Summary shows it: Centre, kind, explanation, plan and Behind.
  row: CurriculumSummaryRow;
  // Subjects with Chapters for the class, in pill-column order; `progress` is null without a plan.
  subjects: { subject: string; progress: CurriculumSummarySubjectProgress | null }[];
  // By Chapter Due Date; undated Chapters last in syllabus order. Empty for setup-error,
  // no-content and configuration-error classes.
  chapters: ChapterTimelineChapter[];
  header: {
    due: number;
    done: number;
    syllabusDone: number;
    syllabusTotal: number;
    testsOverdue: number;
    // Σ over the class's Chapters: hours taught in the window and prescribed time.
    taughtMinutes: number;
    prescribedMinutes: number;
    cancellations: number;
    doubtSolvingMinutes: number;
  };
}

export type ChapterTimelineResult =
  | { ok: true; timeline: ChapterTimeline }
  | { ok: false; status: 404 }
  | CurriculumSchemaUnavailable;

// The chapter timeline for the Summary Class of `centreId` + Grade. A Centre outside the user's
// Summary row universe for that Grade is not found, so nothing about it leaks.
export async function getChapterTimeline(
  permission: UserPermission,
  centreId: number,
  params: { grade: CurriculumSummaryGrade; asOf: string; hoursWindow: HoursWindow }
): Promise<ChapterTimelineResult> {
  const schema = await checkSummarySchemas();
  if (!schema.ok) return schema;
  if (!Number.isInteger(centreId) || centreId <= 0) return { ok: false, status: 404 };

  const [data] = await loadSummaryClasses(permission, { ...params, centreId });
  if (!data) return { ok: false, status: 404 };

  const row = buildSummaryRow(data);
  const grades = await loadCentreGrades(centreId);
  // Setup-error, no-content and configuration-error classes list no Chapters.
  const chapters = row.kind === "plan" || row.kind === "no_plan" ? data.chapters : [];
  const classTracks = summaryClassTracks(data.raw.mapped_tracks, chapters);
  const activity = await loadTimelineActivity({
    schoolCode: data.raw.school_code,
    programId: Number(data.raw.program_id),
    grade: params.grade,
    tracks: classTracks,
    from: hoursWindowStart(params.hoursWindow, params.asOf),
    to: params.asOf,
    chapterIds: chapters.map((chapter) => chapter.chapterId),
  });
  const timelineChapters = [...chapters]
    .sort(compareTimelineChapters)
    .map((chapter) => timelineChapter(data, chapter, { classTracks, activity, asOf: params.asOf }));

  return {
    ok: true,
    timeline: {
      grade: params.grade,
      grades,
      asOf: params.asOf,
      hoursWindow: params.hoursWindow,
      row,
      subjects: timelineSubjects(row, chapters, params.asOf),
      chapters: timelineChapters,
      header: timelineHeader(row, chapters, timelineChapters, params.asOf),
    },
  };
}

function summaryClassTracks(mappedTracks: string[], chapters: SummaryChapter[]): ExamTrack[] {
  const summaryClass = classifySummaryClass(
    mappedTracks,
    chapters.flatMap((chapter) => chapter.tracks)
  );
  return summaryClass.kind === "single" || summaryClass.kind === "shared" ? summaryClass.tracks : [];
}

const NO_ACTIVITY: TimelineActivity = { taughtMinutes: 0, cancellations: 0, doubtSolvingMinutes: 0 };

function timelineChapter(
  data: SummaryClassData,
  chapter: SummaryChapter,
  context: { classTracks: ExamTrack[]; activity: Map<number, TimelineActivity>; asOf: string }
): ChapterTimelineChapter {
  const track = primaryExamTrackForChapter(context.classTracks, chapter.tracks);
  return {
    chapterId: chapter.chapterId,
    code: chapter.code,
    name: chapter.name,
    subject: chapter.subject,
    dueDate: chapter.dueDate,
    completedOn: chapter.completedOn,
    status: chapterStatus({ dueDate: chapter.dueDate, completedOn: chapter.completedOn, asOf: context.asOf }),
    testStatus: chapterTestStatusFor(data, chapter),
    ...(context.activity.get(chapter.chapterId) ?? NO_ACTIVITY),
    prescribedMinutes: track ? chapter.prescribedMinutes[track] ?? 0 : 0,
  };
}

// Subjects with Chapters for the class in pill-column order; progress only with a plan.
function timelineSubjects(
  row: CurriculumSummaryRow,
  chapters: SummaryChapter[],
  asOf: string
): ChapterTimeline["subjects"] {
  return [...new Set(chapters.map((chapter) => chapter.subject))]
    .sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b))
    .map((subject) => ({
      subject,
      progress: row.kind === "plan" ? subjectProgress(chapters, subject, asOf) : null,
    }));
}

function timelineHeader(
  row: CurriculumSummaryRow,
  chapters: SummaryChapter[],
  timelineChapters: ChapterTimelineChapter[],
  asOf: string
): ChapterTimeline["header"] {
  const progress = chapterProgress(chapters, asOf);
  const total = (value: (chapter: ChapterTimelineChapter) => number) =>
    timelineChapters.reduce((sum, chapter) => sum + value(chapter), 0);
  return {
    due: progress.due,
    done: progress.done,
    syllabusDone: chapters.filter((chapter) => chapter.completedOn !== null).length,
    syllabusTotal: chapters.length,
    testsOverdue: row.testsOverdue,
    taughtMinutes: total((chapter) => chapter.taughtMinutes),
    prescribedMinutes: total((chapter) => chapter.prescribedMinutes),
    cancellations: total((chapter) => chapter.cancellations),
    doubtSolvingMinutes: total((chapter) => chapter.doubtSolvingMinutes),
  };
}

// The Centre is already known to be in the user's scope; a Grade has a Summary Class there when
// the Centre maps an Exam Track for it (the Summary's own row rule).
async function loadCentreGrades(centreId: number): Promise<CurriculumSummaryGrade[]> {
  const rows = await query<{ grade: string | number }>(
    `SELECT DISTINCT g.number AS grade
     FROM centre_exam_tracks cet
     JOIN grade g ON g.id = cet.grade_id
     WHERE cet.centre_id = $1
       AND g.number = ANY($2::int[])
     ORDER BY g.number`,
    [centreId, CURRICULUM_SUMMARY_GRADES]
  );
  return CURRICULUM_SUMMARY_GRADES.filter((grade) => rows.some((row) => Number(row.grade) === grade));
}

interface TimelineActivityRow {
  chapter_id: string | number;
  taught_minutes: string | number;
  cancellations: string | number;
  doubt_solving_minutes: string | number;
}

interface TimelineActivity {
  taughtMinutes: number;
  cancellations: number;
  doubtSolvingMinutes: number;
}

// Per Chapter of the class, from LMS Curriculum Logs at the Centre's School + Program + Grade
// under any class track within [from, to]: regular minutes, each log split to Chapters by topic
// share (its minutes × the Chapter's topics / the log's topics, rounded per log); Class
// Cancellation Logs and Doubt Solving minutes by their `chapter_id`. A shared class's logs under
// both tracks are summed without de-duplication (ADR 0008).
async function loadTimelineActivity(params: {
  schoolCode: string;
  programId: number;
  grade: CurriculumSummaryGrade;
  tracks: string[];
  from: string;
  to: string;
  chapterIds: number[];
}): Promise<Map<number, TimelineActivity>> {
  if (params.tracks.length === 0 || params.chapterIds.length === 0) return new Map();
  const rows = await query<TimelineActivityRow>(TIMELINE_ACTIVITY_SQL, [
    params.schoolCode,
    params.programId,
    params.grade,
    params.tracks,
    params.from,
    params.to,
    params.chapterIds,
  ]);
  return new Map(
    rows.map((row) => [
      Number(row.chapter_id),
      {
        taughtMinutes: Number(row.taught_minutes),
        cancellations: Number(row.cancellations),
        doubtSolvingMinutes: Number(row.doubt_solving_minutes),
      },
    ])
  );
}

// $1 School code, $2 Program id, $3 Grade number, $4 class tracks, $5 window start, $6 as-of,
// $7 the class's Chapter ids.
const TIMELINE_ACTIVITY_SQL = `
  WITH window_logs AS (
    SELECT l.id, l.log_type, l.duration_minutes, l.chapter_id
    FROM lms_curriculum_logs l
    JOIN grade g ON g.id = l.grade_id AND g.number = $3
    WHERE l.school_code = $1
      AND l.program_id = $2
      AND l.exam_track = ANY($4::text[])
      AND l.deleted_at IS NULL
      AND l.log_date BETWEEN $5::date AND $6::date
  ),
  log_topics AS (
    SELECT
      wl.id AS log_id,
      wl.duration_minutes,
      t.chapter_id,
      COUNT(*) OVER (PARTITION BY wl.id) AS total_topics_in_log
    FROM window_logs wl
    JOIN lms_curriculum_log_topics lt ON lt.curriculum_log_id = wl.id
    JOIN topic t ON t.id = lt.topic_id
    WHERE wl.log_type = 'regular'
  ),
  chapter_log_minutes AS (
    SELECT
      chapter_id,
      ROUND(
        MAX(duration_minutes)::numeric * COUNT(*)::numeric / MAX(total_topics_in_log)::numeric
      ) AS minutes
    FROM log_topics
    GROUP BY log_id, chapter_id
  ),
  chapter_activity AS (
    SELECT chapter_id, minutes AS taught_minutes, 0 AS cancellations, 0 AS doubt_solving_minutes
    FROM chapter_log_minutes
    UNION ALL
    SELECT
      chapter_id,
      0,
      CASE WHEN log_type = 'class_cancelled' THEN 1 ELSE 0 END,
      CASE WHEN log_type = 'doubt_solving' THEN duration_minutes ELSE 0 END
    FROM window_logs
    WHERE log_type IN ('class_cancelled', 'doubt_solving')
  )
  -- Activity under a duplicate Chapter row (same code + subject + Grade) counts toward the
  -- class's row for that Chapter: the logged row itself when listed, else its lowest listed
  -- sibling, so nothing is counted twice.
  SELECT
    target.chapter_id,
    SUM(ca.taught_minutes)::int AS taught_minutes,
    SUM(ca.cancellations)::int AS cancellations,
    SUM(ca.doubt_solving_minutes)::int AS doubt_solving_minutes
  FROM chapter_activity ca
  JOIN chapter logged ON logged.id = ca.chapter_id
  CROSS JOIN LATERAL (
    SELECT listed.id AS chapter_id
    FROM chapter listed
    WHERE listed.id = ANY($7::bigint[])
      AND (listed.id = logged.id OR (${chapterSharesCodeSql("logged", "listed")}))
    ORDER BY listed.id = logged.id DESC, listed.id
    LIMIT 1
  ) target
  GROUP BY target.chapter_id`;

function subjectRank(subject: string): number {
  const index = (CURRICULUM_SUMMARY_SUBJECTS as readonly string[]).indexOf(subject);
  return index === -1 ? CURRICULUM_SUMMARY_SUBJECTS.length : index;
}

// Syllabus order: pill-column subject order, then coverage sequence, then Chapter code.
function compareSyllabusOrder(a: SummaryChapter, b: SummaryChapter): number {
  return (
    subjectRank(a.subject) - subjectRank(b.subject) ||
    a.subject.localeCompare(b.subject) ||
    a.sequence - b.sequence ||
    a.code.localeCompare(b.code) ||
    a.chapterId - b.chapterId
  );
}

function compareTimelineChapters(a: SummaryChapter, b: SummaryChapter): number {
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  return compareSyllabusOrder(a, b);
}
