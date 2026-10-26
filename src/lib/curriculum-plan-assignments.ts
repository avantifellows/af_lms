// Plan Assignments (issue #417): the link that makes one Curriculum Plan the plan for one
// Centre and Grade. Exactly one plan per Centre + Grade + academic year, whatever the plan's
// status; assignment rows copy the academic year and Grade from their plan so the unique
// constraint enforces it. Kept apart from plan CRUD (`curriculum-plans.ts`) so assignment by
// Centre can extend it.

import { getTodayIST } from "./curriculum-date-helpers";
import {
  parseAcademicYear,
  planStatusAsOf,
  uncoveredExamTracks,
  type CurriculumPlanDisplayStatus,
} from "./curriculum-plan-rules";
import {
  clientDb,
  listCurriculumPlans,
  lockPlan,
  planNotFound,
  validationFailure,
  type Conflict,
  type CurriculumPlanValidationFailure,
  type CurriculumPlanStatus,
  type CurriculumPlanSummary,
  type Db,
  type LockedPlanRow,
  type NotFound,
} from "./curriculum-plans";
import {
  checkCurriculumPlansSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { query, withTransaction } from "./db";
import {
  ELIGIBLE_CENTRE_SQL,
  ELIGIBLE_CENTRE_TRACKS_FROM_SQL,
  loadTracksWithContent,
} from "./curriculum-eligible-centres";
import type { ExamTrack } from "./exam-tracks";

export interface AssignedPlan {
  id: number;
  title: string;
}

// An eligible Centre for a plan: an active physical Centre at a JNV School with at least one
// Centre Exam Track mapped for the plan's Grade.
export interface EligibleCentre {
  centreId: number;
  centreName: string;
  schoolName: string;
  schoolCode: string;
  region: string;
  programName: string | null;
  mappedTracks: string[];
  // Mapped tracks the plan can't measure: not served by the plan, or without content.
  uncoveredTracks: ExamTrack[];
  // The plan this Centre + Grade is assigned to for the plan's academic year, if any.
  currentPlan: AssignedPlan | null;
}

export interface PlanAssignmentPreviewCentre {
  centreId: number;
  centreName: string;
  currentPlan: AssignedPlan | null;
  moves: boolean;
  uncoveredTracks: ExamTrack[];
}

// A Centre on this plan that the save takes off it: unticked, or no longer eligible (it can't
// be ticked, so saving always removes it).
export interface PlanAssignmentRemovedCentre {
  centreId: number;
  centreName: string;
  eligible: boolean;
}

export interface PlanAssignmentPreview {
  centres: PlanAssignmentPreviewCentre[];
  // Ticked Centres currently on another plan for the same Grade + academic year.
  moveCount: number;
  // Centres assigned to this plan that the save removes (= removedCentres.length).
  removeCount: number;
  removedCentres: PlanAssignmentRemovedCentre[];
}

export type PlanAssignmentCentresResult =
  | {
      ok: true;
      plan: { id: number; title: string; academicYear: string; grade: number };
      centres: EligibleCentre[];
    }
  | CurriculumSchemaUnavailable
  | NotFound;

export type PlanAssignmentPreviewResult =
  | { ok: true; preview: PlanAssignmentPreview }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound;

export type PlanAssignmentSaveResult =
  | { ok: true; assignedCount: number; added: number; moved: number; removed: number }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound
  | Conflict;

interface EligibleCentreRow {
  centre_id: string | number;
  centre_name: string;
  school_name: string;
  school_code: string;
  region: string | null;
  program_name: string | null;
  mapped_tracks: string[];
  current_plan_id: string | number | null;
  current_plan_title: string | null;
}

async function loadEligibleCentres(db: Db, plan: LockedPlanRow): Promise<EligibleCentre[]> {
  const [rows, contentByGrade] = await Promise.all([
    db<EligibleCentreRow>(
      `SELECT
         c.id AS centre_id,
         c.name AS centre_name,
         s.name AS school_name,
         s.code AS school_code,
         s.region,
         p.name AS program_name,
         array_agg(DISTINCT cet.exam_track_code ORDER BY cet.exam_track_code) AS mapped_tracks,
         a.plan_id AS current_plan_id,
         cp.title AS current_plan_title
       FROM ${ELIGIBLE_CENTRE_TRACKS_FROM_SQL}
       LEFT JOIN program p ON p.id = c.program_id
       LEFT JOIN lms_curriculum_plan_assignments a
         ON a.centre_id = c.id
        AND a.grade_id = $1
        AND a.academic_year = $2
       LEFT JOIN lms_curriculum_plans cp ON cp.id = a.plan_id
       WHERE ${ELIGIBLE_CENTRE_SQL}
         AND cet.grade_id = $1
       GROUP BY c.id, c.name, s.name, s.code, s.region, p.name, a.plan_id, cp.title
       ORDER BY s.region NULLS LAST, s.name, c.name, c.id`,
      [plan.grade_id, plan.academic_year]
    ),
    loadTracksWithContent(db, { gradeIds: [Number(plan.grade_id)] }),
  ]);
  // Filtered to the plan's one Grade, so every track listed belongs to it.
  const tracksWithContent = [...contentByGrade.values()].flat();
  return rows.map((row) => ({
    centreId: Number(row.centre_id),
    centreName: row.centre_name,
    schoolName: row.school_name,
    schoolCode: row.school_code,
    region: row.region ?? "",
    programName: row.program_name,
    mappedTracks: row.mapped_tracks,
    uncoveredTracks: uncoveredExamTracks(row.mapped_tracks, plan.exam_tracks, tracksWithContent),
    currentPlan:
      row.current_plan_id === null
        ? null
        : { id: Number(row.current_plan_id), title: row.current_plan_title ?? "" },
  }));
}

async function readPlan(db: Db, id: number): Promise<LockedPlanRow | null> {
  const rows = await db<LockedPlanRow>(
    `SELECT id, title, status, academic_year, grade_id, exam_tracks, closure_date::text AS closure_date
     FROM lms_curriculum_plans
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

const poolDb: Db = (sql, params) => query(sql, params);

export async function listPlanAssignmentCentres(planId: number): Promise<PlanAssignmentCentresResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(planId) || planId <= 0) return planNotFound();

  const plan = await readPlan(poolDb, planId);
  if (!plan) return planNotFound();
  const [grade] = await poolDb<{ number: string | number }>(
    "SELECT number FROM grade WHERE id = $1",
    [plan.grade_id]
  );
  return {
    ok: true,
    plan: {
      id: Number(plan.id),
      title: plan.title,
      academicYear: plan.academic_year,
      grade: Number(grade?.number),
    },
    centres: await loadEligibleCentres(poolDb, plan),
  };
}

function normalizeCentreIds(
  body: unknown
): { ok: true; centreIds: number[] } | CurriculumPlanValidationFailure {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!Array.isArray(input.centre_ids)) {
    return validationFailure([{ field: "centre_ids", message: "centre_ids must be a list of Centre ids" }]);
  }
  const centreIds = input.centre_ids.map(Number);
  if (centreIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return validationFailure([{ field: "centre_ids", message: "centre_ids must be a list of Centre ids" }]);
  }
  return { ok: true, centreIds: [...new Set(centreIds)] };
}

// The Centres currently assigned to the plan, eligible or not.
async function loadAssignedCentres(
  db: Db,
  planId: number
): Promise<{ centreId: number; centreName: string }[]> {
  const rows = await db<{ centre_id: string | number; assigned_centre_name: string | null }>(
    `SELECT a.centre_id, c.name AS assigned_centre_name
     FROM lms_curriculum_plan_assignments a
     LEFT JOIN centres c ON c.id = a.centre_id
     WHERE a.plan_id = $1
     ORDER BY c.name, a.centre_id`,
    [planId]
  );
  return rows.map((row) => ({
    centreId: Number(row.centre_id),
    centreName: row.assigned_centre_name ?? `Centre ${row.centre_id}`,
  }));
}

function removedCentres(
  assigned: { centreId: number; centreName: string }[],
  eligibleIds: Set<number>,
  ticked: Set<number>
): PlanAssignmentRemovedCentre[] {
  return assigned
    .filter((centre) => !ticked.has(centre.centreId))
    .map((centre) => ({ ...centre, eligible: eligibleIds.has(centre.centreId) }));
}

// Ticked Centres must all be eligible for the plan; an unknown or ineligible Centre rejects
// the whole request.
function previewAgainst(
  planId: number,
  eligible: EligibleCentre[],
  assigned: { centreId: number; centreName: string }[],
  centreIds: number[]
): { ok: true; preview: PlanAssignmentPreview } | CurriculumPlanValidationFailure {
  const byId = new Map(eligible.map((centre) => [centre.centreId, centre]));
  const ineligible = centreIds.filter((id) => !byId.has(id));
  if (ineligible.length > 0) {
    return validationFailure(
      ineligible.map((id) => ({
        field: "centre_ids",
        message: `Centre ${id} is not an eligible Centre for this plan`,
      }))
    );
  }
  const ticked = new Set(centreIds);
  const centres = centreIds.map((id) => {
    const centre = byId.get(id)!;
    return {
      centreId: centre.centreId,
      centreName: centre.centreName,
      currentPlan: centre.currentPlan,
      moves: centre.currentPlan !== null && centre.currentPlan.id !== planId,
      uncoveredTracks: centre.uncoveredTracks,
    };
  });
  const removed = removedCentres(assigned, new Set(byId.keys()), ticked);
  return {
    ok: true,
    preview: {
      centres,
      moveCount: centres.filter((centre) => centre.moves).length,
      removeCount: removed.length,
      removedCentres: removed,
    },
  };
}

// Shared prelude of preview and save by plan: schema, plan id and the ticked Centre ids.
async function prepareByPlan(params: {
  id: number;
  body: unknown;
}): Promise<
  | { ok: true; centreIds: number[] }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound
> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();
  return normalizeCentreIds(params.body);
}

export async function previewPlanAssignment(params: {
  id: number;
  body: unknown;
}): Promise<PlanAssignmentPreviewResult> {
  const normalized = await prepareByPlan(params);
  if (!normalized.ok) return normalized;

  const plan = await readPlan(poolDb, params.id);
  if (!plan) return planNotFound();
  const [eligible, assigned] = await Promise.all([
    loadEligibleCentres(poolDb, plan),
    loadAssignedCentres(poolDb, params.id),
  ]);
  return previewAgainst(params.id, eligible, assigned, normalized.centreIds);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

// Save the plan's assignments as exactly the ticked Centres. In one transaction with the plan
// row locked: ticked Centres on another plan for the same Grade + academic year move here,
// new Centres are added, and unticked Centres lose their assignment (including Centres no
// longer eligible, which the preview names). Moves are recomputed here, never trusted from
// the client.
export async function savePlanAssignmentByPlan(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<PlanAssignmentSaveResult> {
  const normalized = await prepareByPlan(params);
  if (!normalized.ok) return normalized;
  const centreIds = normalized.centreIds;

  try {
    return await withTransaction(async (client) => {
      const db = clientDb(client);
      const plan = await lockPlan(db, params.id);
      if (!plan) return planNotFound();

      const checked = previewAgainst(
        params.id,
        await loadEligibleCentres(db, plan),
        await loadAssignedCentres(db, params.id),
        centreIds
      );
      if (!checked.ok) return checked;

      // Assignment rows carry the plan's academic year and Grade; with the plan locked they
      // cannot drift, so a mismatch means stale data and nothing is written.
      const mismatched = await db(
        `SELECT 1
         FROM lms_curriculum_plan_assignments
         WHERE plan_id = $1
           AND (grade_id <> $2 OR academic_year <> $3)
         LIMIT 1`,
        [params.id, plan.grade_id, plan.academic_year]
      );
      if (mismatched.length > 0) {
        return {
          ok: false as const,
          status: 409 as const,
          error: "Plan Assignments do not match the plan's academic year and Grade",
        };
      }

      const removed = await db(
        `DELETE FROM lms_curriculum_plan_assignments
         WHERE plan_id = $1
           AND NOT (centre_id = ANY($2::bigint[]))
         RETURNING id`,
        [params.id, centreIds]
      );
      const moved = await db(
        `DELETE FROM lms_curriculum_plan_assignments
         WHERE centre_id = ANY($1::bigint[])
           AND grade_id = $2
           AND academic_year = $3
           AND plan_id <> $4
         RETURNING id`,
        [centreIds, plan.grade_id, plan.academic_year, params.id]
      );
      const added = await db(
        `INSERT INTO lms_curriculum_plan_assignments
           (plan_id, centre_id, grade_id, academic_year,
            inserted_by_email, updated_by_email, inserted_at, updated_at)
         SELECT $1, ticked.centre_id, $3, $4, $5, $5,
                (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC')
         FROM unnest($2::bigint[]) AS ticked(centre_id)
         WHERE NOT EXISTS (
           SELECT 1
           FROM lms_curriculum_plan_assignments a
           WHERE a.plan_id = $1
             AND a.centre_id = ticked.centre_id
         )
         RETURNING id`,
        [params.id, centreIds, plan.grade_id, plan.academic_year, params.adminEmail]
      );
      return {
        ok: true as const,
        assignedCount: centreIds.length,
        added: added.length,
        moved: moved.length,
        removed: removed.length,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: "A Centre was assigned to another plan at the same time; reload and try again",
      };
    }
    throw error;
  }
}

// Centre coverage: for one academic year, every Centre that is eligible for a Grade 11 or
// Grade 12 plan, with its assigned plan per Grade. A Grade the Centre doesn't run (no Centre
// Exam Track mapped) is null, shown as not applicable.
const COVERAGE_GRADES = [11, 12] as const;
export type CoverageGrade = (typeof COVERAGE_GRADES)[number];

export interface CoveragePlan {
  id: number;
  title: string;
  displayStatus: CurriculumPlanDisplayStatus;
}

export interface CentreCoverageGrade {
  mappedTracks: string[];
  // The plan assigned for this Centre + Grade + academic year, whatever its status.
  plan: CoveragePlan | null;
  // Mapped tracks the assigned plan can't measure; empty when there is no plan.
  uncoveredTracks: ExamTrack[];
}

export interface CentreCoverageRow {
  centreId: number;
  centreName: string;
  schoolName: string;
  region: string;
  programName: string | null;
  grades: Record<CoverageGrade, CentreCoverageGrade | null>;
}

export type CentreCoverageResult =
  | {
      ok: true;
      academicYear: string;
      centres: CentreCoverageRow[];
      // The academic year's plans, offered per Grade when assigning by Centre.
      plans: CurriculumPlanSummary[];
    }
  | CurriculumSchemaUnavailable;

interface CoverageRow {
  centre_id: string | number;
  centre_name: string;
  school_name: string;
  region: string | null;
  program_name: string | null;
  grade: string | number;
  mapped_tracks: string[];
  plan_id: string | number | null;
  plan_title: string | null;
  plan_status: CurriculumPlanStatus | null;
  plan_closure_date: string | null;
  plan_exam_tracks: string[] | null;
}

export async function listCentreCoverage(academicYear: string): Promise<CentreCoverageResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;

  const [rows, contentByGrade, plans] = await Promise.all([
    query<CoverageRow>(
      `SELECT
         c.id AS centre_id,
         c.name AS centre_name,
         s.name AS school_name,
         s.region,
         p.name AS program_name,
         g.number AS grade,
         array_agg(DISTINCT cet.exam_track_code ORDER BY cet.exam_track_code) AS mapped_tracks,
         a.plan_id,
         cp.title AS plan_title,
         cp.status AS plan_status,
         cp.closure_date::text AS plan_closure_date,
         cp.exam_tracks AS plan_exam_tracks
       FROM ${ELIGIBLE_CENTRE_TRACKS_FROM_SQL}
       JOIN grade g ON g.id = cet.grade_id AND g.number = ANY($2::integer[])
       LEFT JOIN program p ON p.id = c.program_id
       LEFT JOIN lms_curriculum_plan_assignments a
         ON a.centre_id = c.id
        AND a.academic_year = $1
        AND a.grade_id IN (SELECT ag.id FROM grade ag WHERE ag.number = g.number)
       LEFT JOIN lms_curriculum_plans cp ON cp.id = a.plan_id
       WHERE ${ELIGIBLE_CENTRE_SQL}
       GROUP BY c.id, c.name, s.name, s.region, p.name, g.number,
                a.plan_id, cp.title, cp.status, cp.closure_date, cp.exam_tracks
       ORDER BY s.region NULLS LAST, s.name, c.name, c.id, g.number`,
      [academicYear, COVERAGE_GRADES]
    ),
    loadTracksWithContent(poolDb, { gradeNumbers: COVERAGE_GRADES }),
    listCurriculumPlans({ academicYear, grade: null }),
  ]);
  if (!plans.ok) return plans;

  return {
    ok: true,
    academicYear,
    centres: groupCoverageRows(rows, contentByGrade, getTodayIST()),
    plans: plans.plans,
  };
}

// One Centre + Grade's coverage: its assigned plan (if any) and the mapped tracks that plan
// can't measure.
function coverageGrade(
  row: CoverageRow,
  tracksWithContent: string[],
  today: string
): CentreCoverageGrade {
  if (row.plan_id === null) return { mappedTracks: row.mapped_tracks, plan: null, uncoveredTracks: [] };
  return {
    mappedTracks: row.mapped_tracks,
    plan: {
      id: Number(row.plan_id),
      title: row.plan_title ?? "",
      displayStatus: planStatusAsOf(
        { status: row.plan_status ?? "draft", closureDate: row.plan_closure_date ?? "" },
        today
      ),
    },
    uncoveredTracks: uncoveredExamTracks(row.mapped_tracks, row.plan_exam_tracks ?? [], tracksWithContent),
  };
}

// The query returns one row per Centre + Grade; fold them into one row per Centre.
function groupCoverageRows(
  rows: CoverageRow[],
  contentByGrade: Map<number, string[]>,
  today: string
): CentreCoverageRow[] {
  const centres = new Map<number, CentreCoverageRow>();
  for (const row of rows) {
    const centreId = Number(row.centre_id);
    const grade = Number(row.grade) as CoverageGrade;
    const centre = centres.get(centreId) ?? {
      centreId,
      centreName: row.centre_name,
      schoolName: row.school_name,
      region: row.region ?? "",
      programName: row.program_name,
      grades: { 11: null, 12: null },
    };
    centres.set(centreId, centre);
    centre.grades[grade] = coverageGrade(row, contentByGrade.get(grade) ?? [], today);
  }
  return [...centres.values()];
}

export interface CentrePlanAssignment {
  grade: CoverageGrade;
  // null removes the Centre + Grade's assignment for the academic year.
  planId: number | null;
}

export type CentrePlanAssignmentSaveResult =
  | { ok: true; assignments: CentrePlanAssignment[] }
  | CurriculumPlanValidationFailure
  | CurriculumSchemaUnavailable
  | NotFound
  | Conflict;

const ASSIGNMENTS_MESSAGE =
  "assignments must list Grade 11 or 12 at most once each, with a plan id or null";

// One `{ grade, plan_id }` entry: Grade 11 or 12 not already listed, and a positive plan id or
// null. Anything else is null.
function parseCentrePlanAssignment(
  item: unknown,
  listed: CentrePlanAssignment[]
): CentrePlanAssignment | null {
  const entry = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
  const grade = Number(entry.grade) as CoverageGrade;
  const planId = entry.plan_id === null ? null : Number(entry.plan_id);
  const gradeValid =
    COVERAGE_GRADES.includes(grade) && !listed.some((assignment) => assignment.grade === grade);
  const planValid = planId === null || (Number.isInteger(planId) && planId > 0);
  return gradeValid && planValid ? { grade, planId } : null;
}

// The whole list, or null when it is empty or any entry is invalid.
function parseCentrePlanAssignments(value: unknown): CentrePlanAssignment[] | null {
  const raw = Array.isArray(value) ? value : [];
  if (raw.length === 0) return null;
  const assignments: CentrePlanAssignment[] = [];
  for (const item of raw) {
    const assignment = parseCentrePlanAssignment(item, assignments);
    if (!assignment) return null;
    assignments.push(assignment);
  }
  return assignments;
}

function normalizeCentrePlanAssignments(
  body: unknown
):
  | { ok: true; academicYear: string; assignments: CentrePlanAssignment[] }
  | CurriculumPlanValidationFailure {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const errors: { field: string; message: string }[] = [];

  const academicYear = typeof input.academic_year === "string" ? input.academic_year.trim() : "";
  if (parseAcademicYear(academicYear) === null) {
    errors.push({ field: "academic_year", message: "Academic year must look like 2026-2027" });
  }
  const assignments = parseCentrePlanAssignments(input.assignments);
  if (!assignments) errors.push({ field: "assignments", message: ASSIGNMENTS_MESSAGE });

  if (errors.length > 0 || !assignments) return validationFailure(errors);
  return { ok: true, academicYear, assignments };
}

interface ChosenPlanRow {
  id: string | number;
  academic_year: string;
  grade_id: string | number;
  grade: string | number;
}

// Lock the plans chosen for the Centre (in id order, so concurrent saves don't deadlock).
async function lockChosenPlans(
  db: Db,
  assignments: CentrePlanAssignment[]
): Promise<Map<number, ChosenPlanRow>> {
  const planIds = assignments
    .map((assignment) => assignment.planId)
    .filter((planId): planId is number => planId !== null)
    .sort((a, b) => a - b);
  const plans = await db<ChosenPlanRow>(
    `SELECT p.id, p.academic_year, p.grade_id, g.number AS grade
     FROM lms_curriculum_plans p
     JOIN grade g ON g.id = p.grade_id
     WHERE p.id = ANY($1::bigint[])
     ORDER BY p.id
     FOR UPDATE OF p`,
    [planIds]
  );
  return new Map(plans.map((plan) => [Number(plan.id), plan]));
}

// The Grades the Centre is eligible for: an active physical JNV Centre with a Centre Exam
// Track mapped for the Grade.
async function loadEligibleGrades(db: Db, centreId: number): Promise<Set<number>> {
  const eligible = await db<{ grade: string | number }>(
    `SELECT DISTINCT g.number AS grade
     FROM ${ELIGIBLE_CENTRE_TRACKS_FROM_SQL}
     JOIN grade g ON g.id = cet.grade_id
     WHERE c.id = $1
       AND ${ELIGIBLE_CENTRE_SQL}`,
    [centreId]
  );
  return new Set(eligible.map((row) => Number(row.grade)));
}

function centreAssignmentErrors(
  { grade, planId }: CentrePlanAssignment,
  context: {
    centreId: number;
    academicYear: string;
    eligibleGrades: Set<number>;
    plansById: Map<number, ChosenPlanRow>;
  }
): { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];
  if (!context.eligibleGrades.has(grade)) {
    errors.push({
      field: "assignments",
      message: `Centre ${context.centreId} is not an eligible Centre for Grade ${grade}`,
    });
  }
  if (planId === null) return errors;
  const plan = context.plansById.get(planId);
  if (!plan) {
    errors.push({ field: "assignments", message: `Curriculum Plan ${planId} was not found` });
  } else if (plan.academic_year !== context.academicYear || Number(plan.grade) !== grade) {
    errors.push({
      field: "assignments",
      message: `Curriculum Plan ${planId} is not a Grade ${grade} plan for ${context.academicYear}`,
    });
  }
  return errors;
}

// Move the Centre + Grade off any other plan for the academic year, then onto the chosen plan
// (none when `plan` is null).
async function writeCentreAssignment(
  db: Db,
  { grade, planId }: CentrePlanAssignment,
  context: { centreId: number; academicYear: string; adminEmail: string; plan: ChosenPlanRow | null }
): Promise<void> {
  await db(
    `DELETE FROM lms_curriculum_plan_assignments
     WHERE centre_id = $1
       AND academic_year = $2
       AND grade_id IN (SELECT id FROM grade WHERE number = $3)
       AND plan_id IS DISTINCT FROM $4::bigint`,
    [context.centreId, context.academicYear, grade, planId]
  );
  if (!context.plan) return;
  await db(
    `INSERT INTO lms_curriculum_plan_assignments
       (plan_id, centre_id, grade_id, academic_year,
        inserted_by_email, updated_by_email, inserted_at, updated_at)
     SELECT $1, $2, $3, $4, $5, $5,
            (NOW() AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC')
     WHERE NOT EXISTS (
       SELECT 1
       FROM lms_curriculum_plan_assignments a
       WHERE a.plan_id = $1
         AND a.centre_id = $2
     )`,
    [planId, context.centreId, context.plan.grade_id, context.plan.academic_year, context.adminEmail]
  );
}

// Assign by Centre: set the Centre's plan for each listed Grade of one academic year (or
// none). Grades not listed are untouched. In one transaction with the chosen plans locked:
// each chosen plan must be of that academic year and Grade, the Centre must be eligible for
// the Grade, and the Centre moves off its previous plan for that Grade.
export async function saveCentrePlanAssignments(params: {
  centreId: number;
  adminEmail: string;
  body: unknown;
}): Promise<CentrePlanAssignmentSaveResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;

  const normalized = normalizeCentrePlanAssignments(params.body);
  if (!normalized.ok) return normalized;
  if (!Number.isInteger(params.centreId) || params.centreId <= 0) {
    return { ok: false, status: 404, error: "Centre not found" };
  }
  const { academicYear, assignments } = normalized;

  try {
    return await withTransaction(async (client) => {
      const db = clientDb(client);
      const plansById = await lockChosenPlans(db, assignments);
      const eligibleGrades = await loadEligibleGrades(db, params.centreId);
      const errors = assignments.flatMap((assignment) =>
        centreAssignmentErrors(assignment, {
          centreId: params.centreId,
          academicYear,
          eligibleGrades,
          plansById,
        })
      );
      if (errors.length > 0) return validationFailure(errors);

      for (const assignment of assignments) {
        await writeCentreAssignment(db, assignment, {
          centreId: params.centreId,
          academicYear,
          adminEmail: params.adminEmail,
          plan: assignment.planId === null ? null : plansById.get(assignment.planId)!,
        });
      }
      return { ok: true as const, assignments };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        status: 409,
        error: "The Centre was assigned to another plan at the same time; reload and try again",
      };
    }
    throw error;
  }
}
