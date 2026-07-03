import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessQuizSessionBatches,
  canAccessQuizSessionSchool,
  requireQuizSessionAccess,
  resolveBatchGroups,
} from "@/lib/quiz-session-access";
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
  return baseName.trim();
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

  const access = await requireQuizSessionAccess(session.user.email, "view");
  if (!access.ok) {
    return access.response;
  }

  const permission = access.permission;
  if (!(await canAccessQuizSessionSchool(permission, schoolId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

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

  // Groups present among the resolved class batches (EnableStudents, EMRSStudents,
  // …), from the batch→auth_group FK. Replaces the old hardcoded
  // group='EnableStudents' so EMRS/Punjab/Gujarat sessions list too; batch_id
  // overlap already scopes to this school's batches.
  const batchGroups = await resolveBatchGroups(filteredClassIds);
  const groups = Array.from(
    new Set(Array.from(batchGroups.values()).map((g) => g.group))
  );

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
      AND s.meta_data->>'group' = ANY($1::text[])
      AND string_to_array(s.meta_data->>'batch_id', ',') && $2::text[]
      -- Teacher Feedback forms are managed in their own tab, not here.
      AND COALESCE(s.meta_data->>'cms_test_id', '') NOT LIKE 'teacher-feedback:%'
    ORDER BY s.id DESC
    LIMIT $3 OFFSET $4
    `,
    [groups, filteredClassIds, limit, offset]
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

  if (!(await canAccessQuizSessionBatches(access.permission, body.classBatchIds))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!body.stream) {
    return NextResponse.json(
      { error: "stream is required" },
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

  if (selectedTemplate.grade === null) {
    return NextResponse.json(
      { error: "Selected template is missing grade metadata" },
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
  const shuffle = body.shuffle ?? false;
  const gurukulFormatType = shuffle ? "qa" : body.gurukulFormatType || "both";
  const cmsLink = selectedTemplate.cmsLink;
  const cmsSourceId = selectedTemplate.cmsSourceId;

  // Resolve the program group + auth type from the selected class batch via the
  // batch→auth_group FK (was hardcoded to EnableStudents/"ID,DOB"). Gurukul
  // matches sessions on meta_data.group and portal-frontend honours the session's
  // auth_type, so both must match the batch's program (EMRSStudents, Punjab, …).
  const batchGroups = await resolveBatchGroups([body.classBatchIds[0]]);
  const resolved = batchGroups.get(body.classBatchIds[0]);
  if (!resolved) {
    return NextResponse.json(
      { error: "Selected batch has no auth group configured" },
      { status: 400 }
    );
  }
  const { group, authType } = resolved;

  const payload = {
    name: sessionName,
    platform: "quiz",
    type: "sign-in",
    auth_type: authType,
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
      group,
      parent_id: body.parentBatchId,
      batch_id: Array.isArray(body.classBatchIds)
        ? body.classBatchIds.join(",")
        : body.classBatchIds,
      grade: selectedTemplate.grade,
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
      shuffle,
      next_step_url: "",
      next_step_text: "",
      single_page_mode: false,
      single_page_header_text: "",
      test_takers_count: 100,
      status: "pending",
      date_created: utcToISTDate(new Date().toISOString()),
      created_by: session.user.email,
      created_from: "lms",
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
