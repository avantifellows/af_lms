import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessQuizSessionBatches,
  requireQuizSessionAccess,
} from "@/lib/quiz-session-access";
import { query } from "@/lib/db";
import { utcToISTDate } from "@/lib/quiz-session-time";
import { EXAM_TRACKS, curriculumIdForExamTrack } from "@/lib/curriculum-options";
import type { ExamTrack } from "@/types/curriculum";

// Create a quiz session from a new-CMS test. This is the SYNCHRONOUS replacement for the
// legacy SNS -> etl-data-flow sessionCreator Lambda: af_lms builds the quiz in quiz-backend,
// then materializes the session in db-service itself (session row + one continuous
// occurrence + a group-session link per batch). No SNS is fired — the quiz already exists,
// so nothing runs after this returns. See task lms-cms-tests for the locked design.
// Trim env values — stray trailing whitespace/newlines in .env would corrupt `${URL}/path`.
const DB_SERVICE_URL = process.env.DB_SERVICE_URL?.trim();
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN?.trim();
const QUIZ_BACKEND_URL = process.env.QUIZ_BACKEND_URL?.trim();
// Auth/portal base a student opens the session on, e.g. https://staging-auth.avantifellows.org
const SESSION_PORTAL_URL = process.env.SESSION_PORTAL_URL?.trim();
// Quiz frontend base + AF org api key, used only to build the admin Q&A testing links
// (quiz player as whitelisted test_admin, no portal auth) — mirrors legacy sessionCreator.
// Optional: when unset the links stay blank, session creation itself is unaffected.
const QUIZ_FRONTEND_URL = process.env.QUIZ_FRONTEND_URL?.trim();
const QUIZ_AF_API_KEY = process.env.QUIZ_AF_API_KEY?.trim();
// AF link shortener (legacy sessionCreator parity), used for the student-facing session /
// OMR links and the report link. Optional: when unset (or on any failure) the full URL is
// stored instead — link population must never fail a create.
const AF_SHORTENER_URL = process.env.AF_SHORTENER_URL?.trim();
const AF_SHORTENER_AUTH_TOKEN = process.env.AF_SHORTENER_AUTH_TOKEN?.trim();

// Matches the group the session is filed under; also the session_id prefix (EnableStudents_<quizId>).
const SESSION_GROUP = "EnableStudents";
const CMS_TEST_TYPES = ["chapter_test", "major_test"];
const CMS_SOURCE = "nex-gen-cms";

interface CreateFromCmsBody {
  name?: string;
  cmsTestId?: number;
  testType?: string;
  examTrack?: ExamTrack;
  grade?: number;
  testName?: string;
  testCode?: string;
  parentBatchId?: string;
  classBatchIds?: string[];
  stream?: string;
  showAnswers?: boolean;
  showScores?: boolean;
  shuffle?: boolean;
  gurukulFormatType?: string;
  startTime?: string;
  endTime?: string;
}

function dbHeaders() {
  return {
    Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

// Best-effort AF-shortened URL (legacy shorten_url_AF): returns the original URL when the
// shortener is unconfigured, errors, or answers with anything unexpected.
async function shortenUrl(originalUrl: string, createdBy: string): Promise<string> {
  if (!AF_SHORTENER_URL || !AF_SHORTENER_AUTH_TOKEN) return originalUrl;
  try {
    const res = await fetch(`${AF_SHORTENER_URL.replace(/\/$/, "")}/shorten`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AF_SHORTENER_AUTH_TOKEN}`,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        original_url: originalUrl,
        custom_code: "",
        created_by: createdBy,
      }),
    });
    if (!res.ok) {
      console.warn(`URL shortener returned ${res.status} — storing full URL`);
      return originalUrl;
    }
    const data = (await res.json()) as { short_url?: string };
    return data.short_url || originalUrl;
  } catch (err) {
    console.warn("URL shortener unreachable — storing full URL:", err);
    return originalUrl;
  }
}

// batch_id (string code) -> db group id, via db-service: batch code -> batch pk -> group.
async function resolveGroupId(batchId: string): Promise<number | null> {
  const batchRes = await fetch(
    `${DB_SERVICE_URL}/batch?batch_id=${encodeURIComponent(batchId)}`,
    { headers: dbHeaders(), cache: "no-store" }
  );
  if (!batchRes.ok) return null;
  const batches = (await batchRes.json()) as { id: number }[];
  const batchPk = batches?.[0]?.id;
  if (!batchPk) return null;

  const groupRes = await fetch(
    `${DB_SERVICE_URL}/group/?child_id=${batchPk}&type=batch`,
    { headers: dbHeaders(), cache: "no-store" }
  );
  if (!groupRes.ok) return null;
  const groups = (await groupRes.json()) as { id: number }[];
  return groups?.[0]?.id ?? null;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "edit");
  if (!access.ok) {
    return access.response;
  }

  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    return NextResponse.json({ error: "DB service is not configured" }, { status: 500 });
  }
  if (!QUIZ_BACKEND_URL) {
    return NextResponse.json({ error: "Quiz backend is not configured" }, { status: 500 });
  }
  if (!SESSION_PORTAL_URL) {
    return NextResponse.json(
      { error: "SESSION_PORTAL_URL is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as CreateFromCmsBody;

  if (!body.cmsTestId || Number.isNaN(Number(body.cmsTestId))) {
    return NextResponse.json({ error: "cmsTestId is required" }, { status: 400 });
  }
  if (!body.examTrack || !EXAM_TRACKS.includes(body.examTrack)) {
    return NextResponse.json({ error: "Valid examTrack is required" }, { status: 400 });
  }
  if (body.grade !== 11 && body.grade !== 12) {
    return NextResponse.json({ error: "grade must be 11 or 12" }, { status: 400 });
  }
  if (!body.testType || !CMS_TEST_TYPES.includes(body.testType)) {
    return NextResponse.json({ error: "Valid testType is required" }, { status: 400 });
  }
  if (!body.parentBatchId) {
    return NextResponse.json({ error: "parentBatchId is required" }, { status: 400 });
  }
  if (!Array.isArray(body.classBatchIds) || body.classBatchIds.length === 0) {
    return NextResponse.json(
      { error: "At least one class batch is required" },
      { status: 400 }
    );
  }
  if (!(await canAccessQuizSessionBatches(access.permission, body.classBatchIds))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!body.stream) {
    return NextResponse.json({ error: "stream is required" }, { status: 400 });
  }
  if (!body.startTime || !body.endTime) {
    return NextResponse.json(
      { error: "startTime and endTime are required" },
      { status: 400 }
    );
  }
  const start = new Date(body.startTime);
  const end = new Date(body.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: "Invalid start or end time" }, { status: 400 });
  }

  const curriculumId = curriculumIdForExamTrack(body.examTrack);
  const gradeRows = await query<{ id: number }>(
    `SELECT id FROM grade WHERE number = $1 LIMIT 1`,
    [body.grade]
  );
  const gradeId = gradeRows[0]?.id;
  if (!gradeId) {
    return NextResponse.json(
      { error: `No grade row for grade ${body.grade}` },
      { status: 400 }
    );
  }

  // 1. Build the quiz in quiz-backend from the CMS test (this writes to quiz Mongo).
  let quizId: string;
  let warnings: string[] = [];
  try {
    const quizRes = await fetch(`${QUIZ_BACKEND_URL}/quiz/from-cms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        test_id: Number(body.cmsTestId),
        curriculum_id: curriculumId,
        grade_id: gradeId,
        quiz_type: "assessment",
      }),
    });
    if (!quizRes.ok) {
      const errorText = await quizRes.text();
      console.error("quiz-backend /quiz/from-cms failed:", quizRes.status, errorText);
      return NextResponse.json(
        { error: "Failed to build quiz from CMS test" },
        { status: 502 }
      );
    }
    const quizData = (await quizRes.json()) as { id: string; warnings?: string[] };
    quizId = quizData.id;
    warnings = quizData.warnings ?? [];
  } catch (err) {
    console.error("Failed to reach quiz backend:", err);
    return NextResponse.json({ error: "Failed to reach quiz backend" }, { status: 502 });
  }

  // 2. Materialize the session row. platform_id/session_id are known up front (unlike the
  // legacy flow, which left them blank for the Lambda to patch), so the session is complete
  // on create and needs no follow-up.
  const sessionIdStr = `${SESSION_GROUP}_${quizId}`;
  const portalLink = `${SESSION_PORTAL_URL.replace(/\/$/, "")}?sessionId=${sessionIdStr}`;
  const startIst = utcToISTDate(body.startTime);
  const endIst = utcToISTDate(body.endTime);
  const sessionName = body.name?.trim() || (body.testName ?? "").trim() || sessionIdStr;
  const shuffle = body.shuffle ?? false;
  const gurukulFormatType = shuffle ? "qa" : body.gurukulFormatType || "both";

  // Admin Q&A testing links: quiz player as the whitelisted test_admin user (legacy
  // sessionCreator parity). Blank when the frontend URL / api key aren't configured.
  let adminTestingLink = "";
  let adminTestingOmrLink = "";
  if (QUIZ_FRONTEND_URL && QUIZ_AF_API_KEY) {
    adminTestingLink =
      `${QUIZ_FRONTEND_URL.replace(/\/$/, "")}/quiz/${quizId}` +
      `?apiKey=${encodeURIComponent(QUIZ_AF_API_KEY)}&userId=test_admin`;
    adminTestingOmrLink = `${adminTestingLink}&omrMode=true`;
  } else {
    console.warn(
      "QUIZ_FRONTEND_URL / QUIZ_AF_API_KEY not configured — admin testing links left blank"
    );
  }

  // Student-facing shortened session/OMR links + the attendance report link (legacy
  // sessionCreator parity; each falls back to its full URL if the shortener is unavailable).
  const createdBy = session.user.email;
  const shortenedLink = await shortenUrl(portalLink, createdBy);
  const shortenedOmrLink = await shortenUrl(`${portalLink}&omrMode=true`, createdBy);
  const reportLink = await shortenUrl(
    `${SESSION_PORTAL_URL.replace(/\/$/, "")}?type=attendance&platform=report` +
      `&platform_id=${sessionIdStr}&authGroup=${SESSION_GROUP}&auth_type=ID,DOB`,
    createdBy
  );

  const sessionPayload = {
    name: sessionName,
    platform: "quiz",
    type: "sign-in",
    auth_type: "ID,DOB",
    redirection: true,
    id_generation: false,
    signup_form: false,
    popup_form: false,
    signup_form_id: null,
    popup_form_id: null,
    session_id: sessionIdStr,
    platform_id: quizId,
    platform_link: quizId,
    portal_link: portalLink,
    start_time: startIst,
    end_time: endIst,
    repeat_schedule: { type: "continuous", params: [1, 2, 3, 4, 5, 6, 7] },
    is_active: true,
    purpose: { type: "attendance", params: "quiz" },
    meta_data: {
      group: SESSION_GROUP,
      parent_id: body.parentBatchId,
      batch_id: body.classBatchIds.join(","),
      grade: body.grade,
      stream: body.stream,
      test_code: body.testCode ?? "",
      test_name: body.testName ?? sessionName,
      test_format: body.testType,
      test_purpose: "test",
      test_type: "assessment",
      gurukul_format_type: gurukulFormatType,
      marking_scheme: "4,-1",
      optional_limits: null,
      cms_source: CMS_SOURCE,
      cms_test_id: String(body.cmsTestId),
      cms_source_id: String(body.cmsTestId),
      // Persist what the on-demand PDF proxy needs to re-fetch the test from the CMS.
      cms_curriculum_id: String(curriculumId),
      cms_grade_id: String(gradeId),
      has_synced_to_bq: false,
      infinite_session: false,
      report_link: reportLink,
      shortened_link: shortenedLink,
      shortened_omr_link: shortenedOmrLink,
      admin_testing_link: adminTestingLink,
      admin_testing_omr_link: adminTestingOmrLink,
      show_answers: body.showAnswers ?? true,
      show_scores: body.showScores ?? true,
      shuffle,
      single_page_mode: false,
      test_takers_count: 100,
      status: "success",
      date_created: utcToISTDate(new Date().toISOString()),
      created_by: session.user.email,
      created_from: "lms",
    },
  };

  const sessionRes = await fetch(`${DB_SERVICE_URL}/session`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify(sessionPayload),
  });
  if (!sessionRes.ok) {
    const errorText = await sessionRes.text();
    console.error("DB service /session error:", sessionRes.status, errorText);
    return NextResponse.json(
      { error: "Failed to create session", quizId },
      { status: sessionRes.status }
    );
  }
  const sessionData = (await sessionRes.json()) as { id: number };
  const sessionPk = sessionData.id;

  // If a later step fails, don't leave a live-looking session behind: mark it inactive and
  // failed (best-effort — the create already failed, so this must not mask that error).
  async function markSessionFailed(reason: string) {
    try {
      const res = await fetch(`${DB_SERVICE_URL}/session/${sessionPk}`, {
        method: "PATCH",
        headers: dbHeaders(),
        body: JSON.stringify({
          is_active: false,
          meta_data: { ...sessionPayload.meta_data, status: "failed" },
        }),
      });
      if (!res.ok) {
        console.error(
          `Failed to mark session ${sessionPk} failed after ${reason}:`,
          res.status,
          await res.text()
        );
      }
    } catch (err) {
      console.error(`Failed to mark session ${sessionPk} failed after ${reason}:`, err);
    }
  }

  // 3. One occurrence spanning the whole window (continuous session), mirroring the Lambda.
  const occRes = await fetch(`${DB_SERVICE_URL}/session-occurrence`, {
    method: "POST",
    headers: dbHeaders(),
    body: JSON.stringify({
      start_time: startIst,
      end_time: endIst,
      session_fk: sessionPk,
      session_id: sessionIdStr,
    }),
  });
  if (!occRes.ok) {
    const errorText = await occRes.text();
    console.error("DB service /session-occurrence error:", occRes.status, errorText);
    await markSessionFailed("occurrence failure");
    return NextResponse.json(
      {
        error: "Occurrence creation failed — session was deactivated. Retry the create.",
        id: sessionPk,
        quizId,
      },
      { status: occRes.status }
    );
  }

  // 4. Link each class batch's group to the session so its students can access it.
  for (const batchId of body.classBatchIds) {
    const groupId = await resolveGroupId(batchId);
    if (!groupId) {
      console.error(`Could not resolve group for batch ${batchId}`);
      await markSessionFailed(`unresolvable batch ${batchId}`);
      return NextResponse.json(
        {
          error: `Could not resolve group for batch ${batchId} — session was deactivated. Retry the create.`,
          id: sessionPk,
          quizId,
        },
        { status: 502 }
      );
    }
    const groupSessionRes = await fetch(`${DB_SERVICE_URL}/group-session`, {
      method: "POST",
      headers: dbHeaders(),
      body: JSON.stringify({ session_id: sessionPk, group_id: groupId }),
    });
    if (!groupSessionRes.ok) {
      const errorText = await groupSessionRes.text();
      console.error("DB service /group-session error:", groupSessionRes.status, errorText);
      await markSessionFailed(`group-session failure for batch ${batchId}`);
      return NextResponse.json(
        {
          error: `Failed to link batch ${batchId} — session was deactivated. Retry the create.`,
          id: sessionPk,
          quizId,
        },
        { status: groupSessionRes.status }
      );
    }
  }

  return NextResponse.json({ id: sessionPk, quizId, sessionId: sessionIdStr, warnings });
}
