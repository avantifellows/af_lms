import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import { istToUTCDate, utcToISTDate } from "@/lib/quiz-session-time";
import { publishMessage } from "@/lib/sns";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface SessionRow {
  id: number;
  name: string;
  start_time: string | null;
  end_time: string | null;
  is_active: boolean | null;
  meta_data: Record<string, unknown> | null;
  platform: string | null;
}

interface BatchRow {
  id: number;
  name: string;
  batch_id: string;
  parent_id: number | null;
  program_id: number | null;
}

async function getBatchesForSchool(
  schoolId: number,
  programIds: number[]
): Promise<BatchRow[]> {
  if (programIds.length === 0) return [];

  let batches = await query<BatchRow>(
    `
    SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
    FROM school_batch sb
    JOIN batch b ON b.id = sb.batch_id
    WHERE sb.school_id = $1
      AND b.program_id = ANY($2::int[])
      AND b.batch_id LIKE 'EnableStudents_%'
    ORDER BY b.name
    `,
    [schoolId, programIds]
  );

  if (batches.length === 0) {
    batches = await query<BatchRow>(
      `
      SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
      FROM batch b
      WHERE b.program_id = ANY($1::int[])
        AND b.batch_id LIKE 'EnableStudents_%'
      ORDER BY b.name
      `,
      [programIds]
    );
  }

  return batches;
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const schoolIdParam = searchParams.get("schoolId");
  const classBatchId = searchParams.get("classBatchId");
  const page = Number(searchParams.get("page") || "0");
  const perPage = Number(searchParams.get("per_page") || "50");

  if (!schoolIdParam) {
    return NextResponse.json({ error: "schoolId is required" }, { status: 400 });
  }

  const schoolId = Number(schoolIdParam);
  if (Number.isNaN(schoolId)) {
    return NextResponse.json({ error: "Invalid schoolId" }, { status: 400 });
  }

  const permission = await getUserPermission(session.user.email);
  const programIds = permission?.program_ids ?? [];
  const batches = await getBatchesForSchool(schoolId, programIds);
  const classBatchIds = batches
    .filter((b) => b.parent_id !== null)
    .map((b) => b.batch_id);

  if (classBatchIds.length === 0) {
    return NextResponse.json({ sessions: [], hasMore: false });
  }

  const filteredClassIds = classBatchId
    ? classBatchIds.includes(classBatchId)
      ? [classBatchId]
      : []
    : classBatchIds;

  if (filteredClassIds.length === 0) {
    return NextResponse.json({ sessions: [], hasMore: false });
  }

  const limit = perPage + 1;
  const offset = page * perPage;

  const sessions = await query<SessionRow>(
    `
    SELECT s.*
    FROM session s
    WHERE s.platform = 'quiz'
      AND s.meta_data->>'group' = 'EnableStudents'
      AND string_to_array(s.meta_data->>'batch_id', ',') && $1::text[]
    ORDER BY s.id DESC
    LIMIT $2 OFFSET $3
    `,
    [filteredClassIds, limit, offset]
  );

  const hasMore = sessions.length > perPage;
  const items = hasMore ? sessions.slice(0, perPage) : sessions;

  const parsed = items.map((s) => {
    const meta = s.meta_data;
    const dateCreated =
      meta && typeof (meta as Record<string, unknown>).date_created === "string"
        ? ((meta as Record<string, unknown>).date_created as string)
        : undefined;

    return {
      ...s,
      start_time: s.start_time ? istToUTCDate(s.start_time) : null,
      end_time: s.end_time ? istToUTCDate(s.end_time) : null,
      meta_data: meta
        ? {
            ...meta,
            date_created: dateCreated ? istToUTCDate(dateCreated) : undefined,
          }
        : meta,
    };
  });

  return NextResponse.json({ sessions: parsed, hasMore });
}

export async function POST(request: NextRequest) {
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

  const body = await request.json();

  const requiredFields = [
    "name",
    "grade",
    "parentBatchId",
    "classBatchIds",
    "testType",
    "testFormat",
    "testPurpose",
    "course",
    "stream",
    "optionalLimits",
    "cmsUrl",
    "startTime",
    "endTime",
  ];

  for (const field of requiredFields) {
    if (!body?.[field]) {
      return NextResponse.json(
        { error: `${field} is required` },
        { status: 400 }
      );
    }
  }

  const payload = {
    name: body.name,
    platform: "quiz",
    type: "sign-in",
    auth_type: "ID,DOB",
    redirection: true,
    id_generation: false,
    signup_form: false,
    popup_form: false,
    signup_form_id: null,
    popup_form_id: null,
    session_id: "",
    platform_id: "",
    platform_link: "",
    portal_link: "",
    start_time: utcToISTDate(body.startTime),
    end_time: utcToISTDate(body.endTime),
    repeat_schedule: {
      type: "continuous",
      params: [1, 2, 3, 4, 5, 6, 7],
    },
    is_active: true,
    purpose: { type: "attendance", params: "quiz" },
    meta_data: {
      group: "EnableStudents",
      parent_id: body.parentBatchId,
      batch_id: Array.isArray(body.classBatchIds)
        ? body.classBatchIds.join(",")
        : body.classBatchIds,
      grade: Number(body.grade),
      course: body.course,
      stream: body.stream,
      test_format: body.testFormat,
      test_purpose: body.testPurpose,
      test_type: body.testType,
      gurukul_format_type: "qa",
      marking_scheme:
        body.testType === "homework" || body.testType === "form" ? "1, 0" : "4,-1",
      optional_limits: body.optionalLimits,
      cms_test_id: body.cmsUrl,
      has_synced_to_bq: false,
      infinite_session: false,
      report_link: "",
      shortened_link: "",
      shortened_omr_link: "",
      admin_testing_link: "",
      number_of_fields_in_popup_form: "",
      show_answers: body.showAnswers ?? true,
      show_scores: body.showScores ?? true,
      shuffle: body.shuffle ?? false,
      next_step_url: body.nextStepEnabled ? body.nextStepUrl ?? "" : "",
      next_step_text: body.nextStepEnabled ? body.nextStepText ?? "" : "",
      test_takers_count: 100,
      status: "pending",
      date_created: utcToISTDate(new Date().toISOString()),
    },
  };

  const response = await fetch(`${DB_SERVICE_URL}/session`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("DB service error:", errorText);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: response.status }
    );
  }

  const data = await response.json();
  await publishMessage({ action: "db_id", id: data?.id });

  return NextResponse.json({ id: data?.id });
}
