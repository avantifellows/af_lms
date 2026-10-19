// Curriculum Plans (issue #417): Admin-authored plans that give the Chapters of their served
// Exam Tracks a Chapter Due Date (and optional Chapter Test Date) for one academic year and
// Grade. db-service owns the schema (ADR 0001); af_lms owns these reads, writes and
// validation. Date rules come from `curriculum-plan-rules.ts`.

import type { PoolClient } from "pg";

import { requireAdmin, type AdminSession } from "./admin-guard";
import { getTodayIST, isDateString } from "./curriculum-date-helpers";
import {
  CONTENT_EXAM_TRACKS,
  academicYearEndDate,
  academicYearStartDate,
  currentAcademicYearIST,
  parseAcademicYear,
  planStatusAsOf,
  shiftAcademicYearForward,
  shiftDateForwardOneYear,
  type CurriculumPlanDisplayStatus,
} from "./curriculum-plan-rules";
import {
  checkCurriculumPlansSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { query, withTransaction } from "./db";
import type { ExamTrack } from "./exam-tracks";

export type CurriculumPlanStatus = "draft" | "active";

export interface CurriculumPlanSummary {
  id: number;
  title: string;
  academicYear: string;
  grade: number;
  examTracks: ExamTrack[];
  status: CurriculumPlanStatus;
  // Draft / Active / Closed as of today IST; Closed is derived, never stored.
  displayStatus: CurriculumPlanDisplayStatus;
  closureDate: string;
  assignmentCount: number;
}

export interface CurriculumPlanChapter {
  chapterId: number;
  chapterCode: string;
  chapterName: string;
  subjectId: number;
  subjectName: string;
  dueDate: string | null;
  testDate: string | null;
}

export interface CurriculumPlanDetail extends CurriculumPlanSummary {
  chapters: CurriculumPlanChapter[];
}

export interface CurriculumPlanError {
  field: string;
  message: string;
  chapterId?: number;
  chapterName?: string;
}

export interface CurriculumPlanWarning {
  chapterId: number;
  chapterName: string;
  message: string;
}

export type CurriculumPlanValidationFailure = {
  ok: false;
  status: 400;
  error: string;
  errors: CurriculumPlanError[];
};

export type NotFound = { ok: false; status: 404; error: string };
export type Conflict = { ok: false; status: 409; error: string };

export type CurriculumPlanListResult =
  | { ok: true; plans: CurriculumPlanSummary[] }
  | CurriculumSchemaUnavailable;

export type CurriculumPlanGetResult =
  | { ok: true; plan: CurriculumPlanDetail }
  | CurriculumSchemaUnavailable
  | NotFound;

export type CurriculumPlanCreateResult =
  | { ok: true; plan: CurriculumPlanSummary }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable;

export interface CurriculumPlanMetadata {
  title: string;
  examTracks: ExamTrack[];
  academicYear: string;
  grade: number;
  closureDate: string;
}

// Every plan page and API uses the existing Admin guard. Reads stay bare so read-only
// Admins can view; mutating handlers pass `{ forWrite: true }`.
export function requireCurriculumPlanAdmin(
  session: AdminSession,
  opts?: { forWrite?: boolean }
) {
  return requireAdmin(session, opts);
}

export type Db = <T>(sql: string, params: unknown[]) => Promise<T[]>;

export function clientDb(client: PoolClient): Db {
  return async <T>(sql: string, params: unknown[]) =>
    (await client.query(sql, params)).rows as T[];
}

const poolDb: Db = (sql, params) => query(sql, params);

const PLAN_GRADES = [11, 12];
const TITLE_MAX_LENGTH = 200;

export function validationFailure(errors: CurriculumPlanError[]): CurriculumPlanValidationFailure {
  return { ok: false, status: 400, error: "Invalid Curriculum Plan", errors };
}

export function normalizeCurriculumPlanMetadata(
  body: unknown
): { ok: true; metadata: CurriculumPlanMetadata } | CurriculumPlanValidationFailure {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: CurriculumPlanError[] = [];

  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title) {
    errors.push({ field: "title", message: "Title is required" });
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.push({ field: "title", message: `Title must be at most ${TITLE_MAX_LENGTH} characters` });
  }

  const rawTracks = Array.isArray(input.exam_tracks) ? input.exam_tracks : [];
  const examTracks = CONTENT_EXAM_TRACKS.filter((track) => rawTracks.includes(track));
  if (rawTracks.length === 0) {
    errors.push({ field: "exam_tracks", message: "Choose at least one served Exam Track" });
  } else if (rawTracks.some((track) => !CONTENT_EXAM_TRACKS.includes(track as ExamTrack))) {
    errors.push({
      field: "exam_tracks",
      message: "Served Exam Tracks must be JEE Main, JEE Advanced or NEET",
    });
  }

  const academicYear = typeof input.academic_year === "string" ? input.academic_year.trim() : "";
  const academicYearValid = parseAcademicYear(academicYear) !== null;
  if (!academicYearValid) {
    errors.push({
      field: "academic_year",
      message: "Academic year must look like 2026-2027",
    });
  }

  const grade = Number(input.grade);
  if (!PLAN_GRADES.includes(grade)) {
    errors.push({ field: "grade", message: "Grade must be 11 or 12" });
  }

  const closureDate = typeof input.closure_date === "string" ? input.closure_date : "";
  if (!isDateString(closureDate)) {
    errors.push({ field: "closure_date", message: "Plan Closure Date must be a valid date" });
  } else if (
    academicYearValid &&
    (closureDate < academicYearStartDate(academicYear) ||
      closureDate > academicYearEndDate(academicYear))
  ) {
    errors.push({
      field: "closure_date",
      message: `Plan Closure Date must fall within academic year ${academicYear}`,
    });
  }

  if (errors.length > 0) return validationFailure(errors);
  return { ok: true, metadata: { title, examTracks, academicYear, grade, closureDate } };
}

interface PlanRow {
  id: string | number;
  title: string;
  academic_year: string;
  grade_id: string | number;
  grade: string | number;
  exam_tracks: string[];
  status: CurriculumPlanStatus;
  closure_date: string;
  assignment_count: string | number;
}

const PLAN_SELECT = `
  SELECT
    p.id,
    p.title,
    p.academic_year,
    p.grade_id,
    g.number AS grade,
    p.exam_tracks,
    p.status,
    p.closure_date::text AS closure_date,
    (
      SELECT COUNT(*)
      FROM lms_curriculum_plan_assignments a
      WHERE a.plan_id = p.id
    ) AS assignment_count
  FROM lms_curriculum_plans p
  JOIN grade g ON g.id = p.grade_id`;

function mapPlanRow(row: PlanRow): CurriculumPlanSummary {
  const closureDate = row.closure_date;
  return {
    id: Number(row.id),
    title: row.title,
    academicYear: row.academic_year,
    grade: Number(row.grade),
    examTracks: CONTENT_EXAM_TRACKS.filter((track) => row.exam_tracks.includes(track)),
    status: row.status,
    displayStatus: planStatusAsOf({ status: row.status, closureDate }, getTodayIST()),
    closureDate,
    assignmentCount: Number(row.assignment_count),
  };
}

export async function listCurriculumPlans(filters: {
  academicYear: string;
  grade: number | null;
}): Promise<CurriculumPlanListResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;

  const rows = await query<PlanRow>(
    `${PLAN_SELECT}
     WHERE p.academic_year = $1
       AND ($2::integer IS NULL OR g.number = $2::integer)
     ORDER BY g.number, p.title, p.id`,
    [filters.academicYear, filters.grade]
  );
  return { ok: true, plans: rows.map(mapPlanRow) };
}

interface ChapterRow {
  chapter_id: string | number;
  chapter_code: string | null;
  chapter_name: string;
  subject_id: string | number;
  subject_name: string;
  due_date: string | null;
  test_date: string | null;
}

// English Chapter name of chapter row `ch`, falling back to its code.
const CHAPTER_NAME_SQL = `COALESCE(
  (
    SELECT item->>'chapter'
    FROM jsonb_array_elements(ch.name::jsonb) item
    WHERE item->>'lang_code' = 'en'
    LIMIT 1
  ),
  ch.code,
  'Unknown chapter'
)`;

// The plan's effective Chapter list: in-syllabus LMS Chapter Exam Configs for the Grade and
// served tracks, one row per Chapter, by subject then lowest coverage sequence across the
// served tracks. Stored dates for Chapters that left the syllabus are kept in the table but
// not returned.
async function loadEffectiveChapters(
  db: Db,
  plan: { id: number | null; gradeId: number; examTracks: readonly string[] }
): Promise<CurriculumPlanChapter[]> {
  const rows = await db<ChapterRow>(
    `SELECT
       ch.id AS chapter_id,
       ch.code AS chapter_code,
       ${CHAPTER_NAME_SQL} AS chapter_name,
       s.id AS subject_id,
       COALESCE(
         (
           SELECT item->>'subject'
           FROM jsonb_array_elements(s.name::jsonb) item
           WHERE item->>'lang_code' = 'en'
           LIMIT 1
         ),
         'Unknown subject'
       ) AS subject_name,
       pc.due_date::text AS due_date,
       pc.test_date::text AS test_date
     FROM lms_chapter_exam_configs cfg
     JOIN chapter ch ON ch.id = cfg.chapter_id
     JOIN subject s ON s.id = ch.subject_id
     LEFT JOIN lms_curriculum_plan_chapters pc
       ON pc.plan_id = $1
      AND pc.chapter_id = ch.id
     WHERE cfg.is_in_syllabus = true
       AND ch.grade_id = $2
       AND cfg.exam_track = ANY($3::text[])
     GROUP BY ch.id, ch.code, ch.name, s.id, s.name, pc.due_date, pc.test_date
     ORDER BY s.id, MIN(cfg.coverage_sequence), ch.code, ch.id`,
    [plan.id, plan.gradeId, plan.examTracks]
  );
  return rows.map((row) => ({
    chapterId: Number(row.chapter_id),
    chapterCode: row.chapter_code ?? "",
    chapterName: row.chapter_name,
    subjectId: Number(row.subject_id),
    subjectName: row.subject_name,
    dueDate: row.due_date,
    testDate: row.test_date,
  }));
}

export async function getCurriculumPlan(id: number): Promise<CurriculumPlanGetResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;

  if (!Number.isInteger(id) || id <= 0) return planNotFound();
  const rows = await query<PlanRow>(`${PLAN_SELECT} WHERE p.id = $1`, [id]);
  const row = rows[0];
  if (!row) return planNotFound();

  const plan = mapPlanRow(row);
  const chapters = await loadEffectiveChapters(poolDb, {
    id: plan.id,
    gradeId: Number(row.grade_id),
    examTracks: plan.examTracks,
  });
  return { ok: true, plan: { ...plan, chapters } };
}

// The effective Chapter list a plan for this Grade and served tracks would have (no stored
// dates). Used by the one-time workbook seed before any plan exists.
export async function listEffectiveChaptersForGrade(
  grade: number,
  examTracks: readonly ExamTrack[]
): Promise<CurriculumPlanChapter[]> {
  const gradeId = await resolveGradeId(poolDb, grade);
  if (gradeId === null) return [];
  return loadEffectiveChapters(poolDb, { id: null, gradeId, examTracks });
}

export function planNotFound(): NotFound {
  return { ok: false, status: 404, error: "Curriculum Plan not found" };
}

async function resolveGradeId(db: Db, grade: number): Promise<number | null> {
  const rows = await db<{ id: string | number }>(
    "SELECT id FROM grade WHERE number = $1 ORDER BY id LIMIT 1",
    [grade]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

// New plans are stored as Draft.
export async function createCurriculumPlan(params: {
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumPlanCreateResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;

  const normalized = normalizeCurriculumPlanMetadata(params.body);
  if (!normalized.ok) return normalized;
  const metadata = normalized.metadata;

  return withTransaction(async (client) => {
    const db = clientDb(client);
    const created = await insertDraftPlan(db, metadata, params.adminEmail);
    if (!created.ok) return created;
    return { ok: true as const, plan: await readPlanSummary(db, created.id) };
  });
}

async function readPlanSummary(db: Db, id: number | string): Promise<CurriculumPlanSummary> {
  const rows = await db<PlanRow>(`${PLAN_SELECT} WHERE p.id = $1`, [id]);
  return mapPlanRow(rows[0]);
}

// Insert a Draft plan row; `gradeId` is the Grade's id (metadata carries its number).
async function insertPlanRow(
  db: Db,
  plan: Omit<CurriculumPlanMetadata, "grade"> & { gradeId: number | string },
  adminEmail: string
): Promise<number> {
  const inserted = await db<{ id: string | number }>(
    `INSERT INTO lms_curriculum_plans
       (title, academic_year, grade_id, exam_tracks, status, closure_date,
        inserted_by_email, updated_by_email, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4::text[], 'draft', $5::date, $6, $6,
             (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))
     RETURNING id`,
    [plan.title, plan.academicYear, plan.gradeId, plan.examTracks, plan.closureDate, adminEmail]
  );
  return Number(inserted[0].id);
}

async function insertDraftPlan(
  db: Db,
  metadata: CurriculumPlanMetadata,
  adminEmail: string
): Promise<{ ok: true; id: number } | CurriculumPlanValidationFailure> {
  const gradeId = await resolveGradeId(db, metadata.grade);
  if (gradeId === null) {
    return validationFailure([{ field: "grade", message: "Grade was not found" }]);
  }
  return { ok: true, id: await insertPlanRow(db, { ...metadata, gradeId }, adminEmail) };
}

export interface CurriculumPlanListFilters {
  academicYear: string;
  grade: number | null;
}

// Invalid input falls back to the defaults: the current IST academic year and all Grades.
export function normalizeCurriculumPlanListFilters(
  params: Record<string, string | undefined>
): CurriculumPlanListFilters {
  const academicYear = params.academic_year?.trim() ?? "";
  const grade = Number(params.grade);
  return {
    academicYear: parseAcademicYear(academicYear) ? academicYear : currentAcademicYearIST(),
    grade: PLAN_GRADES.includes(grade) ? grade : null,
  };
}

export type CurriculumPlanChapterDatesResult =
  | { ok: true; plan: CurriculumPlanDetail; warnings: CurriculumPlanWarning[] }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound;

interface ChapterDateInput {
  chapterId: number;
  dueDate: string | null;
  testDate: string | null;
}

function normalizeChapterDateInputs(
  body: unknown
): { ok: true; inputs: ChapterDateInput[] } | CurriculumPlanValidationFailure {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(input.chapters) || input.chapters.length === 0) {
    return validationFailure([{ field: "chapters", message: "No Chapter dates to save" }]);
  }
  const errors: CurriculumPlanError[] = [];
  const inputs: ChapterDateInput[] = [];
  const seen = new Set<number>();
  for (const raw of input.chapters) {
    const item = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const chapterId = Number(item.chapter_id);
    if (!Number.isInteger(chapterId) || chapterId <= 0 || seen.has(chapterId)) {
      errors.push({ field: "chapters", message: "Each Chapter must appear once with a valid id" });
      continue;
    }
    seen.add(chapterId);
    const dueDate = item.due_date == null || item.due_date === "" ? null : item.due_date;
    const testDate = item.test_date == null || item.test_date === "" ? null : item.test_date;
    if (
      (dueDate !== null && (typeof dueDate !== "string" || !isDateString(dueDate))) ||
      (testDate !== null && (typeof testDate !== "string" || !isDateString(testDate)))
    ) {
      errors.push({ field: "chapters", chapterId, message: "Dates must be valid YYYY-MM-DD dates" });
      continue;
    }
    inputs.push({ chapterId, dueDate: dueDate as string | null, testDate: testDate as string | null });
  }
  if (errors.length > 0) return validationFailure(errors);
  return { ok: true, inputs };
}

export interface LockedPlanRow {
  id: string | number;
  title: string;
  status: CurriculumPlanStatus;
  academic_year: string;
  grade_id: string | number;
  exam_tracks: string[];
  closure_date: string;
}

export async function lockPlan(db: Db, id: number): Promise<LockedPlanRow | null> {
  const rows = await db<LockedPlanRow>(
    `SELECT id, title, status, academic_year, grade_id, exam_tracks, closure_date::text AS closure_date
     FROM lms_curriculum_plans
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );
  return rows[0] ?? null;
}

// Every plan date must fall within the academic year and on or before the Plan Closure Date.
function planDateError(
  label: string,
  date: string | null,
  plan: { academic_year: string; closure_date: string }
): string | null {
  if (!date) return null;
  if (
    date < academicYearStartDate(plan.academic_year) ||
    date > academicYearEndDate(plan.academic_year)
  ) {
    return `${label} ${date} is outside academic year ${plan.academic_year}`;
  }
  if (date > plan.closure_date) {
    return `${label} ${date} is after the Plan Closure Date ${plan.closure_date}`;
  }
  return null;
}

// Lock the plan, validate every input against its effective Chapters and date rules, then
// upsert them. Nothing is written when any input is invalid.
async function applyChapterDates(
  db: Db,
  planId: number,
  inputs: ChapterDateInput[],
  adminEmail: string
): Promise<{ ok: true; warnings: CurriculumPlanWarning[] } | CurriculumPlanValidationFailure | NotFound> {
  const plan = await lockPlan(db, planId);
  if (!plan) return planNotFound();

  const chapters = await loadEffectiveChapters(db, {
    id: planId,
    gradeId: Number(plan.grade_id),
    examTracks: plan.exam_tracks,
  });
  const chaptersById = new Map(chapters.map((chapter) => [chapter.chapterId, chapter]));
  const checked = inputs.map((input) => checkChapterDateInput(input, chaptersById.get(input.chapterId), plan));
  const errors = checked.flatMap((item) => item.errors);
  if (errors.length > 0) return validationFailure(errors);

  for (const input of inputs) {
    await db(
      `INSERT INTO lms_curriculum_plan_chapters
         (plan_id, chapter_id, due_date, test_date,
          inserted_by_email, updated_by_email, inserted_at, updated_at)
       VALUES ($1, $2, $3::date, $4::date, $5, $5,
               (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC'))
       ON CONFLICT (plan_id, chapter_id) DO UPDATE SET
         due_date = EXCLUDED.due_date,
         test_date = EXCLUDED.test_date,
         updated_by_email = EXCLUDED.updated_by_email,
         updated_at = EXCLUDED.updated_at`,
      [planId, input.chapterId, input.dueDate, input.testDate, adminEmail]
    );
  }
  await db(
    `UPDATE lms_curriculum_plans
     SET updated_by_email = $2, updated_at = (NOW() AT TIME ZONE 'UTC')
     WHERE id = $1`,
    [planId, adminEmail]
  );
  return { ok: true, warnings: checked.flatMap((item) => item.warnings) };
}

// One Chapter's dates: errors (not an in-syllabus Chapter of the plan, outside the academic
// year, after closure, test without due) and the test-before-due warning.
function checkChapterDateInput(
  input: ChapterDateInput,
  chapter: CurriculumPlanChapter | undefined,
  plan: { academic_year: string; closure_date: string }
): { errors: CurriculumPlanError[]; warnings: CurriculumPlanWarning[] } {
  if (!chapter) {
    return {
      errors: [
        {
          field: "chapters",
          chapterId: input.chapterId,
          message: `Chapter ${input.chapterId} is not an in-syllabus Chapter of this plan`,
        },
      ],
      warnings: [],
    };
  }
  const named = { field: "chapters", chapterId: chapter.chapterId, chapterName: chapter.chapterName };
  const messages = [
    planDateError("Chapter Due Date", input.dueDate, plan),
    planDateError("Chapter Test Date", input.testDate, plan),
    input.testDate && !input.dueDate ? "Chapter Test Date needs a Chapter Due Date" : null,
  ].filter((message): message is string => message !== null);
  const testBeforeDue = Boolean(input.dueDate && input.testDate && input.testDate < input.dueDate);
  return {
    errors: messages.map((message) => ({ ...named, message })),
    warnings: testBeforeDue
      ? [
          {
            chapterId: chapter.chapterId,
            chapterName: chapter.chapterName,
            message: "Chapter Test Date is before its Chapter Due Date",
          },
        ]
      : [],
  };
}

// Batch upsert of Chapter Due / Test Dates. All-or-nothing: any invalid Chapter rejects the
// whole batch with per-Chapter errors. A test date before its due date is saved with a warning.
export async function saveCurriculumPlanChapterDates(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumPlanChapterDatesResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  const normalized = normalizeChapterDateInputs(params.body);
  if (!normalized.ok) return normalized;

  const outcome = await withTransaction((client) =>
    applyChapterDates(clientDb(client), params.id, normalized.inputs, params.adminEmail)
  );

  if (!outcome.ok) return outcome;
  const reloaded = await getCurriculumPlan(params.id);
  if (!reloaded.ok) return reloaded;
  return { ok: true, plan: reloaded.plan, warnings: outcome.warnings };
}

interface StoredChapterDateRow {
  chapter_id: string | number;
  chapter_name: string;
  due_date: string | null;
  test_date: string | null;
}

// Every dated row stored for the plan, whether or not its Chapter is on the effective list.
async function loadStoredChapterDates(db: Db, planId: number): Promise<StoredChapterDateRow[]> {
  return db<StoredChapterDateRow>(
    `SELECT
       pc.chapter_id,
       ${CHAPTER_NAME_SQL} AS chapter_name,
       pc.due_date::text AS due_date,
       pc.test_date::text AS test_date
     FROM lms_curriculum_plan_chapters pc
     JOIN chapter ch ON ch.id = pc.chapter_id
     WHERE pc.plan_id = $1
       AND (pc.due_date IS NOT NULL OR pc.test_date IS NOT NULL)
     ORDER BY ch.subject_id, ch.code, ch.id`,
    [planId]
  );
}

function storedDateErrors(
  rows: StoredChapterDateRow[],
  plan: { academic_year: string; closure_date: string }
): CurriculumPlanError[] {
  return rows.flatMap((row) =>
    (
      [
        ["Chapter Due Date", row.due_date],
        ["Chapter Test Date", row.test_date],
      ] as const
    ).flatMap(([label, date]) => {
      const message = planDateError(label, date, plan);
      return message
        ? [
            {
              field: "closure_date",
              chapterId: Number(row.chapter_id),
              chapterName: row.chapter_name,
              message,
            },
          ]
        : [];
    })
  );
}

export type CurriculumPlanUpdateResult =
  | { ok: true; plan: CurriculumPlanSummary }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound
  | Conflict;

// Update title, served tracks, academic year, Grade and Plan Closure Date. Every stored date of
// the plan must still fall within the academic year and on or before the closure date,
// including dates of Chapters hidden because they left the syllabus or the served tracks: they
// come back when the Chapter does. Academic year and Grade are locked while the plan has any
// Plan Assignment.
export async function updateCurriculumPlanMetadata(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumPlanUpdateResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  const normalized = normalizeCurriculumPlanMetadata(params.body);
  if (!normalized.ok) return normalized;
  const metadata = normalized.metadata;

  return withTransaction(async (client) => {
    const db = clientDb(client);
    const plan = await lockPlan(db, params.id);
    if (!plan) return planNotFound();

    const gradeId = await resolveGradeId(db, metadata.grade);
    if (gradeId === null) {
      return validationFailure([{ field: "grade", message: "Grade was not found" }]);
    }

    if (metadata.academicYear !== plan.academic_year || gradeId !== Number(plan.grade_id)) {
      const assigned = await db(
        "SELECT 1 FROM lms_curriculum_plan_assignments WHERE plan_id = $1 LIMIT 1",
        [params.id]
      );
      if (assigned.length > 0) {
        return {
          ok: false as const,
          status: 409 as const,
          error: "Academic year and Grade are locked while the plan has Plan Assignments",
        };
      }
    }

    const updated = { academic_year: metadata.academicYear, closure_date: metadata.closureDate };
    const errors = storedDateErrors(await loadStoredChapterDates(db, params.id), updated);
    if (errors.length > 0) return validationFailure(errors);

    await db(
      `UPDATE lms_curriculum_plans
       SET title = $2,
           academic_year = $3,
           grade_id = $4,
           exam_tracks = $5::text[],
           closure_date = $6::date,
           updated_by_email = $7,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1`,
      [
        params.id,
        metadata.title,
        metadata.academicYear,
        gradeId,
        metadata.examTracks,
        metadata.closureDate,
        params.adminEmail,
      ]
    );
    const rows = await db<PlanRow>(`${PLAN_SELECT} WHERE p.id = $1`, [params.id]);
    return { ok: true as const, plan: mapPlanRow(rows[0]) };
  });
}

export type CurriculumPlanActivateResult =
  | { ok: true; plan: CurriculumPlanSummary; warnings: CurriculumPlanWarning[] }
  | CurriculumSchemaUnavailable
  | NotFound
  | Conflict;

// Draft → Active. Undated in-syllabus Chapters don't block activation; they come back as
// warnings. There is no way back to Draft.
export async function activateCurriculumPlan(params: {
  id: number;
  adminEmail: string;
}): Promise<CurriculumPlanActivateResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  return withTransaction(async (client) => {
    const db = clientDb(client);
    const plan = await lockPlan(db, params.id);
    if (!plan) return planNotFound();
    if (plan.status !== "draft") {
      return { ok: false as const, status: 409 as const, error: "Only Draft plans can be activated" };
    }

    const chapters = await loadEffectiveChapters(db, {
      id: params.id,
      gradeId: Number(plan.grade_id),
      examTracks: plan.exam_tracks,
    });
    const warnings = chapters
      .filter((chapter) => !chapter.dueDate)
      .map((chapter) => ({
        chapterId: chapter.chapterId,
        chapterName: chapter.chapterName,
        message: "Chapter has no Chapter Due Date",
      }));

    await db(
      `UPDATE lms_curriculum_plans
       SET status = 'active',
           activated_at = (NOW() AT TIME ZONE 'UTC'),
           updated_by_email = $2,
           updated_at = (NOW() AT TIME ZONE 'UTC')
       WHERE id = $1`,
      [params.id, params.adminEmail]
    );
    const rows = await db<PlanRow>(`${PLAN_SELECT} WHERE p.id = $1`, [params.id]);
    return { ok: true as const, plan: mapPlanRow(rows[0]), warnings };
  });
}

export type CurriculumPlanDeleteResult =
  | { ok: true }
  | CurriculumSchemaUnavailable
  | NotFound
  | Conflict;

// Only Drafts can be deleted, whatever their closure date; the plan's Chapter dates and
// Plan Assignments go with it (ON DELETE CASCADE). A plan PMs have been measured against
// (Active or Closed) cannot disappear.
export async function deleteCurriculumPlan(params: {
  id: number;
}): Promise<CurriculumPlanDeleteResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  return withTransaction(async (client) => {
    const db = clientDb(client);
    const plan = await lockPlan(db, params.id);
    if (!plan) return planNotFound();
    if (plan.status !== "draft") {
      return { ok: false as const, status: 409 as const, error: "Only Draft plans can be deleted" };
    }
    await db("DELETE FROM lms_curriculum_plans WHERE id = $1", [params.id]);
    return { ok: true as const };
  });
}

export type CurriculumPlanCopyMode = "same_year" | "next_year";

const COPY_MODES: readonly CurriculumPlanCopyMode[] = ["same_year", "next_year"];

export type CurriculumPlanCopyResult =
  | { ok: true; plan: CurriculumPlanSummary }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound;

// Copy a plan as a same-year variant (dates kept) or as next year's starting point (academic
// year, Plan Closure Date and every Chapter date moved forward one year). The copy is titled
// "Copy of …", keeps the served tracks, Grade and dated Chapters, starts as a Draft and has no
// Plan Assignments. The source plan is untouched.
export async function copyCurriculumPlan(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<CurriculumPlanCopyResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  const input = (params.body && typeof params.body === "object" ? params.body : {}) as Record<
    string,
    unknown
  >;
  const mode = input.mode as CurriculumPlanCopyMode;
  if (!COPY_MODES.includes(mode)) {
    return validationFailure([
      { field: "mode", message: "Copy mode must be same_year or next_year" },
    ]);
  }

  return withTransaction(async (client) => {
    const db = clientDb(client);
    const plan = await lockPlan(db, params.id);
    if (!plan) return planNotFound();

    const storedChapters = await db<{
      chapter_id: string | number;
      due_date: string;
      test_date: string | null;
    }>(
      `SELECT chapter_id, due_date::text AS due_date, test_date::text AS test_date
       FROM lms_curriculum_plan_chapters
       WHERE plan_id = $1 AND due_date IS NOT NULL
       ORDER BY chapter_id`,
      [params.id]
    );

    const shift = (date: string) => (mode === "next_year" ? shiftDateForwardOneYear(date) : date);
    const title = `Copy of ${plan.title}`.slice(0, TITLE_MAX_LENGTH);
    const academicYear =
      mode === "next_year" ? shiftAcademicYearForward(plan.academic_year) : plan.academic_year;

    const copyId = await insertPlanRow(
      db,
      {
        title,
        academicYear,
        gradeId: plan.grade_id,
        examTracks: plan.exam_tracks as ExamTrack[],
        closureDate: shift(plan.closure_date),
      },
      params.adminEmail
    );

    if (storedChapters.length > 0) {
      await db(
        `INSERT INTO lms_curriculum_plan_chapters
           (plan_id, chapter_id, due_date, test_date,
            inserted_by_email, updated_by_email, inserted_at, updated_at)
         SELECT $1, chapter_id, due_date, test_date, $5, $5,
                (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC')
         FROM unnest($2::bigint[], $3::date[], $4::date[]) AS c(chapter_id, due_date, test_date)`,
        [
          copyId,
          storedChapters.map((chapter) => Number(chapter.chapter_id)),
          storedChapters.map((chapter) => shift(chapter.due_date)),
          storedChapters.map((chapter) => (chapter.test_date ? shift(chapter.test_date) : null)),
          params.adminEmail,
        ]
      );
    }

    return { ok: true as const, plan: await readPlanSummary(db, copyId) };
  });
}

export interface CurriculumPlanDraftInput {
  title: string;
  examTracks: readonly ExamTrack[];
  academicYear: string;
  grade: number;
  closureDate: string;
  chapters: ChapterDateInput[];
}

export type CurriculumPlanDraftsResult =
  | { ok: true; plans: { id: number; title: string; warnings: CurriculumPlanWarning[] }[] }
  | { ok: false; error: string };

class DraftRejected extends Error {}

function draftRejection(title: string, failure: CurriculumPlanValidationFailure | NotFound): string {
  const details =
    "errors" in failure
      ? failure.errors.map((e) => `${e.chapterName ?? e.chapterId ?? e.field}: ${e.message}`)
      : [];
  return [`Could not create "${title}": ${failure.error}`, ...details].join("; ");
}

// Create several Draft plans with their Chapter dates in one transaction, through the same
// validation as the plan editor: every plan is created, or none is (the one-time workbook
// seed, #425).
export async function createCurriculumPlanDrafts(params: {
  adminEmail: string;
  drafts: CurriculumPlanDraftInput[];
}): Promise<CurriculumPlanDraftsResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return { ok: false, error: `${schema.error}: ${schema.details.join("; ")}` };

  try {
    const plans = await withTransaction(async (client) => {
      const db = clientDb(client);
      const created: { id: number; title: string; warnings: CurriculumPlanWarning[] }[] = [];
      for (const draft of params.drafts) {
        created.push(await createDraftWithDates(db, draft, params.adminEmail));
      }
      return created;
    });
    return { ok: true, plans };
  } catch (error) {
    if (error instanceof DraftRejected) return { ok: false, error: error.message };
    throw error;
  }
}

// Throws DraftRejected (rolling the whole transaction back) when the draft is invalid.
async function createDraftWithDates(
  db: Db,
  draft: CurriculumPlanDraftInput,
  adminEmail: string
): Promise<{ id: number; title: string; warnings: CurriculumPlanWarning[] }> {
  const normalized = normalizeCurriculumPlanMetadata({
    title: draft.title,
    exam_tracks: draft.examTracks,
    academic_year: draft.academicYear,
    grade: draft.grade,
    closure_date: draft.closureDate,
  });
  if (!normalized.ok) throw new DraftRejected(draftRejection(draft.title, normalized));
  const created = await insertDraftPlan(db, normalized.metadata, adminEmail);
  if (!created.ok) throw new DraftRejected(draftRejection(draft.title, created));
  if (draft.chapters.length === 0) return { id: created.id, title: draft.title, warnings: [] };

  const inputs = normalizeChapterDateInputs({
    chapters: draft.chapters.map((chapter) => ({
      chapter_id: chapter.chapterId,
      due_date: chapter.dueDate,
      test_date: chapter.testDate,
    })),
  });
  if (!inputs.ok) throw new DraftRejected(draftRejection(draft.title, inputs));
  const dated = await applyChapterDates(db, created.id, inputs.inputs, adminEmail);
  if (!dated.ok) throw new DraftRejected(draftRejection(draft.title, dated));
  return { id: created.id, title: draft.title, warnings: dated.warnings };
}
