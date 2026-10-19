// Curriculum Summary v2 (#417): one row per Summary Class (Centre + Grade) measured against its
// Curriculum Plan. One set-based SQL pass loads the whole bounded row set for the user's scope;
// classification, Due / Done / Behind, header numbers, sort and pagination are computed here
// with the shared rules in `curriculum-plan-rules`.

import {
  checkCurriculumPlansSchema,
  checkCurriculumSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { isDateString } from "./curriculum-date-helpers";
import {
  academicYearForDate,
  academicYearStartDate,
  behindPill,
  chapterProgress,
  classifySummaryClass,
  planStatusAsOf,
  type BehindPillTone,
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
  grade: CurriculumSummaryGrade;
  asOf: string;
  page: number;
  pageSize: number;
}

// Unknown or removed params (programs, subjects, tracks, date range, flags, sort) are ignored.
export function normalizeCurriculumSummarySearchParams(
  searchParams: Record<string, string | undefined>,
  todayIstDate: string
): CurriculumSummaryQuery {
  const page = Number.parseInt(searchParams.page ?? "1", 10);
  const pageSize = Number.parseInt(searchParams.limit ?? String(DEFAULT_PAGE_SIZE), 10);
  const asOf = searchParams.as_of;
  return {
    grade: searchParams.grade === "12" ? 12 : 11,
    asOf: asOf && isDateString(asOf) ? asOf : todayIstDate,
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
}

export interface CurriculumSummaryHeader {
  centresOnPlan: number;
  centresTotal: number;
  chaptersBehind: number;
}

export type CurriculumSummaryResult =
  | {
      ok: true;
      header: CurriculumSummaryHeader;
      rows: CurriculumSummaryRow[];
      pagination: { page: number; pageSize: number; totalRows: number; totalPages: number };
    }
  | CurriculumSchemaUnavailable;

interface SummaryChapter {
  subject: string;
  tracks: string[];
  dueDate: string | null;
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

  const academicYear = academicYearForDate(params.asOf);
  const rawRows = await query<SummaryQueryRow>(SUMMARY_SQL, [
    ...scopeParams(permission),
    params.grade,
    academicYear,
    academicYearStartDate(academicYear),
    params.asOf,
  ]);
  const rows = sortSummaryRows(rawRows.map((row) => buildSummaryRow(row, params.asOf)));

  const totalRows = rows.length;
  const totalPages = Math.ceil(totalRows / params.pageSize);
  const page = totalPages === 0 ? 1 : Math.min(params.page, totalPages);
  const offset = (page - 1) * params.pageSize;

  return {
    ok: true,
    header: summaryHeader(rows),
    rows: rows.slice(offset, offset + params.pageSize),
    pagination: { page, pageSize: params.pageSize, totalRows, totalPages },
  };
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

// $7 Grade number, $8 academic year of as-of, $9 its 1 Apr, $10 as-of. Every in-scope active
// physical JNV Centre with a Centre Exam Track for the Grade is one row; its Chapters are the
// Grade's in-syllabus Chapters for any mapped track, each with its plan due date (only for an
// Active plan serving one of the Chapter's tracks) and its earliest Chapter Completion IST date
// within [1 Apr, as-of] under any mapped track.
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
      COALESCE(
        (
          SELECT item->>'subject'
          FROM jsonb_array_elements(s.name::jsonb) item
          WHERE item->>'lang_code' = 'en'
          LIMIT 1
        ),
        'Unknown subject'
      ) AS subject_name,
      ARRAY_AGG(DISTINCT cfg.exam_track::text) AS tracks
    FROM lms_chapter_exam_configs cfg
    JOIN chapter ch ON ch.id = cfg.chapter_id
    JOIN grade g ON g.id = ch.grade_id AND g.number = $7
    JOIN subject s ON s.id = ch.subject_id
    WHERE cfg.is_in_syllabus = true
    GROUP BY ch.id, s.name
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
      gc.subject_name,
      gc.tracks,
      CASE
        WHEN ap.status = 'active' AND ap.exam_tracks && gc.tracks THEN pc.due_date
      END AS due_date,
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
          'subject', cch.subject_name,
          'tracks', cch.tracks,
          'dueDate', cch.due_date::text,
          'completedOn', cch.completed_on::text
        ))
        FROM centre_chapters cch
        WHERE cch.centre_id = m.centre_id
      ),
      '[]'::jsonb
    ) AS chapters
  FROM mapped m
  LEFT JOIN assigned_plans ap ON ap.centre_id = m.centre_id`;

function buildSummaryRow(raw: SummaryQueryRow, asOf: string): CurriculumSummaryRow {
  const mappedTracks = EXAM_TRACKS.filter((track) => raw.mapped_tracks.includes(track));
  const chapters = parseChapters(raw.chapters);
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
    return { ...base, kind: "no_plan", explanation: null };
  }

  const subjects = Object.fromEntries(
    CURRICULUM_SUMMARY_SUBJECTS.map((subject) => {
      const subjectChapters = chapters.filter((chapter) => chapter.subject === subject);
      if (subjectChapters.length === 0) return [subject, null];
      const progress = chapterProgress(subjectChapters, asOf);
      return [subject, { ...progress, ...behindPill(progress.behind) }];
    })
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
  };
}

function parseChapters(value: unknown): SummaryChapter[] {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.map((chapter: Record<string, unknown>) => ({
    subject: chapter.subject === "Mathematics" ? "Maths" : String(chapter.subject),
    tracks: Array.isArray(chapter.tracks) ? chapter.tracks.map(String) : [],
    dueDate: typeof chapter.dueDate === "string" ? chapter.dueDate : null,
    completedOn: typeof chapter.completedOn === "string" ? chapter.completedOn : null,
  }));
}

const KIND_ORDER: Record<CurriculumSummaryRowKind, number> = {
  plan: 0,
  no_plan: 1,
  setup_error: 2,
  no_content: 3,
  configuration_error: 4,
};

// Worst first: plan rows by Behind desc, then No-plan rows, then setup-error, no-content and
// configuration-error rows; Centre name breaks ties.
function sortSummaryRows(rows: CurriculumSummaryRow[]): CurriculumSummaryRow[] {
  return [...rows].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      b.behind - a.behind ||
      a.centreName.localeCompare(b.centreName) ||
      a.centreId - b.centreId
  );
}

// Centres on plan = rows with an Active or Closed plan out of every row except setup-error and
// no-content rows; Chapters behind = Σ Behind. Covers all rows, not just the current page.
function summaryHeader(rows: CurriculumSummaryRow[]): CurriculumSummaryHeader {
  return {
    centresOnPlan: rows.filter((row) => row.kind === "plan").length,
    centresTotal: rows.filter((row) => row.kind !== "setup_error" && row.kind !== "no_content")
      .length,
    chaptersBehind: rows.reduce((sum, row) => sum + row.behind, 0),
  };
}
