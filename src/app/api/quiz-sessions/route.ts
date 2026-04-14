import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import {
  dbIstTimestampToUtcIso,
  istToUTCDate,
  utcToISTDate,
} from "@/lib/quiz-session-time";
import { publishMessage } from "@/lib/sns";
import {
  parseQuizTemplateResource,
  type RawQuizTemplateResource,
} from "@/lib/quiz-template-resource";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;
const LMS_SESSION_PREFIX = "[LMS] ";

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

interface CreateQuizSessionBody {
  name?: string;
  resourceId?: number;
  grade?: number;
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

function getDefaultSessionName(baseName: string): string {
  return baseName.startsWith(LMS_SESSION_PREFIX)
    ? baseName
    : `${LMS_SESSION_PREFIX}${baseName}`;
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

async function fetchQuizTemplateResource(
  resourceId: number
): Promise<ReturnType<typeof parseQuizTemplateResource> | null> {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    return null;
  }

  const response = await fetch(`${DB_SERVICE_URL}/resource/${resourceId}`, {
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to fetch quiz template resource:", errorText);
    throw new Error("Failed to fetch selected template");
  }

  const rawResource = (await response.json()) as RawQuizTemplateResource;
  const parsed = parseQuizTemplateResource(rawResource);
  return parsed.type === "quiz_template" ? parsed : null;
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
    SELECT
      s.id,
      s.name,
      s.start_time::text AS start_time,
      s.end_time::text AS end_time,
      s.is_active,
      s.portal_link,
      s.meta_data,
      s.platform
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
      start_time: s.start_time ? dbIstTimestampToUtcIso(s.start_time) : null,
      end_time: s.end_time ? dbIstTimestampToUtcIso(s.end_time) : null,
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

  const body = (await request.json()) as CreateQuizSessionBody;

  if (!body.resourceId || Number.isNaN(Number(body.resourceId))) {
    return NextResponse.json({ error: "resourceId is required" }, { status: 400 });
  }

  if (!body.parentBatchId) {
    return NextResponse.json(
      { error: "parentBatchId is required" },
      { status: 400 }
    );
  }

  if (!Array.isArray(body.classBatchIds) || body.classBatchIds.length === 0) {
    return NextResponse.json(
      { error: "At least one class batch is required" },
      { status: 400 }
    );
  }

  if (!body.grade || !body.stream) {
    return NextResponse.json(
      { error: "grade and stream are required" },
      { status: 400 }
    );
  }

  if (!body.startTime || !body.endTime) {
    return NextResponse.json(
      { error: "startTime and endTime are required" },
      { status: 400 }
    );
  }

  const selectedTemplate = await fetchQuizTemplateResource(Number(body.resourceId));
  if (!selectedTemplate) {
    return NextResponse.json(
      { error: "Selected template was not found" },
      { status: 404 }
    );
  }

  if (selectedTemplate.grade !== null && selectedTemplate.grade !== Number(body.grade)) {
    return NextResponse.json(
      { error: "Selected template grade does not match selected batches" },
      { status: 400 }
    );
  }

  if (selectedTemplate.stream && selectedTemplate.stream !== body.stream) {
    return NextResponse.json(
      { error: "Selected template stream does not match selected batches" },
      { status: 400 }
    );
  }

  if (
    !selectedTemplate.cmsLink ||
    !selectedTemplate.testFormat ||
    !selectedTemplate.testPurpose ||
    !selectedTemplate.testType
  ) {
    return NextResponse.json(
      { error: "Selected template is missing required paper metadata" },
      { status: 400 }
    );
  }

  const start = new Date(body.startTime);
  const end = new Date(body.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json(
      { error: "Invalid start or end time" },
      { status: 400 }
    );
  }

  const sessionName = body.name?.trim() || getDefaultSessionName(selectedTemplate.name);
  const testType = selectedTemplate.testType || "assessment";
  const gurukulFormatType = body.gurukulFormatType || "both";
  const cmsLink = selectedTemplate.cmsLink;
  const cmsSourceId = selectedTemplate.cmsSourceId;

  const payload = {
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
      course: selectedTemplate.course,
      stream: body.stream,
      resource_id: selectedTemplate.id,
      resource_code: selectedTemplate.code,
      resource_name: selectedTemplate.name,
      test_code: selectedTemplate.code,
      test_name: selectedTemplate.name,
      test_format: selectedTemplate.testFormat,
      test_purpose: selectedTemplate.testPurpose,
      test_type: testType,
      gurukul_format_type: gurukulFormatType,
      marking_scheme:
        testType === "homework" || testType === "form" ? "1,0" : "4,-1",
      optional_limits: selectedTemplate.optionalLimits,
      cms_test_id: cmsLink,
      cms_link: cmsLink,
      cms_source_id: cmsSourceId,
      question_pdf: selectedTemplate.questionPdf,
      solution_pdf: selectedTemplate.solutionPdf,
      ranking_cutoff_date: selectedTemplate.rankingCutoffDate,
      sheet_name: selectedTemplate.sheetName,
      has_synced_to_bq: false,
      infinite_session: false,
      report_link: "",
      shortened_link: "",
      shortened_omr_link: "",
      admin_testing_link: "",
      admin_testing_omr_link: "",
      number_of_fields_in_popup_form: "",
      show_answers: body.showAnswers ?? true,
      show_scores: body.showScores ?? true,
      shuffle: body.shuffle ?? false,
      next_step_url: "",
      next_step_text: "",
      single_page_mode: false,
      single_page_header_text: "",
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
