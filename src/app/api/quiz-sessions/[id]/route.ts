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
  utcToISTDate,
} from "@/lib/quiz-session-time";
import { publishMessage } from "@/lib/sns";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

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

  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    return NextResponse.json(
      { error: "DB service is not configured" },
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
    SELECT id, name, start_time::text AS start_time, end_time::text AS end_time, is_active, meta_data
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
      ...(typeof body.gurukulFormatType === "string"
        ? { gurukul_format_type: body.gurukulFormatType }
        : {}),
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

  await publishMessage({ action: "patch", id: sessionId, patch_session: payload });

  return NextResponse.json({ id: sessionId });
}
