import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessQuizSessionBatches,
  requireQuizSessionAccess,
} from "@/lib/quiz-session-access";
import { query } from "@/lib/db";
import {
  dbIstTimestampToUtcIso,
  istWallClockWindowEnd,
  utcToISTDate,
} from "@/lib/quiz-session-time";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;
const QUIZ_BACKEND_URL = process.env.QUIZ_BACKEND_URL;

interface PatchQuizSessionBody {
  action?: "end_now";
  name?: string;
  startTime?: string;
  endTime?: string;
  showAnswers?: boolean;
  showScores?: boolean;
  shuffle?: boolean;
  gurukulFormatType?: string;
  isActive?: boolean;
}

interface DbServiceSession {
  id: number;
  name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_active?: boolean | null;
  meta_data?: Record<string, unknown> | string | null;
  [key: string]: unknown;
}

interface SessionRow {
  id: number;
  name: string | null;
  platform_id: string | null;
  session_id: string | null;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean | null;
  meta_data: Record<string, unknown> | string | null;
}

function normalizeMetaData(
  value: Record<string, unknown> | string | null | undefined
): Record<string, unknown> {
  if (!value) return {};

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  return value;
}

function storedSessionTimeToUtcIso(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value)) {
    return value;
  }
  return dbIstTimestampToUtcIso(value);
}

function isLiveWindow(start: Date | null, end: Date | null, now: Date): boolean {
  if (!start || !end) return false;
  return start.getTime() <= now.getTime() && now.getTime() < end.getTime();
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "edit");
  if (!access.ok) {
    return access.response;
  }

  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN || !QUIZ_BACKEND_URL) {
    return NextResponse.json(
      { error: "Session services are not configured" },
      { status: 500 }
    );
  }

  const { id } = await params;
  const sessionId = Number(id);
  if (Number.isNaN(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const body = (await request.json()) as PatchQuizSessionBody;

  const currentSessionRows = await query<SessionRow>(
    `
    SELECT id, name, platform_id, session_id,
           start_time::text AS start_time, end_time::text AS end_time,
           is_active, meta_data
    FROM session
    WHERE id = $1
    LIMIT 1
    `,
    [sessionId]
  );

  const currentSession = currentSessionRows[0];
  if (!currentSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const currentMetaData = normalizeMetaData(currentSession.meta_data);
  const currentBatchIds =
    typeof currentMetaData.batch_id === "string"
      ? currentMetaData.batch_id.split(",").filter(Boolean)
      : [];
  if (!(await canAccessQuizSessionBatches(access.permission, currentBatchIds))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const currentStartTime = storedSessionTimeToUtcIso(currentSession.start_time);
  const currentEndTime = storedSessionTimeToUtcIso(currentSession.end_time);

  const nextStartTime = body.startTime ?? currentStartTime;
  let nextEndTime = body.endTime ?? currentEndTime;

  if (body.action === "end_now") {
    const now = new Date();
    const currentStart = currentStartTime ? new Date(currentStartTime) : null;
    const currentEnd = currentEndTime ? new Date(currentEndTime) : null;

    if (
      !currentStart ||
      !currentEnd ||
      Number.isNaN(currentStart.getTime()) ||
      Number.isNaN(currentEnd.getTime()) ||
      !isLiveWindow(currentStart, currentEnd, now)
    ) {
      return NextResponse.json(
        { error: "Only live sessions can be ended now" },
        { status: 400 }
      );
    }

    nextEndTime = now.toISOString();
  }

  const start = nextStartTime ? new Date(nextStartTime) : null;
  const end = nextEndTime ? new Date(nextEndTime) : null;

  if (
    !start ||
    !end ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return NextResponse.json(
      { error: "Invalid start or end time" },
      { status: 400 }
    );
  }

  const nextShuffle =
    typeof body.shuffle === "boolean" ? body.shuffle : currentMetaData.shuffle === true;
  const nextGurukulFormatType =
    typeof body.gurukulFormatType === "string"
      ? body.gurukulFormatType
      : undefined;

  const payload: Partial<DbServiceSession> = {
    ...(typeof body.name === "string" ? { name: body.name.trim() || currentSession.name } : {}),
    ...(typeof body.isActive === "boolean" ? { is_active: body.isActive } : {}),
    ...(body.startTime ? { start_time: utcToISTDate(body.startTime) } : {}),
    ...(body.endTime ? { end_time: utcToISTDate(body.endTime) } : {}),
    ...(body.action === "end_now" && nextEndTime
      ? { end_time: utcToISTDate(nextEndTime) }
      : {}),
    meta_data: {
      ...currentMetaData,
      ...(typeof body.showAnswers === "boolean"
        ? { show_answers: body.showAnswers }
        : {}),
      ...(typeof body.showScores === "boolean"
        ? { show_scores: body.showScores }
        : {}),
      ...(typeof body.shuffle === "boolean" ? { shuffle: body.shuffle } : {}),
      ...(nextGurukulFormatType || nextShuffle
        ? { gurukul_format_type: nextShuffle ? "qa" : nextGurukulFormatType }
        : {}),
      // Edit audit trail. etl-data-flow only ever READS these (sheet round-trip and
      // log_session_action's actor lookup) — the actor is whoever performs the action, so
      // with the SNS hop gone the LMS is now the only writer. Field names match
      // sessionCreator's ACTION_ACTOR_FIELDS.
      last_edited_by: session.user.email,
      last_edited_at: utcToISTDate(new Date().toISOString()),
    },
  };

  const patchResponse = await fetch(`${DB_SERVICE_URL}/session/${sessionId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!patchResponse.ok) {
    const errorText = await patchResponse.text();
    console.error("Failed to patch session:", errorText);
    return NextResponse.json(
      { error: "Failed to update session" },
      { status: patchResponse.status }
    );
  }

  // The portal gates quiz entry on the session_occurrence window (not the session
  // row), so a timing change must be mirrored onto the occurrence or the quiz would
  // keep opening/closing at the old time. Quiz sessions are continuous → a single
  // occurrence spanning the window.
  const timingChanged = Boolean(
    body.startTime || body.endTime || body.action === "end_now"
  );
  if (timingChanged && currentSession.session_id) {
    // Derive from the validated Date objects, not the raw nullable strings: both are proven
    // non-null and parseable by the window validation above, so there's no cast needed.
    const occStart = utcToISTDate(start.toISOString());
    const occEnd = utcToISTDate(end.toISOString());

    const occListResponse = await fetch(
      `${DB_SERVICE_URL}/session-occurrence?session_id=${encodeURIComponent(
        currentSession.session_id
      )}`,
      { headers: { Authorization: `Bearer ${DB_SERVICE_TOKEN}` } }
    );

    if (!occListResponse.ok) {
      console.error(
        "Failed to load session occurrence:",
        await occListResponse.text()
      );
      return NextResponse.json(
        { error: "Session updated but failed to update its schedule" },
        { status: 502 }
      );
    }

    const occurrences = (await occListResponse.json()) as Array<{ id: number }>;
    const occurrence = Array.isArray(occurrences) ? occurrences[0] : undefined;

    // No occurrence means portal has nothing to re-gate on and would keep enforcing the old
    // window — exactly the failure this sync exists to prevent. Fail loudly: silently
    // returning 200 here would show the operator a new window that isn't in force.
    if (!occurrence?.id) {
      console.error(
        `No session_occurrence found for session_id ${currentSession.session_id} ` +
          `(session ${sessionId}); timing change is not in force for students`
      );
      return NextResponse.json(
        { error: "Session updated but its schedule could not be found to update" },
        { status: 502 }
      );
    }

    if (occurrences.length > 1) {
      // Quiz sessions are continuous → exactly one occurrence. More than one means the
      // invariant broke; patching only the first would leave a stale window behind.
      console.warn(
        `Session ${sessionId} has ${occurrences.length} occurrences; expected 1 ` +
          `(continuous quiz session). Patching only the first.`
      );
    }

    const occPatchResponse = await fetch(
      `${DB_SERVICE_URL}/session-occurrence/${occurrence.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ start_time: occStart, end_time: occEnd }),
      }
    );
    if (!occPatchResponse.ok) {
      console.error(
        "Failed to patch session occurrence:",
        await occPatchResponse.text()
      );
      return NextResponse.json(
        { error: "Session updated but failed to update its schedule" },
        { status: 502 }
      );
    }
  }

  // The quiz-taking frontend reads display/scoring settings from the quiz doc, not
  // the session, so sync the editable fields onto the quiz in place (same quizId).
  const quizId = currentSession.platform_id;
  if (quizId) {
    const quizPatch: Record<string, unknown> = {
      ...(typeof body.name === "string" && body.name.trim()
        ? { title: body.name.trim() }
        : {}),
      ...(typeof body.shuffle === "boolean" ? { shuffle: body.shuffle } : {}),
      ...(typeof body.showScores === "boolean"
        ? { show_scores: body.showScores }
        : {}),
      // "show answers immediately after submission"
      ...(typeof body.showAnswers === "boolean"
        ? { review_immediate: body.showAnswers }
        : {}),
      // Raw IST window end — quiz-backend adds the quiz duration to derive the stored
      // answer-visibility time, so it must NOT be pre-offset here or the offset doubles.
      ...(timingChanged
        ? { session_end_time: istWallClockWindowEnd(end.toISOString()) }
        : {}),
    };

    if (Object.keys(quizPatch).length > 0) {
      const quizPatchResponse = await fetch(`${QUIZ_BACKEND_URL}/quiz/${quizId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quizPatch),
      });
      if (!quizPatchResponse.ok) {
        console.error(
          "Failed to sync quiz doc:",
          await quizPatchResponse.text()
        );
        return NextResponse.json(
          { error: "Session updated but failed to sync quiz settings" },
          { status: 502 }
        );
      }
    }
  }

  return NextResponse.json({ id: sessionId });
}
