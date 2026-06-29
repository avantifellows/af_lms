import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { canAccessQuizSessionBatches } from "@/lib/quiz-session-access";
import { requireTeacherFeedbackAccess } from "@/lib/teacher-feedback-access";
import { FEEDBACK_FORM_VERSION } from "@/lib/teacher-feedback-form";
import { createFeedbackSession } from "@/lib/teacher-feedback-session";
import { publishMessage } from "@/lib/sns";

const DEFAULT_WINDOW_HOURS = 24;

interface TeacherInput {
  id?: string | null;
  name: string;
  order: number;
}

interface SetupBody {
  schoolCode?: string;
  centreId?: number | string;
  parentBatchId?: string;
  classBatchIds?: string[];
  grade?: number;
  startTime?: string;
  endTime?: string;
  teachers?: TeacherInput[];
}

interface TeacherResult {
  teacherName: string;
  teacherOrder: number;
  status: "created" | "failed";
  sessionPk?: number;
  error?: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Derive a "Jun 2026"-style label from a UTC date. */
function cycleLabelFor(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Derive a "YYYY-MM" cycle key for the source_id. */
function cycleKeyFor(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${m}`;
}

/**
 * group = the program tag = the CLASS batch_id prefix before the first
 * underscore (e.g. "EnableStudents_TP_2027_engg_C024" -> "EnableStudents").
 * Gurukul filters sessions on meta_data->>'group', so this MUST come from a
 * class batch_id, NOT the parent batch (whose id may be unrelated, e.g.
 * "EN-TP-2027-engg-C01").
 */
function deriveGroup(classBatchId: string): string {
  const idx = classBatchId.indexOf("_");
  return idx === -1 ? classBatchId : classBatchId.slice(0, idx);
}

// POST /api/teacher-feedback/setup
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireTeacherFeedbackAccess(email, "edit");
  if (!access.ok) {
    return access.response;
  }

  let body: SetupBody;
  try {
    body = (await request.json()) as SetupBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const schoolCode = body.schoolCode?.trim();
  // Accept a number or a numeric string (pg returns bigint ids as strings, so a
  // client may echo "40" back).
  const centreIdNum = Number(body.centreId);
  const centreId =
    body.centreId != null && Number.isInteger(centreIdNum) ? centreIdNum : null;
  const parentBatchId = body.parentBatchId?.trim() ?? "";
  const classBatchIds = Array.isArray(body.classBatchIds)
    ? body.classBatchIds.map((b) => String(b).trim()).filter(Boolean)
    : [];
  // A feedback round can span grades (a teacher often teaches both 11 and 12),
  // so grade is not collected; it's only informational form metadata. Default to
  // 11 when the client doesn't send a valid grade. Analysis is batch-wise.
  const grade = body.grade === 11 || body.grade === 12 ? body.grade : 11;
  const teachers = Array.isArray(body.teachers) ? body.teachers : [];

  if (!schoolCode) {
    return NextResponse.json({ error: "schoolCode is required" }, { status: 400 });
  }
  if (centreId === null) {
    return NextResponse.json({ error: "centreId is required" }, { status: 400 });
  }
  if (classBatchIds.length === 0) {
    return NextResponse.json(
      { error: "At least one class batch is required" },
      { status: 400 }
    );
  }
  const cleanTeachers = teachers
    .map((t) => ({
      id: t.id != null ? String(t.id) : null,
      name: String(t.name ?? "").trim(),
      order: Number(t.order),
    }))
    .filter((t) => t.name.length > 0 && Number.isInteger(t.order));
  if (cleanTeachers.length === 0) {
    return NextResponse.json(
      { error: "At least one teacher is required" },
      { status: 400 }
    );
  }

  // Access: the PM must be able to reach the chosen batches' school(s).
  if (!(await canAccessQuizSessionBatches(access.permission, classBatchIds))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Confirm the selected class batches belong to this school (don't trust the
  // client). parentBatchId is best-effort (used only for the group attach).
  const ownership = await query<{ ok: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM batch b
      JOIN school_batch sb ON sb.batch_id = b.id
      JOIN school s ON s.id = sb.school_id
      WHERE b.batch_id = ANY($1::text[]) AND s.code = $2
    ) AS ok
    `,
    [classBatchIds, schoolCode]
  );
  if (!ownership[0]?.ok) {
    return NextResponse.json(
      { error: "Selected batches do not belong to this school" },
      { status: 400 }
    );
  }

  // Confirm the centre belongs to this school + grab its name for the record.
  const centreRows = await query<{ name: string }>(
    `SELECT c.name FROM centres c JOIN school s ON s.id = c.school_id
     WHERE c.id = $1 AND s.code = $2 LIMIT 1`,
    [centreId, schoolCode]
  );
  const centreName = centreRows[0]?.name ?? null;
  if (!centreName) {
    return NextResponse.json(
      { error: "Selected centre does not belong to this school" },
      { status: 400 }
    );
  }

  // Window: start now (or given), end +24h by default.
  const startTime = body.startTime
    ? new Date(body.startTime)
    : new Date();
  if (Number.isNaN(startTime.getTime())) {
    return NextResponse.json({ error: "Invalid startTime" }, { status: 400 });
  }
  const endTime = body.endTime
    ? new Date(body.endTime)
    : new Date(startTime.getTime() + DEFAULT_WINDOW_HOURS * 60 * 60 * 1000);
  if (Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    return NextResponse.json(
      { error: "endTime must be after startTime" },
      { status: 400 }
    );
  }
  // UTC ISO. createFeedbackSession converts to IST for the db-service session
  // (its convention); we store UTC on lms_teacher_feedback (ours). The two tables
  // therefore differ by the IST offset — intentional; see the migration comment.
  const startIso = startTime.toISOString();
  const endIso = endTime.toISOString();

  const group = deriveGroup(classBatchIds[0]);
  const cycleLabel = cycleLabelFor(startTime);
  const sourceId = `teacher-feedback:${FEEDBACK_FORM_VERSION}:${schoolCode}:${cycleKeyFor(startTime)}`;
  const setupRunId = randomUUID();

  // No chaining — each feedback session stands alone (Gurukul has no chaining;
  // students fill them in any order). Process in given order.
  const ordered = [...cleanTeachers].sort((a, b) => a.order - b.order);

  const resultsByOrder = new Map<number, TeacherResult>();

  for (const teacher of ordered) {
    const title = `Student Feedback - ${cycleLabel} - ${schoolCode} - ${teacher.name}`;

    try {
      // Create the bare session row. The sessionCreator Lambda (triggered by the
      // SNS db_id below) builds the quiz from its bundled Teacher Feedback form
      // and fills in session_id / platform_id / portal_link / admin link.
      const created = await createFeedbackSession({
        group,
        parentBatchId,
        classBatchIds,
        grade,
        stream: "",
        course: "",
        sourceId,
        startTimeUtc: startIso,
        endTimeUtc: endIso,
        name: title,
        createdBy: email,
        feedback: {
          teacherId: teacher.id,
          teacherName: teacher.name,
          teacherOrder: teacher.order,
          cycleLabel,
          schoolCode,
        },
      });

      // Trigger the Lambda to build the quiz + links for this session.
      await publishMessage({ action: "db_id", id: created.sessionPk });

      await query(
        `
        INSERT INTO lms_teacher_feedback
          (setup_run_id, cycle_label, source_id, school_code, centre_id, centre_name,
           batch_class_ids, teacher_id, teacher_name, teacher_order,
           session_pk, status, start_time, end_time, created_by)
        VALUES
          ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11, 'created', $12, $13, $14)
        `,
        [
          setupRunId,
          cycleLabel,
          sourceId,
          schoolCode,
          centreId,
          centreName,
          classBatchIds,
          teacher.id,
          teacher.name,
          teacher.order,
          created.sessionPk,
          startIso,
          endIso,
          email,
        ]
      );

      resultsByOrder.set(teacher.order, {
        teacherName: teacher.name,
        teacherOrder: teacher.order,
        status: "created",
        sessionPk: created.sessionPk,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error(
        `Teacher feedback setup failed for ${teacher.name} (order ${teacher.order}):`,
        message
      );

      // Record the failure so the cycle is auditable and retryable.
      try {
        await query(
          `
          INSERT INTO lms_teacher_feedback
            (setup_run_id, cycle_label, source_id, school_code, centre_id, centre_name,
             batch_class_ids, teacher_id, teacher_name, teacher_order,
             status, start_time, end_time, created_by)
          VALUES
            ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, 'failed', $11, $12, $13)
          `,
          [
            setupRunId,
            cycleLabel,
            sourceId,
            schoolCode,
            centreId,
            centreName,
            classBatchIds,
            teacher.id,
            teacher.name,
            teacher.order,
            startIso,
            endIso,
            email,
          ]
        );
      } catch (insertError) {
        console.error("Failed to record failed teacher feedback row:", insertError);
      }

      resultsByOrder.set(teacher.order, {
        teacherName: teacher.name,
        teacherOrder: teacher.order,
        status: "failed",
        error: message,
      });
    }
  }

  const results = ordered.map((t) => resultsByOrder.get(t.order)!);
  const createdCount = results.filter((r) => r.status === "created").length;
  const failedCount = results.length - createdCount;

  return NextResponse.json(
    {
      setupRunId,
      cycleLabel,
      sourceId,
      group,
      schoolCode,
      grade,
      createdCount,
      failedCount,
      teachers: results,
    },
    { status: failedCount === 0 ? 201 : 207 }
  );
}
