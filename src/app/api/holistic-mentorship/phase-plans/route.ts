import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { query } from "@/lib/db";
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

function response(result: PhasePlanResult) {
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json(
        { error: result.error, currentRevision: result.currentRevision },
        { status: result.status }
      );
}

function error(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function sessionAccess(action: "program_read" | "phase_configure") {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, action);
  return { session, access };
}

async function body(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function revision(value: unknown): number | null {
  return positiveInteger(value);
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

async function actorUserId(email: string): Promise<number | null> {
  const rows = await query<{ id: number | string }>(
    `SELECT id FROM "user" WHERE LOWER(email) = LOWER($1) ORDER BY id LIMIT 1`,
    [email]
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function GET(request: NextRequest) {
  const { access } = await sessionAccess("program_read");
  if (!access.ok) return error(access.error, access.status);
  const academicYear = request.nextUrl.searchParams.get("academic_year") ?? CURRENT_ACADEMIC_YEAR;
  if (!validateAcademicYear(academicYear)) return error("Invalid Academic Year");
  return NextResponse.json({ plan: await getHolisticPhasePlan(academicYear) });
}

export async function POST(request: NextRequest) {
  const { access } = await sessionAccess("phase_configure");
  if (!access.ok) return error(access.error, access.status);
  const value = await body(request);
  if (!value || typeof value.action !== "string") return error("Invalid request body");
  if (value.action === "create") {
    const academicYear = value.academic_year;
    const copyFrom = value.copy_from_academic_year;
    if (typeof academicYear !== "string" || (copyFrom !== undefined && typeof copyFrom !== "string")) return error("Invalid Academic Year");
    return response(await createHolisticPhasePlan({ academicYear, copyFromAcademicYear: copyFrom as string | undefined }));
  }
  if (value.action === "add") {
    const parsed = definition(value);
    if (!parsed || typeof value.academic_year !== "string") return error("Invalid Phase definition");
    return response(await addHolisticPhase({ academicYear: value.academic_year, ...parsed }));
  }
  return error("Unknown action");
}

export async function PATCH(request: NextRequest) {
  const { access } = await sessionAccess("phase_configure");
  if (!access.ok) return error(access.error, access.status);
  const value = await body(request);
  if (!value || typeof value.action !== "string") return error("Invalid request body");
  if (value.action === "update") {
    const parsed = definition(value);
    const phaseId = positiveInteger(value.phase_id);
    const expectedRevision = revision(value.expected_revision);
    if (!parsed || !phaseId || !expectedRevision || typeof value.confirmed !== "boolean") return error("Invalid Phase definition");
    return response(await updateHolisticPhase({ phaseId, expectedRevision, confirmed: value.confirmed, ...parsed }));
  }
  if (value.action === "state") {
    const phaseId = positiveInteger(value.phase_id);
    const expectedRevision = revision(value.expected_revision);
    if (!phaseId || !expectedRevision || (value.state !== "open" && value.state !== "locked") || value.confirmed !== true) return error("Invalid state change");
    const actor = await actorUserId(access.email);
    if (!actor) return error("Actor not found", 422);
    return response(await setHolisticPhaseState({ phaseId, expectedRevision, state: value.state, actorUserId: actor, confirmed: true }));
  }
  if (value.action === "reorder") {
    if (typeof value.academic_year !== "string" || !Array.isArray(value.phases)) return error("Invalid Phase order");
    const phases = value.phases.map((phase) => {
      if (!phase || typeof phase !== "object") return null;
      const item = phase as Record<string, unknown>;
      const id = positiveInteger(item.id);
      const expectedRevision = revision(item.expected_revision);
      return id && expectedRevision ? { id, expectedRevision } : null;
    });
    if (phases.some((phase) => !phase)) return error("Invalid Phase order");
    return response(await reorderHolisticPhases({ academicYear: value.academic_year, phases: phases as { id: number; expectedRevision: number }[] }));
  }
  return error("Unknown action");
}

export async function DELETE(request: NextRequest) {
  const { access } = await sessionAccess("phase_configure");
  if (!access.ok) return error(access.error, access.status);
  const value = await body(request);
  const phaseId = value && positiveInteger(value.phase_id);
  const expectedRevision = value && revision(value.expected_revision);
  if (!phaseId || !expectedRevision) return error("Invalid Phase");
  return response(await deleteHolisticPhase({ phaseId, expectedRevision }));
}
