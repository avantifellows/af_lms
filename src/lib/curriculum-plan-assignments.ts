// Plan Assignments (issue #417): the link that makes one Curriculum Plan the plan for one
// Centre and Grade. Exactly one plan per Centre + Grade + academic year, whatever the plan's
// status; assignment rows copy the academic year and Grade from their plan so the unique
// constraint enforces it. Kept apart from plan CRUD (`curriculum-plans.ts`) so assignment by
// Centre can extend it.

import { uncoveredExamTracks } from "./curriculum-plan-rules";
import {
  clientDb,
  lockPlan,
  planNotFound,
  validationFailure,
  type Conflict,
  type CurriculumPlanValidationFailure,
  type Db,
  type LockedPlanRow,
  type NotFound,
} from "./curriculum-plans";
import {
  checkCurriculumPlansSchema,
  type CurriculumSchemaUnavailable,
} from "./curriculum-schema";
import { query, withTransaction } from "./db";
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

export interface PlanAssignmentPreview {
  centres: PlanAssignmentPreviewCentre[];
  // Ticked Centres currently on another plan for the same Grade + academic year.
  moveCount: number;
  // Centres assigned to this plan that are no longer ticked.
  removeCount: number;
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
  const [rows, contentRows] = await Promise.all([
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
       FROM centres c
       JOIN school s ON s.id = c.school_id
       JOIN centre_exam_tracks cet
         ON cet.centre_id = c.id
        AND cet.grade_id = $1
       LEFT JOIN program p ON p.id = c.program_id
       LEFT JOIN lms_curriculum_plan_assignments a
         ON a.centre_id = c.id
        AND a.grade_id = $1
        AND a.academic_year = $2
       LEFT JOIN lms_curriculum_plans cp ON cp.id = a.plan_id
       WHERE c.is_active = true
         AND c.is_physical = true
         AND s.af_school_category = 'JNV'
       GROUP BY c.id, c.name, s.name, s.code, s.region, p.name, a.plan_id, cp.title
       ORDER BY s.region NULLS LAST, s.name, c.name, c.id`,
      [plan.grade_id, plan.academic_year]
    ),
    db<{ exam_track: string }>(
      `SELECT DISTINCT cfg.exam_track
       FROM lms_chapter_exam_configs cfg
       JOIN chapter ch ON ch.id = cfg.chapter_id
       WHERE cfg.is_in_syllabus = true
         AND ch.grade_id = $1`,
      [plan.grade_id]
    ),
  ]);
  const tracksWithContent = contentRows.map((row) => row.exam_track);
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

// Ticked Centres must all be eligible for the plan; an unknown or ineligible Centre rejects
// the whole request.
function previewAgainst(
  planId: number,
  eligible: EligibleCentre[],
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
  return {
    ok: true,
    preview: {
      centres,
      moveCount: centres.filter((centre) => centre.moves).length,
      removeCount: eligible.filter(
        (centre) => centre.currentPlan?.id === planId && !ticked.has(centre.centreId)
      ).length,
    },
  };
}

export async function previewPlanAssignment(params: {
  id: number;
  body: unknown;
}): Promise<PlanAssignmentPreviewResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  const normalized = normalizeCentreIds(params.body);
  if (!normalized.ok) return normalized;

  const plan = await readPlan(poolDb, params.id);
  if (!plan) return planNotFound();
  return previewAgainst(params.id, await loadEligibleCentres(poolDb, plan), normalized.centreIds);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

// Save the plan's assignments as exactly the ticked Centres. In one transaction with the plan
// row locked: ticked Centres on another plan for the same Grade + academic year move here,
// new Centres are added, and unticked Centres lose their assignment. Moves are recomputed
// here, never trusted from the client.
export async function savePlanAssignmentByPlan(params: {
  id: number;
  adminEmail: string;
  body: unknown;
}): Promise<PlanAssignmentSaveResult> {
  const schema = await checkCurriculumPlansSchema();
  if (!schema.ok) return schema;
  if (!Number.isInteger(params.id) || params.id <= 0) return planNotFound();

  const normalized = normalizeCentreIds(params.body);
  if (!normalized.ok) return normalized;
  const centreIds = normalized.centreIds;

  try {
    return await withTransaction(async (client) => {
      const db = clientDb(client);
      const plan = await lockPlan(db, params.id);
      if (!plan) return planNotFound();

      const checked = previewAgainst(params.id, await loadEligibleCentres(db, plan), centreIds);
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
