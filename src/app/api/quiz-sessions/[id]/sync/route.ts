import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;
const QUIZ_ETL_HELPER_URL = process.env.QUIZ_ETL_HELPER_URL;

interface SessionRow {
  id: number;
  session_id: string | null;
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

async function patchSessionMetaData(
  sessionPkId: number,
  nextMetaData: Record<string, unknown>
) {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("DB service is not configured");
  }

  const response = await fetch(`${DB_SERVICE_URL}/session/${sessionPkId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ meta_data: nextMetaData }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Failed to update session sync status");
  }
}

async function callHelper(message: string, dedupeId?: string) {
  if (!QUIZ_ETL_HELPER_URL) {
    throw new Error("QUIZ_ETL_HELPER_URL is not configured");
  }

  const url = new URL(QUIZ_ETL_HELPER_URL);
  url.searchParams.set("message", message);
  if (dedupeId) {
    url.searchParams.set("dedupe_id", dedupeId);
  }

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as
    | { message?: string; error?: string }
    | null;

  return { ok: response.ok, status: response.status, data };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const sessionPkId = Number(id);
  if (Number.isNaN(sessionPkId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const sessionRows = await query<SessionRow>(
    `
    SELECT id, session_id, meta_data
    FROM session
    WHERE id = $1
    LIMIT 1
    `,
    [sessionPkId]
  );

  const currentSession = sessionRows[0];
  if (!currentSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (!currentSession.session_id) {
    return NextResponse.json(
      { error: "Session is missing auth-layer session_id" },
      { status: 400 }
    );
  }

  const currentMetaData = normalizeMetaData(currentSession.meta_data);
  const syncDedupeId = `${currentSession.session_id}-${Date.now()}`;

  const enqueueResult = await callHelper(
    currentSession.session_id,
    syncDedupeId
  ).catch((error) => ({
    ok: false,
    status: 500,
    data: { error: error instanceof Error ? error.message : "Failed to queue sync" },
  }));

  if (!enqueueResult.ok) {
    try {
      await patchSessionMetaData(sessionPkId, {
        ...currentMetaData,
        etl_sync_status: "failed",
      });
    } catch (patchError) {
      console.error("Failed to persist sync failure state:", patchError);
    }

    return NextResponse.json(
      { error: enqueueResult.data?.error || "Failed to queue sync" },
      { status: enqueueResult.status }
    );
  }

  const mergeResult = await callHelper("merge").catch((error) => ({
    ok: false,
    status: 500,
    data: { error: error instanceof Error ? error.message : "Failed to queue merge" },
  }));

  if (!mergeResult.ok) {
    try {
      await patchSessionMetaData(sessionPkId, {
        ...currentMetaData,
        etl_sync_status: "failed",
      });
    } catch (patchError) {
      console.error("Failed to persist merge failure state:", patchError);
    }

    return NextResponse.json(
      { error: mergeResult.data?.error || "Failed to queue merge" },
      { status: mergeResult.status }
    );
  }

  await patchSessionMetaData(sessionPkId, {
    ...currentMetaData,
    etl_sync_status: "pending",
  });

  const startWorkerResult = await callHelper("start_worker").catch((error) => ({
    ok: false,
    status: 500,
    data: { error: error instanceof Error ? error.message : "Failed to start worker" },
  }));

  if (!startWorkerResult.ok && startWorkerResult.status !== 409) {
    console.error("Failed to start ETL worker after queueing sync:", startWorkerResult.data);

    return NextResponse.json({
      ok: true,
      warning: "Sync requested. It may take a little longer than usual.",
    });
  }

  return NextResponse.json({
    ok: true,
    message: "Sync requested. Updated results should appear shortly.",
  });
}
