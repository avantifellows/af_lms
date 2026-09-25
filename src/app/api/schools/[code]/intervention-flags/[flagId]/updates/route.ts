import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { withTransaction } from "@/lib/db";
import {
  InterventionFlagError,
  addFlagUpdate,
  authorizeInterventionFlags,
  validateNote,
} from "@/lib/intervention-flags";

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

// POST /api/schools/[code]/intervention-flags/[flagId]/updates  { note?, resolve? }
// Add a follow-up note to a flag, optionally resolving it. A note is required
// unless resolving.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string; flagId: string }> },
) {
  const session = await getServerSession(authOptions);
  const { code, flagId: flagIdParam } = await params;
  const auth = await authorizeInterventionFlags(session, code, "edit");
  if (!auth.ok) return auth.response;

  const flagId = Number(flagIdParam);
  if (!Number.isInteger(flagId) || flagId <= 0) {
    return jsonError(400, "Invalid flag id");
  }

  const body = (await request.json().catch(() => null)) as {
    note?: unknown;
    resolve?: unknown;
  } | null;
  if (body?.resolve != null && typeof body.resolve !== "boolean") {
    return jsonError(400, "resolve must be a boolean");
  }
  const resolve = body?.resolve === true;
  const note = validateNote(body?.note, { required: !resolve });
  if (!note.ok) return jsonError(400, note.error);

  try {
    const result = await withTransaction((client) =>
      addFlagUpdate(client, {
        flagId,
        schoolId: auth.school.id,
        actor: auth.actor,
        note: note.note,
        resolve,
      }),
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof InterventionFlagError) return jsonError(error.status, error.message);
    throw error;
  }
}
