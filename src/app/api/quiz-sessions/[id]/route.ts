import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  dbIstTimestampToUtcIso,
  utcToISTDate,
} from "@/lib/quiz-session-time";
import { publishMessage } from "@/lib/sns";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface PatchQuizSessionBody {
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

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const currentResponse = await fetch(`${DB_SERVICE_URL}/session/${sessionId}`, {
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (!currentResponse.ok) {
    const errorText = await currentResponse.text();
    console.error("Failed to fetch session for patch:", errorText);
    return NextResponse.json(
      { error: "Failed to load session for editing" },
      { status: currentResponse.status }
    );
  }

  const currentSession = (await currentResponse.json()) as DbServiceSession;
  const currentMetaData = normalizeMetaData(currentSession.meta_data);

  const nextStartTime = body.startTime ?? storedSessionTimeToUtcIso(currentSession.start_time);
  const nextEndTime = body.endTime ?? storedSessionTimeToUtcIso(currentSession.end_time);

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

  const payload: DbServiceSession = {
    ...currentSession,
    ...(typeof body.name === "string" ? { name: body.name.trim() || currentSession.name } : {}),
    ...(typeof body.isActive === "boolean" ? { is_active: body.isActive } : {}),
    ...(body.startTime ? { start_time: utcToISTDate(body.startTime) } : {}),
    ...(body.endTime ? { end_time: utcToISTDate(body.endTime) } : {}),
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
      status: "pending",
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
