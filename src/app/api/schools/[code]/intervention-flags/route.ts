import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import {
  InterventionFlagError,
  authorizeInterventionFlags,
  listSchoolFlags,
  type InterventionFlagAction,
  raiseFlag,
  validateNote,
} from "@/lib/intervention-flags";
import { getStudentSchool } from "@/lib/permissions";

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

async function authorize(
  params: Promise<{ code: string }>,
  action: InterventionFlagAction,
) {
  const session = await getServerSession(authOptions);
  const { code } = await params;
  return authorizeInterventionFlags(session, code, action);
}

// GET /api/schools/[code]/intervention-flags
// Every intervention flag raised at the school (open and resolved) with its
// update history: `{ flags: InterventionFlag[] }`.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const auth = await authorize(params, "view");
  if (!auth.ok) return auth.response;

  const flags = await listSchoolFlags(auth.school.id);
  return NextResponse.json({ flags });
}

// POST /api/schools/[code]/intervention-flags  { studentPkId, note }
// Raise a flag on a Student at this school, with its first note.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const auth = await authorize(params, "edit");
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => null)) as {
    studentPkId?: unknown;
    note?: unknown;
  } | null;
  const studentPkId = Number(body?.studentPkId);
  if (!Number.isInteger(studentPkId) || studentPkId <= 0) {
    return jsonError(400, "studentPkId must be a positive integer");
  }
  const note = validateNote(body?.note, { required: true });
  if (!note.ok) return jsonError(400, note.error);

  // The Student must be on this school's roster, not just any Student id.
  const studentSchool = await getStudentSchool(studentPkId);
  if (!studentSchool || studentSchool.code !== auth.school.code) {
    return jsonError(404, "Student not found at this school");
  }

  try {
    const flag = await withTransaction((client) =>
      raiseFlag(client, {
        studentPkId,
        schoolId: auth.school.id,
        programId: studentSchool.program_id,
        actor: auth.actor,
        note: note.note,
      }),
    );
    return NextResponse.json({ flag }, { status: 201 });
  } catch (error) {
    if (error instanceof InterventionFlagError) return jsonError(error.status, error.message);
    throw error;
  }
}
