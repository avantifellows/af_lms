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
  type BehindPillTone,
  type ChapterStatus,
  type ChapterTestStatus,
  type HoursWindow,
} from "./curriculum-plan-rules";
import { query } from "./db";
import { EXAM_TRACKS, formatExamTrack } from "./exam-tracks";
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

export interface CurriculumSummaryQuery {
  // Narrows the user's scoped rows; it never widens scope.
  regions: string[];
  // Case-insensitive match on School name or code; "" = no search.
  schoolSearch: string;
  grade: CurriculumSummaryGrade;
  asOf: string;
  // Keeps rows with Behind ≥ 1; header numbers ignore it.
  onlyBehind: boolean;
  page: number;
  pageSize: number;
}

type SearchParamValue = string | string[] | undefined;

function firstValue(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// `regions` accepts repeated keys (the filter form) and comma-separated values.
function parseList(value: SearchParamValue): string[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return [...new Set(values.flatMap((item) => item.split(",")).map((item) => item.trim()))].filter(
    Boolean
  );
}

// Unknown or removed params (programs, subjects, tracks, date range, flags, sort) are ignored.
export function normalizeCurriculumSummarySearchParams(
  searchParams: Record<string, SearchParamValue>,
  todayIstDate: string
): CurriculumSummaryQuery {
  const page = Number.parseInt(firstValue(searchParams.page) ?? "1", 10);
  const pageSize = Number.parseInt(firstValue(searchParams.limit) ?? String(DEFAULT_PAGE_SIZE), 10);
  const asOf = firstValue(searchParams.as_of);
  return {
    regions: parseList(searchParams.regions),
    schoolSearch: (firstValue(searchParams.q) ?? "").trim(),
    grade: firstValue(searchParams.grade) === "12" ? 12 : 11,
    // Invalid dates, and years too far out to name an academic year (0999, 9999), mean today.
    asOf: asOf && isAcademicYearDate(asOf) ? asOf : todayIstDate,
    onlyBehind: ["1", "true"].includes(firstValue(searchParams.only_behind) ?? ""),
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
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
  behind: number;
  // Plan Chapters whose Chapter Test Status is Overdue; 0 for rows without a plan.
  testsOverdue: number;
  // Set only for No plan rows: Chapters with a Conducted Chapter Test.
  testsConducted: number | null;
}

export interface CurriculumSummaryHeader {
  centresOnPlan: number;
  centresTotal: number;
  chaptersBehind: number;
  testsOverdue: number;
}

export type CurriculumSummaryResult =
  | {
      ok: true;
      header: CurriculumSummaryHeader;
      // Regions of every scoped row for the Grade, before the Region / School search filters.
      regionOptions: string[];
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
  for (const check of [checkCurriculumSchema, checkCurriculumPlansSchema]) {
    const schema = await check();
    if (!schema.ok) return schema;
  }

  const scopedRows = (await loadSummaryClasses(permission, params)).map(buildSummaryRow);
  const regionOptions = [
    ...new Set(scopedRows.flatMap((row) => (row.region ? [row.region] : []))),
  ].sort();
  const search = params.schoolSearch.toLowerCase();
  const rows = sortSummaryRows(
    scopedRows.filter(
      (row) =>
        (params.regions.length === 0 || params.regions.includes(row.region ?? "")) &&
        (!search ||
          row.schoolName.toLowerCase().includes(search) ||
          row.schoolCode.toLowerCase().includes(search))
    )
  );

  const listedRows = params.onlyBehind ? rows.filter((row) => row.behind >= 1) : rows;

  const totalRows = listedRows.length;
  const totalPages = Math.ceil(totalRows / params.pageSize);
  const page = totalPages === 0 ? 1 : Math.min(params.page, totalPages);
  const offset = (page - 1) * params.pageSize;

  return {
    ok: true,
    header: summaryHeader(rows),
    regionOptions,
    rows: listedRows.slice(offset, offset + params.pageSize),
    pagination: { page, pageSize: params.pageSize, totalRows, totalPages },
  };
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
  const scopeSchools =
    permission.scope && permission.scope.schools !== "all"
      ? [...permission.scope.schools]
      : permission.level === 1
        ? permission.school_codes ?? []
        : null;
  return [
    permission.level === 3,
    scopeSchools && scopeSchools.length > 0 ? scopeSchools : null,
    permission.level === 2 ? permission.regions ?? [] : null,
    PHYSICAL_CENTRE_PROGRAM_IDS,
    permission.role === "admin",
    getProgramContextSync(permission).programIds,
  ];
}

// $7 Grade number, $8 academic year of as-of, $9 its 1 Apr, $10 as-of, $11 one Centre id (null
// = all). Every in-scope active physical JNV Centre with a Centre Exam Track for the Grade is
// one row; its Chapters are the Grade's in-syllabus Chapters for any mapped track, each with its
// plan due and test dates (only for an Active plan serving one of the Chapter's tracks) and its
// earliest Chapter Completion IST date within [1 Apr, as-of] under any mapped track.
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
      p.name AS program_name
    FROM centres c
    JOIN school s ON s.id = c.school_id
    JOIN program p ON p.id = c.program_id
    WHERE c.is_active = true
      AND c.is_physical = true
      AND s.af_school_category = 'JNV'
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
      ARRAY_AGG(DISTINCT cet.exam_track_code::text) AS mapped_tracks,
      (
        SELECT COUNT(*)
        FROM centres other
        WHERE other.school_id = sc.school_id
          AND other.program_id = sc.program_id
          AND other.is_active = true
          AND other.is_physical = true
      )::int AS centre_count
    FROM scoped_centres sc
    JOIN centre_exam_tracks cet ON cet.centre_id = sc.centre_id
    JOIN grade g ON g.id = cet.grade_id AND g.number = $7
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
  const mappedTracks = EXAM_TRACKS.filter((track) => raw.mapped_tracks.includes(track));
  const testStatusCount = (kind: ChapterTestStatus["kind"]) =>
    chapters.filter((chapter) => chapterTestStatusFor(data, chapter).kind === kind).length;
  const base = {
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
    behind: 0,
    testsOverdue: 0,
    testsConducted: null,
  };

  // Logs and completions are keyed by School + Program, so a second active physical Centre
  // there makes this Centre's progress ambiguous.
  if (Number(raw.centre_count) > 1) {
    return {
      ...base,
      kind: "configuration_error",
      explanation: "Multiple active physical Centres are configured for this School and Program",
    };
  }

  const summaryClass = classifySummaryClass(
    mappedTracks,
    chapters.flatMap((chapter) => chapter.tracks)
  );
  if (summaryClass.kind === "setup_error") {
    return { ...base, kind: "setup_error", explanation: "Fix tracks in Centre Management" };
  }
  if (summaryClass.kind === "no_content") {
    return { ...base, kind: "no_content", explanation: "Curriculum configuration is unavailable" };
  }
  if (raw.plan_id === null || raw.plan_status !== "active" || !raw.plan_title) {
    // Without plan dates no Chapter Test can be Overdue; show what was held instead.
    return { ...base, kind: "no_plan", explanation: null, testsConducted: testStatusCount("conducted") };
  }

  const subjects = Object.fromEntries(
    CURRICULUM_SUMMARY_SUBJECTS.map((subject) => [subject, subjectProgress(chapters, subject, asOf)])
  ) as Record<CurriculumSummarySubject, CurriculumSummarySubjectProgress | null>;

  return {
    ...base,
    kind: "plan",
    explanation: null,
    plan: {
      id: Number(raw.plan_id),
      title: raw.plan_title,
      closed:
        planStatusAsOf({ status: "active", closureDate: raw.plan_closure_date ?? asOf }, asOf) ===
        "closed",
    },
    subjects,
    behind: chapterProgress(chapters, asOf).behind,
    testsOverdue: testStatusCount("overdue"),
  };
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

function parseChapters(value: unknown): SummaryChapter[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((chapter: Record<string, unknown>) => ({
    chapterId: Number(chapter.chapterId),
    code: typeof chapter.code === "string" ? chapter.code : "",
    name: String(chapter.name),
    sequence: typeof chapter.sequence === "number" ? chapter.sequence : Number.MAX_SAFE_INTEGER,
    subject: chapter.subject === "Mathematics" ? "Maths" : String(chapter.subject),
    tracks: Array.isArray(chapter.tracks) ? chapter.tracks.map(String) : [],
    prescribedMinutes: parsePrescribedMinutes(chapter.prescribedMinutes),
    dueDate: typeof chapter.dueDate === "string" ? chapter.dueDate : null,
    testDate: typeof chapter.testDate === "string" ? chapter.testDate : null,
    completedOn: typeof chapter.completedOn === "string" ? chapter.completedOn : null,
  }));
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

// Worst first: plan rows by Behind desc then Tests overdue desc, then No-plan rows, then
// setup-error, no-content and configuration-error rows; Centre name breaks ties.
function sortSummaryRows(rows: CurriculumSummaryRow[]): CurriculumSummaryRow[] {
  return [...rows].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.behind - a.behind ||
      b.testsOverdue - a.testsOverdue ||
      a.centreName.localeCompare(b.centreName) ||
      a.centreId - b.centreId
  );
}

// Centres on plan = rows with an Active or Closed plan out of every row except setup-error and
// no-content rows; Chapters behind = Σ Behind; Chapter tests overdue = Σ Tests overdue. Covers
// all rows, not just the current page.
function summaryHeader(rows: CurriculumSummaryRow[]): CurriculumSummaryHeader {
  return {
    centresOnPlan: rows.filter((row) => row.kind === "plan").length,
    centresTotal: rows.filter((row) => row.kind !== "setup_error" && row.kind !== "no_content")
      .length,
    chaptersBehind: rows.reduce((sum, row) => sum + row.behind, 0),
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
  for (const check of [checkCurriculumSchema, checkCurriculumPlansSchema]) {
    const schema = await check();
    if (!schema.ok) return schema;
  }
  if (!Number.isInteger(centreId) || centreId <= 0) return { ok: false, status: 404 };

  const [data] = await loadSummaryClasses(permission, { ...params, centreId });
  if (!data) return { ok: false, status: 404 };

  const row = buildSummaryRow(data);
  const grades = await loadCentreGrades(centreId);
  const measured = row.kind === "plan" || row.kind === "no_plan";
  const chapters = measured ? data.chapters : [];
  const progress = chapterProgress(chapters, params.asOf);
  const summaryClass = classifySummaryClass(
    data.raw.mapped_tracks,
    chapters.flatMap((chapter) => chapter.tracks)
  );
  const classTracks =
    summaryClass.kind === "single" || summaryClass.kind === "shared" ? summaryClass.tracks : [];
  const activity = await loadTimelineActivity({
    schoolCode: data.raw.school_code,
    programId: Number(data.raw.program_id),
    grade: params.grade,
    tracks: classTracks,
    from: hoursWindowStart(params.hoursWindow, params.asOf),
    to: params.asOf,
    chapterIds: chapters.map((chapter) => chapter.chapterId),
  });
  const prescribedMinutes = (chapter: SummaryChapter) => {
    const track = primaryExamTrackForChapter(classTracks, chapter.tracks);
    return track ? chapter.prescribedMinutes[track] ?? 0 : 0;
  };
  const activityFor = (chapter: SummaryChapter) =>
    activity.get(chapter.chapterId) ?? { taughtMinutes: 0, cancellations: 0, doubtSolvingMinutes: 0 };
  const total = (value: (chapter: SummaryChapter) => number) =>
    chapters.reduce((sum, chapter) => sum + value(chapter), 0);

  return {
    ok: true,
    timeline: {
      grade: params.grade,
      grades,
      asOf: params.asOf,
      hoursWindow: params.hoursWindow,
      row,
      subjects: [...new Set(chapters.map((chapter) => chapter.subject))]
        .sort((a, b) => subjectRank(a) - subjectRank(b) || a.localeCompare(b))
        .map((subject) => ({
          subject,
          progress: row.kind === "plan" ? subjectProgress(chapters, subject, params.asOf) : null,
        })),
      chapters: [...chapters].sort(compareTimelineChapters).map((chapter) => ({
        chapterId: chapter.chapterId,
        code: chapter.code,
        name: chapter.name,
        subject: chapter.subject,
        dueDate: chapter.dueDate,
        completedOn: chapter.completedOn,
        status: chapterStatus({ dueDate: chapter.dueDate, completedOn: chapter.completedOn, asOf: params.asOf }),
        testStatus: chapterTestStatusFor(data, chapter),
        ...activityFor(chapter),
        prescribedMinutes: prescribedMinutes(chapter),
      })),
      header: {
        due: progress.due,
        done: progress.done,
        syllabusDone: chapters.filter((chapter) => chapter.completedOn !== null).length,
        syllabusTotal: chapters.length,
        testsOverdue: row.testsOverdue,
        taughtMinutes: total((chapter) => activityFor(chapter).taughtMinutes),
        prescribedMinutes: total(prescribedMinutes),
        cancellations: total((chapter) => activityFor(chapter).cancellations),
        doubtSolvingMinutes: total((chapter) => activityFor(chapter).doubtSolvingMinutes),
      },
    },
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
