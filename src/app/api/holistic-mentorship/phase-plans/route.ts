import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import {
  addHolisticPhase,
  createHolisticPhasePlan,
  deleteHolisticPhase,
  getHolisticPhasePlan,
  reorderHolisticPhases,
  setHolisticPhaseState,
  updateHolisticPhase,
  validateAcademicYear,
  type PhasePlanResult,
} from "@/lib/holistic-phase-plans";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import {
  holisticApiError,
  holisticJsonProgramId,
  holisticProgramId,
  positiveInteger,
  readJsonObject,
} from "../route-helpers";

function response(result: PhasePlanResult) {
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json(
        { error: result.error, currentRevision: result.currentRevision },
        { status: result.status }
      );
}

type AuditActor = { actorEmail: string; actorUserId?: number };

function auditActor(access: { email: string; actorUserId?: number }): AuditActor {
  return {
    actorEmail: access.email.trim().toLowerCase(),
    actorUserId: access.actorUserId,
  };
}

async function sessionAccess(
  action: "phase_configuration_read" | "phase_configure",
  programId: number,
) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, action, { programId });
  return { session, access };
}

async function configurationAction(request: NextRequest) {
  const value = await readJsonObject(request);
  const programId = value && holisticJsonProgramId(value.program_id);
  if (!value || !programId || typeof value.action !== "string") {
    return { ok: false as const, response: holisticApiError("Invalid request body") };
  }
  const { access } = await sessionAccess("phase_configure", programId);
  if (!access.ok) {
    return { ok: false as const, response: holisticApiError(access.error, access.status) };
  }
  return { ok: true as const, access, value, programId };
}

function definition(value: Record<string, unknown>): {
  grade: 11 | 12;
  title: string;
  guidanceMarkdown: string;
  questions: { id?: number; text: string }[];
} | null {
  const grade = value.grade;
  const questions = value.questions;
  if ((grade !== 11 && grade !== 12) || typeof value.title !== "string" ||
      typeof value.guidance_markdown !== "string" || !Array.isArray(questions)) return null;
  const parsedQuestions = questions.map((question) => {
    if (!question || typeof question !== "object" || typeof (question as Record<string, unknown>).text !== "string") return null;
    const item = question as Record<string, unknown>;
    const id = item.id === undefined ? undefined : positiveInteger(item.id);
    return item.id !== undefined && id === null ? null : { id: id ?? undefined, text: item.text as string };
  });
  if (parsedQuestions.some((question) => question === null)) return null;
  return {
    grade: grade as 11 | 12,
    title: value.title,
    guidanceMarkdown: value.guidance_markdown,
    questions: parsedQuestions as { id?: number; text: string }[],
  };
}

async function createOrAddPhase(
  value: Record<string, unknown>,
  actor: AuditActor,
  programId: number,
) {
  if (value.action === "create") {
    const academicYear = value.academic_year;
    const copyFrom = value.copy_from_academic_year;
    if (typeof academicYear !== "string" || (copyFrom !== undefined && typeof copyFrom !== "string")) {
      return holisticApiError("Invalid Academic Year");
    }
    return response(await createHolisticPhasePlan({
      academicYear,
      programId,
      copyFromAcademicYear: copyFrom as string | undefined,
      ...actor,
    }));
  }
  if (value.action === "add") {
    const parsed = definition(value);
    if (!parsed || typeof value.academic_year !== "string") {
      return holisticApiError("Invalid Phase definition");
    }
    return response(await addHolisticPhase({
      academicYear: value.academic_year,
      programId,
      ...actor,
      ...parsed,
    }));
  }
  return holisticApiError("Unknown action");
}

async function updatePhase(
  value: Record<string, unknown>,
  actor: AuditActor,
  programId: number,
) {
  const parsed = definition(value);
  const phaseId = positiveInteger(value.phase_id);
  const expectedRevision = positiveInteger(value.expected_revision);
  if (!parsed || !phaseId || !expectedRevision || typeof value.confirmed !== "boolean") {
    return holisticApiError("Invalid Phase definition");
  }
  return response(await updateHolisticPhase({
    phaseId,
    programId,
    expectedRevision,
    ...actor,
    confirmed: value.confirmed,
    ...parsed,
  }));
}

async function changePhaseState(
  value: Record<string, unknown>,
  actor: AuditActor,
  programId: number,
) {
  const phaseId = positiveInteger(value.phase_id);
  const expectedRevision = positiveInteger(value.expected_revision);
  const state = value.state === "open" || value.state === "locked" ? value.state : null;
  if (!phaseId || !expectedRevision || !state || value.confirmed !== true) {
    return holisticApiError("Invalid state change");
  }
  return response(await setHolisticPhaseState({
    phaseId,
    programId,
    expectedRevision,
    state,
    ...actor,
    confirmed: true,
  }));
}

function parsePhaseOrder(value: unknown): { id: number; expectedRevision: number }[] | null {
  if (!Array.isArray(value)) return null;
  const phases = value.map((phase) => {
    if (!phase || typeof phase !== "object") return null;
    const item = phase as Record<string, unknown>;
    const id = positiveInteger(item.id);
    const expectedRevision = positiveInteger(item.expected_revision);
    return id && expectedRevision ? { id, expectedRevision } : null;
  });
  return phases.some((phase) => !phase)
    ? null
    : phases as { id: number; expectedRevision: number }[];
}

async function reorderPhases(
  value: Record<string, unknown>,
  actor: AuditActor,
  programId: number,
) {
  const phases = parsePhaseOrder(value.phases);
  if (typeof value.academic_year !== "string" || !phases) {
    return holisticApiError("Invalid Phase order");
  }
  return response(await reorderHolisticPhases({
    academicYear: value.academic_year,
    programId,
    phases,
    ...actor,
  }));
}

export async function GET(request: NextRequest) {
  const programId = holisticProgramId(request.nextUrl.searchParams.get("program_id"));
  if (!programId) return holisticApiError("Invalid Program");
  const { access } = await sessionAccess("phase_configuration_read", programId);
  if (!access.ok) return holisticApiError(access.error, access.status);
  const academicYear = request.nextUrl.searchParams.get("academic_year") ?? CURRENT_ACADEMIC_YEAR;
  if (!validateAcademicYear(academicYear)) return holisticApiError("Invalid Academic Year");
  return NextResponse.json({ plan: await getHolisticPhasePlan(academicYear, programId) });
}

export async function POST(request: NextRequest) {
  const parsed = await configurationAction(request);
  if (!parsed.ok) return parsed.response;
  return createOrAddPhase(
    parsed.value,
    auditActor(parsed.access),
    parsed.programId,
  );
}

export async function PATCH(request: NextRequest) {
  const parsed = await configurationAction(request);
  if (!parsed.ok) return parsed.response;
  const { access, value } = parsed;
  const actor = auditActor(access);
  if (value.action === "update") return updatePhase(value, actor, parsed.programId);
  if (value.action === "state") return changePhaseState(value, actor, parsed.programId);
  if (value.action === "reorder") return reorderPhases(value, actor, parsed.programId);
  return holisticApiError("Unknown action");
}

export async function DELETE(request: NextRequest) {
  const value = await readJsonObject(request);
  const programId = value && holisticJsonProgramId(value.program_id);
  if (!programId) return holisticApiError("Invalid Program");
  const { access } = await sessionAccess("phase_configure", programId);
  if (!access.ok) return holisticApiError(access.error, access.status);
  const phaseId = value && positiveInteger(value.phase_id);
  const expectedRevision = value && positiveInteger(value.expected_revision);
  if (!phaseId || !expectedRevision) return holisticApiError("Invalid Phase");
  return response(await deleteHolisticPhase({
    phaseId,
    programId,
    expectedRevision,
    ...auditActor(access),
  }));
}
