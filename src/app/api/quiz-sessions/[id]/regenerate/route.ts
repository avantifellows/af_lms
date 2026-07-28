import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessQuizSessionBatches,
  requireQuizSessionAccess,
} from "@/lib/quiz-session-access";
import { query } from "@/lib/db";
import { publishMessage } from "@/lib/sns";
import { CMS_SOURCE } from "@/lib/cms-tests";
import {
  dbIstTimestampToUtcIso,
  istWallClockWindowEnd,
  utcToISTDate,
} from "@/lib/quiz-session-time";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;
const QUIZ_BACKEND_URL = process.env.QUIZ_BACKEND_URL?.trim();

interface SessionRow {
  id: number;
  platform_id: string | null;
  end_time: string | null;
  meta_data: Record<string, unknown> | string | null;
}

function metaString(
  meta: Record<string, unknown>,
  key: string
): string | undefined {
  const value = meta[key];
  return typeof value === "string" && value ? value : undefined;
}

// The stored session end_time is IST wall-clock (no offset) unless it already carries one.
// quiz-backend wants the raw IST window end; it derives answer-visibility itself.
function storedEndTimeToIstWallClock(value: string | null): string | undefined {
  if (!value) return undefined;
  const utcIso = /[zZ]$|[+-]\d{2}:\d{2}$/.test(value)
    ? value
    : dbIstTimestampToUtcIso(value);
  if (!utcIso) return undefined;
  return istWallClockWindowEnd(utcIso);
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

export async function POST(
  _request: Request,
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

  const { id } = await params;
  const sessionId = Number(id);
  if (Number.isNaN(sessionId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    return NextResponse.json(
      { error: "DB service is not configured" },
      { status: 500 }
    );
  }

  const sessionRows = await query<SessionRow>(
    `
    SELECT id, platform_id, end_time::text AS end_time, meta_data
    FROM session
    WHERE id = $1
    LIMIT 1
    `,
    [sessionId]
  );

  const currentSession = sessionRows[0];
  if (!currentSession) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const metaData = normalizeMetaData(currentSession.meta_data);
  const batchIds =
    typeof metaData.batch_id === "string"
      ? metaData.batch_id.split(",").filter(Boolean)
      : [];
  if (!(await canAccessQuizSessionBatches(access.permission, batchIds))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // CMS-sourced sessions regenerate synchronously against quiz-backend: the legacy SNS path
  // routes into etl-data-flow, which rebuilds from a Google Sheet row and cannot reconstruct
  // a new-CMS quiz at all. PUT /quiz/{id}/from-cms re-ingests the corrected test into the
  // SAME quiz id (and the same question ids), so the session and submitted attempts stay
  // linked. Legacy sessions keep the SNS path below.
  if (metaString(metaData, "cms_source") === CMS_SOURCE) {
    return regenerateFromCms(
      sessionId,
      currentSession,
      metaData,
      session.user.email
    );
  }

  const patchResponse = await fetch(`${DB_SERVICE_URL}/session/${sessionId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meta_data: {
        ...metaData,
        status: "pending",
      },
    }),
  });

  if (!patchResponse.ok) {
    const errorText = await patchResponse.text();
    console.error("Failed to queue regeneration:", errorText);
    return NextResponse.json(
      { error: "Failed to queue regeneration" },
      { status: patchResponse.status }
    );
  }

  await publishMessage({ action: "regenerate_quiz", id: sessionId });
  return NextResponse.json({ ok: true, message: "Regeneration requested." });
}

async function regenerateFromCms(
  sessionId: number,
  currentSession: SessionRow,
  metaData: Record<string, unknown>,
  actorEmail: string
) {
  if (!QUIZ_BACKEND_URL) {
    return NextResponse.json(
      { error: "Quiz backend is not configured" },
      { status: 500 }
    );
  }

  const quizId = currentSession.platform_id;
  const cmsTestId = metaString(metaData, "cms_test_id");
  const curriculumId = metaString(metaData, "cms_curriculum_id");
  const gradeId = metaString(metaData, "cms_grade_id");

  if (!quizId || !cmsTestId || !curriculumId || !gradeId) {
    console.error(
      `Session ${sessionId} is CMS-sourced but missing regenerate identifiers ` +
        `(platform_id=${quizId}, cms_test_id=${cmsTestId}, ` +
        `cms_curriculum_id=${curriculumId}, cms_grade_id=${gradeId})`
    );
    return NextResponse.json(
      { error: "Session is missing the CMS identifiers needed to regenerate" },
      { status: 422 }
    );
  }

  // Re-send the window end so answer-visibility is recomputed against the refreshed quiz
  // duration (a corrected test may change time_limit). Omitted if unparseable — quiz-backend
  // then preserves the existing value rather than dropping the gate.
  const sessionEndTime = storedEndTimeToIstWallClock(currentSession.end_time);

  let response: Response;
  try {
    response = await fetch(`${QUIZ_BACKEND_URL}/quiz/${quizId}/from-cms`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        test_id: Number(cmsTestId),
        curriculum_id: Number(curriculumId),
        grade_id: Number(gradeId),
        quiz_type: "assessment",
        ...(sessionEndTime ? { session_end_time: sessionEndTime } : {}),
      }),
    });
  } catch (err) {
    console.error("Failed to reach quiz backend for regenerate:", err);
    return NextResponse.json(
      { error: "Failed to reach quiz backend" },
      { status: 502 }
    );
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `CMS regenerate failed for session ${sessionId} (quiz ${quizId}):`,
      response.status,
      errorText
    );

    // 409 = the corrected test no longer lines up with the existing quiz (a question was
    // reordered, or deleted and re-added). quiz-backend refuses rather than remapping answer
    // keys onto the wrong questions, so surface that verbatim — it needs a human decision.
    if (response.status === 409) {
      return NextResponse.json(
        {
          error:
            "The corrected test's structure no longer matches this quiz (questions were " +
            "reordered, added or removed). Regenerating would misalign the answer key for " +
            "students who already submitted, so it was refused. Create a new session from " +
            "the corrected test instead.",
        },
        { status: 409 }
      );
    }
    if (response.status === 404) {
      return NextResponse.json(
        { error: "The quiz for this session no longer exists in quiz-backend" },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: "Failed to regenerate the quiz from the CMS test" },
      { status: 502 }
    );
  }

  const result = (await response.json()) as { warnings?: string[] };
  const warnings = result.warnings ?? [];

  // Record who regenerated, for the same audit trail legacy kept in meta_data. Best-effort:
  // the quiz itself is already refreshed, so a failure here must not read as a failed
  // regenerate — log it and still report success.
  const auditPatch = await fetch(`${DB_SERVICE_URL}/session/${sessionId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      meta_data: {
        ...metaData,
        status: "success",
        last_regenerated_by: actorEmail,
        last_regenerated_at: utcToISTDate(new Date().toISOString()),
      },
    }),
  });
  if (!auditPatch.ok) {
    console.error(
      `Quiz ${quizId} regenerated but failed to stamp the audit fields on session ` +
        `${sessionId}:`,
      await auditPatch.text()
    );
  }

  return NextResponse.json({
    ok: true,
    message:
      "Quiz regenerated from the corrected CMS test. Existing attempts keep their " +
      "original scores — they are not re-graded against the new answer key.",
    warnings,
  });
}
