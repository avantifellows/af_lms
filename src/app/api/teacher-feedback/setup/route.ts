import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { query } from "@/lib/db";
import {
  canAccessQuizSessionBatches,
  resolveBatchGroups,
} from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback } from "@/lib/teacher-feedback-access";
import {
  centreOwnsAllBatches,
  getCentreScope,
} from "@/lib/teacher-feedback-batches";
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

// POST /api/teacher-feedback/setup
export async function POST(request: NextRequest) {
  const access = await authenticateTeacherFeedback("edit");
  if (!access.ok) {
    return access.response;
  }
  const email = access.permission.email;

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

  // Every selected class batch must belong to the CHOSEN CENTRE's cohort — not
  // merely to the school. A school can host a CoE and a Nodal centre, so a
  // school-level check would let a Nodal feedback round be answered by CoE
  // students. Checking all ids (not "any") also stops a crafted payload from
  // smuggling foreign batches in alongside one valid one.
  // parentBatchId is best-effort (used only for the group attach).
  const centreScope = await getCentreScope(centreId);
  if (!centreScope) {
    return NextResponse.json(
      { error: "Selected centre is not active or has no school" },
      { status: 400 }
    );
  }
  if (centreScope.programId === null) {
    return NextResponse.json(
      {
        error:
          `${centreName} has no programme set, so its batches cannot be identified. ` +
          `Ask an admin to set the centre's programme.`,
      },
      { status: 400 }
    );
  }
  if (!(await centreOwnsAllBatches(centreScope, classBatchIds))) {
    return NextResponse.json(
      { error: `Selected batches do not all belong to ${centreName}` },
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

  const cycleLabel = cycleLabelFor(startTime);
  const sourceId = `teacher-feedback:${FEEDBACK_FORM_VERSION}:${schoolCode}:${cycleKeyFor(startTime)}`;
  const setupRunId = randomUUID();

  // `group` (which Gurukul filters sessions on) and `auth_type` (which
  // portal-frontend honours over the auth_group's own) both come from the
  // batch -> auth_group FK.
  //
  // NOT from the batch_id prefix: 314 of 1262 production batches have a prefix
  // that is not their auth_group name (e.g. "EMRS-11-25-P01", "AIS-11-A25").
  // For those, prefix-derivation silently produced a group Gurukul never
  // matches AND missed the auth_group row, defaulting auth_type to "ID" so
  // students could not even log in. Shared with the quiz-session create path.
  const batchGroups = await resolveBatchGroups(classBatchIds);
  const resolvedGroup = batchGroups.get(classBatchIds[0]);
  if (!resolvedGroup) {
    return NextResponse.json(
      { error: "Selected batch has no auth group configured" },
      { status: 400 }
    );
  }
  // One session carries a single group/auth_type pair, so a mixed selection
  // would silently strand whichever batches don't match the first one.
  const mismatched = classBatchIds.find((batchId) => {
    const bg = batchGroups.get(batchId);
    return (
      !bg ||
      bg.group !== resolvedGroup.group ||
      bg.authType !== resolvedGroup.authType
    );
  });
  if (mismatched) {
    return NextResponse.json(
      { error: "Selected class batches must share the same auth group" },
      { status: 400 }
    );
  }
  const { group, authType } = resolvedGroup;

  // No chaining — each feedback session stands alone (Gurukul has no chaining;
  // students fill them in any order). Process in given order.
  const ordered = [...cleanTeachers].sort((a, b) => a.order - b.order);

  const resultsByOrder = new Map<number, TeacherResult>();

  for (const teacher of ordered) {
    // Teacher name first: sessionCreator truncates the quiz title to 30 chars
    // (session_data["name"][:30]), so the most useful part must lead. School code
    // dropped (not useful in the title). e.g. "Bonthu Tavitinaidu - Feedback Jun 2026".
    const title = `${teacher.name} - Feedback ${cycleLabel}`;

    try {
      // Create the bare session row. The sessionCreator Lambda (triggered by the
      // SNS db_id below) builds the quiz from its bundled Teacher Feedback form
      // and fills in session_id / platform_id / portal_link / admin link.
      const created = await createFeedbackSession({
        group,
        authType,
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
