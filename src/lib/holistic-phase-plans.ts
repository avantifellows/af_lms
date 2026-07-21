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

async function lockPhasePlanForYear(
  client: PoolClient,
  academicYear: string
): Promise<number | null> {
  const plan = await client.query<{ id: number | string }>(
    `SELECT id FROM holistic_mentorship_phase_plans
     WHERE program_id = $1 AND academic_year = $2
     FOR UPDATE`,
    [PROGRAM_IDS.COE, academicYear]
  );
  return plan.rows[0] ? Number(plan.rows[0].id) : null;
}

async function lockPhasePlanForPhase(
  client: PoolClient,
  phaseId: number
): Promise<number | null> {
  const plan = await client.query<{ id: number | string }>(
    `SELECT plan.id
     FROM holistic_mentorship_phase_plans plan
     JOIN holistic_mentorship_phases phase ON phase.phase_plan_id = plan.id
     WHERE phase.id = $1
     FOR UPDATE OF plan`,
    [phaseId]
  );
  return plan.rows[0] ? Number(plan.rows[0].id) : null;
}

export type PhasePlanResult =
  | { ok: true; id?: number; revision?: number }
  | { ok: false; status: 404 | 409 | 422; error: string; currentRevision?: number };

type PhaseDefinition = {
  phaseId: number;
  expectedRevision: number;
  actorEmail: string;
  actorUserId?: number;
  grade: 11 | 12;
  title: string;
  guidanceMarkdown: string;
  questions: { id?: number; text: string }[];
  confirmed: boolean;
};

type MutablePhaseRow = {
  id: number | string;
  phase_plan_id: number | string;
  position: number;
  revision: number;
  state: "locked" | "open";
  guidance_markdown: string;
  academic_year: string;
  frozen_at: string | null;
  ever_opened: boolean;
  used: boolean;
};

type ReorderPhaseRow = Pick<
  PhaseRow,
  "id" | "position" | "revision" | "state" | "frozen_at" | "ever_opened" | "used"
> & { phase_plan_id: number | string };

type PhaseMutationAction = "created" | "definition_updated" | "reordered" | "deleted";

type AuditActor = {
  actorEmail: string;
  actorUserId?: number;
};

async function recordPhaseMutation(
  client: PoolClient,
  phasePlanId: number,
  phaseId: number,
  action: PhaseMutationAction,
  actor: AuditActor
) {
  await client.query(
    `INSERT INTO holistic_mentorship_phase_mutation_audits
       (phase_plan_id, phase_id, action, actor_user_id, actor_email, occurred_at, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
    [phasePlanId, phaseId, action, actor.actorUserId ?? null, actor.actorEmail]
  );
}

export function validateAcademicYear(value: string): boolean {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  return !!match && Number(match[2]) === Number(match[1]) + 1;
}

function previousAcademicYear(): string {
  const start = Number(CURRENT_ACADEMIC_YEAR.slice(0, 4));
  return `${start - 1}-${start}`;
}

function validateHolisticGuidance(markdown: string): string | null {
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

function validateDefinition(
  input: Omit<PhaseDefinition, "phaseId" | "expectedRevision" | "actorEmail" | "actorUserId" | "confirmed">
) {
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
    `SELECT p.id, p.phase_plan_id, p.position, p.revision, p.state, p.guidance_markdown,
            plan.academic_year, p.frozen_at,
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

async function checkedPhase(
  client: PoolClient,
  phaseId: number,
  expectedRevision: number
): Promise<{ phase: MutablePhaseRow; error: null } | { phase: null; error: PhasePlanResult }> {
  const phase = await getMutablePhase(client, phaseId);
  const error = checkRevision(phase, expectedRevision);
  return error ? { phase: null, error } : { phase: phase!, error: null };
}

async function validateQuestionOwnership(
  client: PoolClient,
  phaseId: number,
  questions: PhaseDefinition["questions"]
): Promise<PhasePlanResult | null> {
  const existing = await client.query<{ id: number | string }>(
    `SELECT id FROM holistic_mentorship_phase_questions WHERE phase_id = $1 FOR UPDATE`,
    [phaseId]
  );
  const existingIds = new Set(existing.rows.map((question) => Number(question.id)));
  const retainedIds = questions.flatMap((question) => question.id ? [question.id] : []);
  return retainedIds.some((id) => !existingIds.has(id))
    ? { ok: false, status: 422, error: "Question does not belong to this Phase" }
    : null;
}

function validateDefinitionChange(
  phase: MutablePhaseRow,
  input: PhaseDefinition
): PhasePlanResult | null {
  if (phase.frozen_at || phase.used) {
    return { ok: false, status: 422, error: "Used Phases are frozen" };
  }
  if ((phase.state === "open" || phase.ever_opened) && !input.guidanceMarkdown.trim()) {
    return { ok: false, status: 422, error: "Opened Phases require Guidance" };
  }
  return phase.ever_opened && !input.confirmed
    ? { ok: false, status: 422, error: "Confirmation is required" }
    : null;
}

async function replaceQuestions(client: PoolClient, input: PhaseDefinition) {
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

async function updatePhaseTransaction(
  client: PoolClient,
  input: PhaseDefinition
): Promise<PhasePlanResult> {
  const checked = await checkedPhase(client, input.phaseId, input.expectedRevision);
  if (checked.error) return checked.error;
  const phase = checked.phase;
  const invalidChange = validateDefinitionChange(phase, input);
  if (invalidChange) return invalidChange;
  const ownershipError = await validateQuestionOwnership(client, input.phaseId, input.questions);
  if (ownershipError) return ownershipError;
  const updated = await client.query<{ revision: number }>(
    `UPDATE holistic_mentorship_phases
     SET grade_id = (SELECT id FROM grade WHERE number = $2),
         title = $3,
         guidance_markdown = $4, revision = revision + 1, updated_at = NOW()
     WHERE id = $1 AND revision = $5
     RETURNING revision`,
    [input.phaseId, input.grade, input.title.trim(), input.guidanceMarkdown, input.expectedRevision]
  );
  if (!updated.rows[0]) return { ok: false, status: 409, error: "Phase changed" };
  await replaceQuestions(client, input);
  await recordPhaseMutation(
    client,
    Number(phase.phase_plan_id),
    input.phaseId,
    "definition_updated",
    input
  );
  return { ok: true, id: input.phaseId, revision: updated.rows[0].revision };
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
} & AuditActor): Promise<PhasePlanResult> {
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
        await recordPhaseMutation(
          client,
          planId,
          Number(phase.new_id),
          "created",
          params
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
} & AuditActor): Promise<PhasePlanResult> {
  const error = validateDefinition(params);
  if (error) return { ok: false, status: 422, error };
  if (params.academicYear !== CURRENT_ACADEMIC_YEAR) {
    return { ok: false, status: 422, error: "Prior-year Plans are read-only" };
  }
  return withTransaction(async (client) => {
    const planId = await lockPhasePlanForYear(client, params.academicYear);
    if (!planId) return { ok: false, status: 404, error: "Plan not found" };
    const inserted = await client.query<{ id: number | string; phase_plan_id: number | string }>(
      `INSERT INTO holistic_mentorship_phases
         (phase_plan_id, grade_id, title, position, state, guidance_markdown, revision, inserted_at, updated_at)
       SELECT plan.id, grade.id, $3,
              COALESCE((SELECT MAX(position) + 1 FROM holistic_mentorship_phases WHERE phase_plan_id = plan.id), 1),
              'locked', $4, 1, NOW(), NOW()
       FROM holistic_mentorship_phase_plans plan
       JOIN grade ON grade.number = $5
       WHERE plan.program_id = $1 AND plan.academic_year = $2
       RETURNING id, phase_plan_id`,
      [PROGRAM_IDS.COE, params.academicYear, params.title.trim(), params.guidanceMarkdown, params.grade]
    );
    const phaseId = Number(inserted.rows[0].id);
    for (const [index, question] of params.questions.entries()) {
      await client.query(
        `INSERT INTO holistic_mentorship_phase_questions
           (phase_id, text, position, inserted_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [phaseId, question.text.trim(), index + 1]
      );
    }
    await recordPhaseMutation(
      client,
      Number(inserted.rows[0].phase_plan_id),
      phaseId,
      "created",
      params
    );
    return { ok: true, id: phaseId, revision: 1 };
  });
}

export async function updateHolisticPhase(input: PhaseDefinition): Promise<PhasePlanResult> {
  const error = validateDefinition(input);
  if (error) return { ok: false, status: 422, error };
  return withTransaction((client) => updatePhaseTransaction(client, input));
}

type OpenDefinitionRow = {
  grade: number | string;
  title: string;
  guidance_markdown: string;
  question_count: number | string;
  valid_question_count: number | string;
};

function completeOpenDefinition(current: OpenDefinitionRow | undefined): current is OpenDefinitionRow {
  if (!current) return false;
  if (![11, 12].includes(Number(current.grade))) return false;
  if (!current.title.trim()) return false;
  if (!current.guidance_markdown.trim()) return false;
  const questionCount = Number(current.question_count);
  if (questionCount < 1) return false;
  if (questionCount > 4) return false;
  return questionCount === Number(current.valid_question_count);
}

async function validateOpenReadiness(
  client: PoolClient,
  phaseId: number
): Promise<PhasePlanResult | null> {
  const definition = await client.query<OpenDefinitionRow>(
    `SELECT g.number AS grade, p.title, p.guidance_markdown, COUNT(q.id) AS question_count,
            COUNT(q.id) FILTER (WHERE BTRIM(q.text) <> '') AS valid_question_count
     FROM holistic_mentorship_phases p
     JOIN grade g ON g.id = p.grade_id
     LEFT JOIN holistic_mentorship_phase_questions q ON q.phase_id = p.id
     WHERE p.id = $1 GROUP BY p.id, g.number`,
    [phaseId]
  );
  const current = definition.rows[0];
  if (!completeOpenDefinition(current)) {
    return {
      ok: false,
      status: 422,
      error: "Complete Grade, title, Guidance, and Questions before opening",
    };
  }
  const guidanceError = validateHolisticGuidance(current.guidance_markdown);
  return guidanceError ? { ok: false, status: 422, error: guidanceError } : null;
}

async function setPhaseStateTransaction(
  client: PoolClient,
  input: {
    phaseId: number;
    expectedRevision: number;
    state: "locked" | "open";
  } & AuditActor
): Promise<PhasePlanResult> {
  const checked = await checkedPhase(client, input.phaseId, input.expectedRevision);
  if (checked.error) return checked.error;
  const phase = checked.phase;
  if (phase.state === input.state) return { ok: true, id: input.phaseId, revision: phase.revision };
  if (input.state === "locked" && (phase.used || phase.frozen_at)) {
    return { ok: false, status: 422, error: "A used Phase cannot return to Locked" };
  }
  if (input.state === "open") {
    const readinessError = await validateOpenReadiness(client, input.phaseId);
    if (readinessError) return readinessError;
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
       (phase_id, from_state, to_state, actor_user_id, actor_email, occurred_at, inserted_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())`,
    [input.phaseId, phase.state, input.state, input.actorUserId ?? null, input.actorEmail]
  );
  return { ok: true, id: input.phaseId, revision: updated.rows[0].revision };
}

export async function setHolisticPhaseState(input: {
  phaseId: number;
  expectedRevision: number;
  state: "locked" | "open";
  confirmed: boolean;
} & AuditActor): Promise<PhasePlanResult> {
  if (!input.confirmed) return { ok: false, status: 422, error: "Confirmation is required" };
  return withTransaction((client) => setPhaseStateTransaction(client, input));
}

type DeletePhaseInput = {
  phaseId: number;
  expectedRevision: number;
} & AuditActor;

async function compactLaterPhases(
  client: PoolClient,
  laterPhases: ReorderPhaseRow[],
  actor: AuditActor
) {
  if (!laterPhases.length) return;
  const laterIds = laterPhases.map((row) => Number(row.id));
  await client.query(
    `UPDATE holistic_mentorship_phases SET position = position + 10000
     WHERE id = ANY($1::bigint[])`,
    [laterIds]
  );
  await client.query(
    `UPDATE holistic_mentorship_phases
     SET position = position - 10001, revision = revision + 1, updated_at = NOW()
     WHERE id = ANY($1::bigint[])`,
    [laterIds]
  );
  for (const phase of laterPhases) {
    await recordPhaseMutation(
      client,
      Number(phase.phase_plan_id),
      Number(phase.id),
      "reordered",
      actor
    );
  }
}

async function deletePhaseTransaction(
  client: PoolClient,
  input: DeletePhaseInput
): Promise<PhasePlanResult> {
  const planId = await lockPhasePlanForPhase(client, input.phaseId);
  if (!planId) return { ok: false, status: 404, error: "Phase not found" };
  const checked = await checkedPhase(client, input.phaseId, input.expectedRevision);
  if (checked.error) return checked.error;
  const phase = checked.phase;
  if (immutablePhase(phase)) {
    return { ok: false, status: 422, error: "Only never-opened, unused Locked Phases can be deleted" };
  }
  const later = await client.query<ReorderPhaseRow>(
    `SELECT p.id, p.phase_plan_id, p.position, p.revision, p.state, p.frozen_at,
            EXISTS (SELECT 1 FROM holistic_mentorship_phase_state_transitions t
                    WHERE t.phase_id = p.id AND t.to_state = 'open') AS ever_opened,
            EXISTS (SELECT 1 FROM holistic_mentorship_post_session_notes n
                    WHERE n.phase_id = p.id) AS used
     FROM holistic_mentorship_phases p
     WHERE p.phase_plan_id = $1 AND p.position > $2
     ORDER BY p.position FOR UPDATE`,
    [Number(phase.phase_plan_id), phase.position]
  );
  if (later.rows.some(immutablePhase)) {
    return { ok: false, status: 422, error: "Deleting this Phase would move an opened or used Phase" };
  }
  await client.query(`DELETE FROM holistic_mentorship_phase_questions WHERE phase_id = $1`, [input.phaseId]);
  await recordPhaseMutation(
    client,
    Number(phase.phase_plan_id),
    input.phaseId,
    "deleted",
    input
  );
  await client.query(`DELETE FROM holistic_mentorship_phases WHERE id = $1 AND revision = $2`, [input.phaseId, input.expectedRevision]);
  await compactLaterPhases(client, later.rows, input);
  return { ok: true, id: input.phaseId };
}

export async function deleteHolisticPhase(input: DeletePhaseInput): Promise<PhasePlanResult> {
  return withTransaction((client) => deletePhaseTransaction(client, input));
}

async function loadReorderPhases(
  client: PoolClient,
  academicYear: string
): Promise<ReorderPhaseRow[]> {
  const result = await client.query<ReorderPhaseRow>(
    `SELECT p.id, p.phase_plan_id, p.position, p.revision, p.state, p.frozen_at,
            EXISTS (SELECT 1 FROM holistic_mentorship_phase_state_transitions t
                    WHERE t.phase_id = p.id AND t.to_state = 'open') AS ever_opened,
            EXISTS (SELECT 1 FROM holistic_mentorship_post_session_notes n
                    WHERE n.phase_id = p.id) AS used
     FROM holistic_mentorship_phases p
     JOIN holistic_mentorship_phase_plans plan ON plan.id = p.phase_plan_id
     WHERE plan.program_id = $1 AND plan.academic_year = $2
     ORDER BY p.position FOR UPDATE`,
    [PROGRAM_IDS.COE, academicYear]
  );
  return result.rows;
}

function validateReorder(
  rows: ReorderPhaseRow[],
  requestedPhases: { id: number; expectedRevision: number }[]
): PhasePlanResult | null {
  if (!samePhaseSet(rows, requestedPhases)) {
    return { ok: false, status: 409, error: "Phase order changed" };
  }
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  for (const [index, requested] of requestedPhases.entries()) {
    const row = byId.get(requested.id);
    const revisionError = reorderRevisionError(row, requested.expectedRevision);
    if (revisionError) return revisionError;
    if (row!.position === rows[index].position) continue;
    if (immutablePhase(row!)) {
      return {
        ok: false,
        status: 422,
        error: "Only never-opened, unused Locked Phases can be reordered",
      };
    }
  }
  return null;
}

function samePhaseSet(
  rows: ReorderPhaseRow[],
  requestedPhases: { id: number }[]
): boolean {
  return rows.length === requestedPhases.length &&
    new Set(requestedPhases.map((phase) => phase.id)).size === rows.length;
}

function reorderRevisionError(
  row: ReorderPhaseRow | undefined,
  expectedRevision: number
): PhasePlanResult | null {
  if (row?.revision === expectedRevision) return null;
  return { ok: false, status: 409, error: "Phase changed", currentRevision: row?.revision };
}

function immutablePhase(row: ReorderPhaseRow): boolean {
  return [row.state !== "locked", row.ever_opened, row.used, Boolean(row.frozen_at)].some(Boolean);
}

function reorderedPhaseIds(
  rows: ReorderPhaseRow[],
  requestedPhases: { id: number; expectedRevision: number }[]
): number[] {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  return requestedPhases
    .filter((phase, index) => byId.get(phase.id)!.position !== rows[index].position)
    .map((phase) => phase.id);
}

async function persistReorder(
  client: PoolClient,
  rows: ReorderPhaseRow[],
  requestedPhases: { id: number; expectedRevision: number }[],
  changedIds: number[],
  actor: AuditActor
) {
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  await client.query(
    `UPDATE holistic_mentorship_phases SET position = position + 10000 WHERE id = ANY($1::bigint[])`,
    [changedIds]
  );
  const changed = new Set(changedIds);
  for (const [index, phase] of requestedPhases.entries()) {
    if (!changed.has(phase.id)) continue;
    await client.query(
      `UPDATE holistic_mentorship_phases
       SET position = $2, revision = revision + 1, updated_at = NOW()
       WHERE id = $1 AND revision = $3`,
      [phase.id, rows[index].position, phase.expectedRevision]
    );
    await recordPhaseMutation(
      client,
      Number(byId.get(phase.id)!.phase_plan_id),
      phase.id,
      "reordered",
      actor
    );
  }
}

async function reorderPhaseTransaction(
  client: PoolClient,
  input: {
    academicYear: string;
    phases: { id: number; expectedRevision: number }[];
  } & AuditActor
): Promise<PhasePlanResult> {
  const planId = await lockPhasePlanForYear(client, input.academicYear);
  if (!planId) return { ok: false, status: 409, error: "Phase order changed" };
  const rows = await loadReorderPhases(client, input.academicYear);
  const validationError = validateReorder(rows, input.phases);
  if (validationError) return validationError;
  const changedIds = reorderedPhaseIds(rows, input.phases);
  if (!changedIds.length) return { ok: true };
  await persistReorder(client, rows, input.phases, changedIds, input);
  return { ok: true };
}

export async function reorderHolisticPhases(input: {
  academicYear: string;
  phases: { id: number; expectedRevision: number }[];
} & AuditActor): Promise<PhasePlanResult> {
  if (input.academicYear !== CURRENT_ACADEMIC_YEAR || input.phases.length < 2) {
    return { ok: false, status: 422, error: "Invalid Phase order" };
  }
  return withTransaction((client) => reorderPhaseTransaction(client, input));
}
