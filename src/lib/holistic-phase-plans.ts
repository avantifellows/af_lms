import type { PoolClient } from "pg";

import { CURRENT_ACADEMIC_YEAR, PROGRAM_IDS } from "./constants";
import { query, withTransaction } from "./db";

export type HolisticPhaseQuestion = {
  id: number;
  text: string;
  position: number;
};

export type HolisticPhase = {
  id: number;
  number: number;
  gradeId: number;
  grade: 11 | 12;
  title: string;
  position: number;
  state: "locked" | "open";
  guidanceMarkdown: string;
  revision: number;
  frozen: boolean;
  everOpened: boolean;
  used: boolean;
  active: boolean;
  questions: HolisticPhaseQuestion[];
};

export type HolisticPhasePlan = {
  id: number;
  programId: number;
  academicYear: string;
  editable: boolean;
  phases: HolisticPhase[];
};

type PlanRow = { id: number | string; program_id: number | string; academic_year: string };
type PhaseRow = {
  id: number | string;
  grade_id: number | string;
  grade: number | string;
  title: string;
  position: number;
  state: "locked" | "open";
  guidance_markdown: string;
  revision: number;
  frozen_at: string | null;
  ever_opened: boolean;
  used: boolean;
};
type QuestionRow = { id: number | string; phase_id: number | string; text: string; position: number };

export type PhasePlanResult =
  | { ok: true; id?: number; revision?: number }
  | { ok: false; status: 404 | 409 | 422; error: string; currentRevision?: number };

type PhaseDefinition = {
  phaseId: number;
  expectedRevision: number;
  grade: 11 | 12;
  title: string;
  guidanceMarkdown: string;
  questions: { id?: number; text: string }[];
  confirmed: boolean;
};

type MutablePhaseRow = {
  id: number | string;
  revision: number;
  state: "locked" | "open";
  guidance_markdown: string;
  academic_year: string;
  frozen_at: string | null;
  ever_opened: boolean;
  used: boolean;
};

function validateAcademicYear(value: string): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

function previousAcademicYear(): string {
  const start = Number(CURRENT_ACADEMIC_YEAR.slice(0, 4));
  return `${start - 1}-${start}`;
}

export function validateHolisticGuidance(markdown: string): string | null {
  if (/<\/?[a-z][^>]*>/i.test(markdown)) return "Guidance cannot contain raw HTML";
  if (/!\[[^\]]*\]\s*\(/.test(markdown)) return "Guidance cannot contain images or embedded content";
  const links = markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g);
  for (const [, target] of links) {
    const href = target.trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href)) {
      return "Guidance links must use http or https";
    }
  }
  return null;
}

function validateDefinition(input: Omit<PhaseDefinition, "phaseId" | "expectedRevision" | "confirmed">) {
  if (![11, 12].includes(input.grade)) return "Grade must be 11 or 12";
  if (!input.title.trim()) return "Title is required";
  if (input.title.trim().length > 120) return "Title must be 120 characters or fewer";
  if (input.questions.length < 1 || input.questions.length > 4 || input.questions.some((q) => !q.text.trim())) {
    return "One to four non-empty Questions are required";
  }
  return validateHolisticGuidance(input.guidanceMarkdown);
}

async function getMutablePhase(client: PoolClient, phaseId: number): Promise<MutablePhaseRow | null> {
  const result = await client.query<MutablePhaseRow>(
    `SELECT p.id, p.revision, p.state, p.guidance_markdown, plan.academic_year, p.frozen_at,
            EXISTS (SELECT 1 FROM holistic_mentorship_phase_state_transitions t
                    WHERE t.phase_id = p.id AND t.to_state = 'open') AS ever_opened,
            EXISTS (SELECT 1 FROM holistic_mentorship_post_session_notes n
                    WHERE n.phase_id = p.id) AS used
     FROM holistic_mentorship_phases p
     JOIN holistic_mentorship_phase_plans plan ON plan.id = p.phase_plan_id
     WHERE p.id = $1 AND plan.program_id = $2
     FOR UPDATE`,
    [phaseId, PROGRAM_IDS.COE]
  );
  return result.rows[0] ?? null;
}

function checkRevision(row: MutablePhaseRow | null, expectedRevision: number): PhasePlanResult | null {
  if (!row) return { ok: false, status: 404, error: "Phase not found" };
  if (row.revision !== expectedRevision) {
    return { ok: false, status: 409, error: "Phase changed", currentRevision: row.revision };
  }
  if (row.academic_year && row.academic_year !== CURRENT_ACADEMIC_YEAR) {
    return { ok: false, status: 422, error: "Prior-year Plans are read-only" };
  }
  return null;
}

export async function getHolisticPhasePlan(
  academicYear: string
): Promise<HolisticPhasePlan | null> {
  const plans = await query<PlanRow>(
    `SELECT id, program_id, academic_year
     FROM holistic_mentorship_phase_plans
     WHERE program_id = $1 AND academic_year = $2`,
    [PROGRAM_IDS.COE, academicYear]
  );
  if (!plans[0]) return null;

  const rows = await query<PhaseRow>(
    `SELECT p.id, p.grade_id, g.number AS grade, p.title, p.position, p.state,
            p.guidance_markdown, p.revision, p.frozen_at,
            EXISTS (SELECT 1 FROM holistic_mentorship_phase_state_transitions t
                    WHERE t.phase_id = p.id AND t.to_state = 'open') AS ever_opened,
            EXISTS (SELECT 1 FROM holistic_mentorship_post_session_notes n
                    WHERE n.phase_id = p.id) AS used
     FROM holistic_mentorship_phases p
     JOIN grade g ON g.id = p.grade_id
     WHERE p.phase_plan_id = $1
     ORDER BY p.position`,
    [Number(plans[0].id)]
  );
  const questionRows = rows.length
    ? await query<QuestionRow>(
        `SELECT id, phase_id, text, position
         FROM holistic_mentorship_phase_questions
         WHERE phase_id = ANY($1::bigint[])
         ORDER BY phase_id, position`,
        [rows.map((row) => Number(row.id))]
      )
    : [];
  const activeByGrade = new Map<number, number>();
  for (const row of rows) {
    if (row.state === "open") activeByGrade.set(Number(row.grade), Number(row.id));
  }

  return {
    id: Number(plans[0].id),
    programId: Number(plans[0].program_id),
    academicYear: plans[0].academic_year,
    editable: academicYear === CURRENT_ACADEMIC_YEAR,
    phases: rows.map((row, index) => ({
      id: Number(row.id),
      number: index + 1,
      gradeId: Number(row.grade_id),
      grade: Number(row.grade) as 11 | 12,
      title: row.title,
      position: row.position,
      state: row.state,
      guidanceMarkdown: row.guidance_markdown,
      revision: row.revision,
      frozen: row.frozen_at !== null,
      everOpened: row.ever_opened,
      used: row.used,
      active: activeByGrade.get(Number(row.grade)) === Number(row.id),
      questions: questionRows
        .filter((question) => Number(question.phase_id) === Number(row.id))
        .map((question) => ({ ...question, id: Number(question.id) })),
    })),
  };
}

export async function createHolisticPhasePlan(params: {
  academicYear: string;
  copyFromAcademicYear?: string;
}): Promise<PhasePlanResult> {
  if (params.academicYear !== CURRENT_ACADEMIC_YEAR || !validateAcademicYear(params.academicYear)) {
    return { ok: false, status: 422, error: "Only the current Academic Year can be configured" };
  }
  if (params.copyFromAcademicYear && params.copyFromAcademicYear !== previousAcademicYear()) {
    return { ok: false, status: 422, error: "Only the prior Plan can be copied" };
  }
  return withTransaction(async (client) => {
    let sourcePlanId: number | null = null;
    if (params.copyFromAcademicYear) {
      const source = await client.query<{ id: number | string }>(
        `SELECT id FROM holistic_mentorship_phase_plans
         WHERE program_id = $1 AND academic_year = $2 FOR SHARE`,
        [PROGRAM_IDS.COE, params.copyFromAcademicYear]
      );
      if (!source.rows[0]) return { ok: false, status: 404, error: "Prior Plan not found" };
      sourcePlanId = Number(source.rows[0].id);
    }
    const inserted = await client.query<{ id: number | string }>(
      `INSERT INTO holistic_mentorship_phase_plans (program_id, academic_year, inserted_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (program_id, academic_year) DO NOTHING
       RETURNING id`,
      [PROGRAM_IDS.COE, params.academicYear]
    );
    if (!inserted.rows[0]) return { ok: false, status: 409, error: "Plan already exists" };
    const planId = Number(inserted.rows[0].id);

    if (sourcePlanId) {
      const copied = await client.query<{ old_id: number | string; new_id: number | string }>(
        `WITH source AS (
           SELECT p.id AS old_id, p.grade_id, p.title, p.position, p.guidance_markdown
           FROM holistic_mentorship_phases p
           WHERE p.phase_plan_id = $1
           ORDER BY p.position
         ), inserted AS (
           INSERT INTO holistic_mentorship_phases
             (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision, inserted_at, updated_at)
           SELECT $2, grade_id, title, position, 'locked', guidance_markdown, 1, NOW(), NOW()
           FROM source ORDER BY position RETURNING id, position
         )
         SELECT source.old_id, inserted.id AS new_id
         FROM source JOIN inserted USING (position)`,
        [sourcePlanId, planId]
      );
      for (const phase of copied.rows) {
        await client.query(
          `INSERT INTO holistic_mentorship_phase_questions
             (phase_id, text, position, inserted_at, updated_at)
           SELECT $1, text, position, NOW(), NOW()
           FROM holistic_mentorship_phase_questions
           WHERE phase_id = $2 ORDER BY position`,
          [Number(phase.new_id), Number(phase.old_id)]
        );
      }
    }
    return { ok: true, id: planId };
  });
}

export async function addHolisticPhase(params: {
  academicYear: string;
  grade: 11 | 12;
  title: string;
  guidanceMarkdown: string;
  questions: { text: string }[];
}): Promise<PhasePlanResult> {
  const error = validateDefinition(params);
  if (error) return { ok: false, status: 422, error };
  if (params.academicYear !== CURRENT_ACADEMIC_YEAR) {
    return { ok: false, status: 422, error: "Prior-year Plans are read-only" };
  }
  return withTransaction(async (client) => {
    const inserted = await client.query<{ id: number | string }>(
      `INSERT INTO holistic_mentorship_phases
         (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision, inserted_at, updated_at)
       SELECT plan.id, grade.id, $3,
              COALESCE((SELECT MAX(position) + 1 FROM holistic_mentorship_phases WHERE phase_plan_id = plan.id), 1),
              'locked', $4, 1, NOW(), NOW()
       FROM holistic_mentorship_phase_plans plan
       JOIN grade ON grade.number = $5
       WHERE plan.program_id = $1 AND plan.academic_year = $2
       RETURNING id`,
      [PROGRAM_IDS.COE, params.academicYear, params.title.trim(), params.guidanceMarkdown, params.grade]
    );
    if (!inserted.rows[0]) return { ok: false, status: 404, error: "Plan not found" };
    const phaseId = Number(inserted.rows[0].id);
    for (const [index, question] of params.questions.entries()) {
      await client.query(
        `INSERT INTO holistic_mentorship_phase_questions
           (phase_id, text, position, inserted_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [phaseId, question.text.trim(), index + 1]
      );
    }
    return { ok: true, id: phaseId, revision: 1 };
  });
}

export async function updateHolisticPhase(input: PhaseDefinition): Promise<PhasePlanResult> {
  const error = validateDefinition(input);
  if (error) return { ok: false, status: 422, error };
  return withTransaction(async (client) => {
    const row = await getMutablePhase(client, input.phaseId);
    const conflict = checkRevision(row, input.expectedRevision);
    if (conflict) return conflict;
    const phase = row!;
    if (phase.frozen_at || phase.used) return { ok: false, status: 422, error: "Used Phases are frozen" };
    if ((phase.state === "open" || phase.ever_opened) && !input.guidanceMarkdown.trim()) {
      return { ok: false, status: 422, error: "Opened Phases require Guidance" };
    }
    if (phase.ever_opened && !input.confirmed) {
      return { ok: false, status: 422, error: "Confirmation is required" };
    }

    if (!phase.ever_opened) {
      const existing = await client.query<{ id: number | string }>(
        `SELECT id FROM holistic_mentorship_phase_questions WHERE phase_id = $1 FOR UPDATE`,
        [input.phaseId]
      );
      const existingIds = new Set(existing.rows.map((question) => Number(question.id)));
      const retainedIds = input.questions.flatMap((question) => question.id ? [question.id] : []);
      if (retainedIds.some((id) => !existingIds.has(id))) {
        return { ok: false, status: 422, error: "Question does not belong to this Phase" };
      }
    }

    const updated = await client.query<{ revision: number }>(
      `UPDATE holistic_mentorship_phases
       SET grade_id = CASE WHEN $6 THEN grade_id ELSE (SELECT id FROM grade WHERE number = $2) END,
           title = CASE WHEN $6 THEN title ELSE $3 END,
           guidance_markdown = $4, revision = revision + 1, updated_at = NOW()
       WHERE id = $1 AND revision = $5
       RETURNING revision`,
      [input.phaseId, input.grade, input.title.trim(), input.guidanceMarkdown, input.expectedRevision, phase.ever_opened]
    );
    if (!updated.rows[0]) return { ok: false, status: 409, error: "Phase changed" };

    if (!phase.ever_opened) {
      await client.query(`DELETE FROM holistic_mentorship_phase_questions WHERE phase_id = $1`, [input.phaseId]);
      for (const [index, question] of input.questions.entries()) {
        if (question.id) {
          await client.query(
            `INSERT INTO holistic_mentorship_phase_questions
               (id, phase_id, text, position, inserted_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW(), NOW())`,
            [question.id, input.phaseId, question.text.trim(), index + 1]
          );
        } else {
          await client.query(
            `INSERT INTO holistic_mentorship_phase_questions
               (phase_id, text, position, inserted_at, updated_at)
             VALUES ($1, $2, $3, NOW(), NOW())`,
            [input.phaseId, question.text.trim(), index + 1]
          );
        }
      }
    }
    return { ok: true, id: input.phaseId, revision: updated.rows[0].revision };
  });
}

export async function setHolisticPhaseState(input: {
  phaseId: number;
  expectedRevision: number;
  state: "locked" | "open";
  actorUserId: number;
  confirmed: boolean;
}): Promise<PhasePlanResult> {
  if (!input.confirmed) return { ok: false, status: 422, error: "Confirmation is required" };
  return withTransaction(async (client) => {
    const row = await getMutablePhase(client, input.phaseId);
    const conflict = checkRevision(row, input.expectedRevision);
    if (conflict) return conflict;
    const phase = row!;
    if (phase.state === input.state) return { ok: true, id: input.phaseId, revision: phase.revision };
    if (input.state === "locked" && (phase.used || phase.frozen_at)) {
      return { ok: false, status: 422, error: "A used Phase cannot return to Locked" };
    }
    if (input.state === "open") {
      const definition = await client.query<{ title: string; guidance_markdown: string; question_count: number | string }>(
        `SELECT p.title, p.guidance_markdown, COUNT(q.id) AS question_count
         FROM holistic_mentorship_phases p
         LEFT JOIN holistic_mentorship_phase_questions q ON q.phase_id = p.id
         WHERE p.id = $1 GROUP BY p.id`,
        [input.phaseId]
      );
      const current = definition.rows[0];
      if (!current?.title.trim() || !current.guidance_markdown.trim() || Number(current.question_count) < 1) {
        return { ok: false, status: 422, error: "Complete title, Guidance, and Questions before opening" };
      }
      const guidanceError = validateHolisticGuidance(current.guidance_markdown);
      if (guidanceError) return { ok: false, status: 422, error: guidanceError };
    }
    const updated = await client.query<{ revision: number }>(
      `UPDATE holistic_mentorship_phases
       SET state = $2, revision = revision + 1, updated_at = NOW()
       WHERE id = $1 AND revision = $3 RETURNING revision`,
      [input.phaseId, input.state, input.expectedRevision]
    );
    if (!updated.rows[0]) return { ok: false, status: 409, error: "Phase changed" };
    await client.query(
      `INSERT INTO holistic_mentorship_phase_state_transitions
         (phase_id, from_state, to_state, actor_user_id, occurred_at, inserted_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), NOW())`,
      [input.phaseId, phase.state, input.state, input.actorUserId]
    );
    return { ok: true, id: input.phaseId, revision: updated.rows[0].revision };
  });
}

export async function deleteHolisticPhase(input: {
  phaseId: number;
  expectedRevision: number;
}): Promise<PhasePlanResult> {
  return withTransaction(async (client) => {
    const row = await getMutablePhase(client, input.phaseId);
    const conflict = checkRevision(row, input.expectedRevision);
    if (conflict) return conflict;
    const phase = row!;
    if (phase.state !== "locked" || phase.ever_opened || phase.used || phase.frozen_at) {
      return { ok: false, status: 422, error: "Only never-opened, unused Locked Phases can be deleted" };
    }
    await client.query(`DELETE FROM holistic_mentorship_phase_questions WHERE phase_id = $1`, [input.phaseId]);
    await client.query(`DELETE FROM holistic_mentorship_phases WHERE id = $1 AND revision = $2`, [input.phaseId, input.expectedRevision]);
    return { ok: true, id: input.phaseId };
  });
}

export async function reorderHolisticPhases(input: {
  academicYear: string;
  phases: { id: number; expectedRevision: number }[];
}): Promise<PhasePlanResult> {
  if (input.academicYear !== CURRENT_ACADEMIC_YEAR || input.phases.length < 2) {
    return { ok: false, status: 422, error: "Invalid Phase order" };
  }
  return withTransaction(async (client) => {
    const result = await client.query<{
      id: number | string;
      position: number;
      revision: number;
      state: "locked" | "open";
      frozen_at: string | null;
      ever_opened: boolean;
      used: boolean;
    }>(
      `SELECT p.id, p.position, p.revision, p.state, p.frozen_at,
              EXISTS (SELECT 1 FROM holistic_mentorship_phase_state_transitions t
                      WHERE t.phase_id = p.id AND t.to_state = 'open') AS ever_opened,
              EXISTS (SELECT 1 FROM holistic_mentorship_post_session_notes n
                      WHERE n.phase_id = p.id) AS used
       FROM holistic_mentorship_phases p
       JOIN holistic_mentorship_phase_plans plan ON plan.id = p.phase_plan_id
       WHERE plan.program_id = $1 AND plan.academic_year = $2
       ORDER BY p.position FOR UPDATE`,
      [PROGRAM_IDS.COE, input.academicYear]
    );
    const rows = result.rows;
    if (rows.length !== input.phases.length || new Set(input.phases.map((phase) => phase.id)).size !== rows.length) {
      return { ok: false, status: 409, error: "Phase order changed" };
    }
    const byId = new Map(rows.map((row) => [Number(row.id), row]));
    for (const [index, requested] of input.phases.entries()) {
      const row = byId.get(requested.id);
      if (!row || row.revision !== requested.expectedRevision) {
        return { ok: false, status: 409, error: "Phase changed", currentRevision: row?.revision };
      }
      if (row.position !== rows[index].position && (row.state !== "locked" || row.ever_opened || row.used || row.frozen_at)) {
        return { ok: false, status: 422, error: "Only never-opened, unused Locked Phases can be reordered" };
      }
    }
    const changedIds = input.phases
      .filter((phase, index) => byId.get(phase.id)!.position !== rows[index].position)
      .map((phase) => phase.id);
    if (!changedIds.length) return { ok: true };
    await client.query(
      `UPDATE holistic_mentorship_phases SET position = position + 10000 WHERE id = ANY($1::bigint[])`,
      [changedIds]
    );
    for (const [index, phase] of input.phases.entries()) {
      if (!changedIds.includes(phase.id)) continue;
      await client.query(
        `UPDATE holistic_mentorship_phases
         SET position = $2, revision = revision + 1, updated_at = NOW()
         WHERE id = $1 AND revision = $3`,
        [phase.id, rows[index].position, phase.expectedRevision]
      );
    }
    return { ok: true };
  });
}
