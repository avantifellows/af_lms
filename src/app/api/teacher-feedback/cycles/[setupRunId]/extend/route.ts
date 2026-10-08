import { NextRequest, NextResponse } from "next/server";

import { query } from "@/lib/db";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import { loadAuthorizedRound } from "@/lib/teacher-feedback-rounds";
import { extendFeedbackSession } from "@/lib/teacher-feedback-session";

// Stored times are UTC; `::text` may or may not carry an offset.
function parseUtc(value: string | null): Date | null {
  if (!value) return null;
  const iso = value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");
  return new Date(/(Z|[+-]\d\d:\d\d)$/.test(iso) ? iso : `${iso}Z`);
}

// POST /api/teacher-feedback/cycles/:setupRunId/extend  { endTime: ISO (UTC) }
// Moves the whole round's end: every teacher's session + occurrence, then the
// lms_teacher_feedback rows (UTC), so students who missed it can still fill it.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ setupRunId: string }> }
) {
  const access = await authenticateTeacherFeedback("edit");
  if (!access.ok) return access.response;

  const { setupRunId } = await params;
  const round = await loadAuthorizedRound(setupRunId, access.permission);
  if (!round.ok) return round.response;

  const body = (await request.json().catch(() => null)) as { endTime?: unknown } | null;
  const end = typeof body?.endTime === "string" ? new Date(body.endTime) : null;
  const start = parseUtc(round.rows[0].start_time);
  if (!end || Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) {
    return NextResponse.json({ error: "New end time must be in the future" }, { status: 400 });
  }
  if (start && end <= start) {
    return NextResponse.json({ error: "New end time must be after the start" }, { status: 400 });
  }
  const endUtc = end.toISOString();

  const failed: string[] = [];
  for (const row of round.rows) {
    if (row.session_pk == null) {
      failed.push(row.teacher_name);
      continue;
    }
    try {
      await extendFeedbackSession(Number(row.session_pk), row.session_id, endUtc);
      await query(
        `UPDATE lms_teacher_feedback SET end_time = $1, updated_at = now()
         WHERE setup_run_id = $2 AND session_pk = $3 AND deleted_at IS NULL`,
        [endUtc, setupRunId, Number(row.session_pk)]
      );
    } catch (error) {
      console.error(`Teacher feedback extend failed for ${setupRunId}:`, error);
      failed.push(row.teacher_name);
    }
  }

  if (failed.length > 0) {
    return NextResponse.json(
      { error: `Could not extend for: ${failed.join(", ")}. Others were extended.` },
      { status: 502 }
    );
  }
  return NextResponse.json({ success: true, endTime: endUtc });
}
