import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { query } from "@/lib/db";
import {
  canAccessQuizSessionBatches,
  resolveBatchGroups,
} from "@/lib/quiz-session-access";
import { authenticateTeacherFeedback, requireCentreScope } from "@/lib/teacher-feedback-access";
import {
  centreOwnsAllBatches,
  getCentreScope,
} from "@/lib/teacher-feedback-batches";
import { FEEDBACK_FORM_VERSION } from "@/lib/teacher-feedback-form";
import {
  createFeedbackSession,
  deactivateFeedbackSession,
} from "@/lib/teacher-feedback-session";
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

  // Teacher Feedback is centre-keyed, so the school check above is not enough:
  // narrow a confined caller to their own seat centres.
  const centreScopeCheck = requireCentreScope(access.permission, centreId);
  if (!centreScopeCheck.ok) {
    return centreScopeCheck.response;
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

  // Against the chosen CENTRE's cohort, not the school: a school-level check
  // would let a Nodal round be answered by CoE students.
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

  // From the batch -> auth_group FK, never the batch_id prefix: ~25% of
  // production batches have a prefix that isn't their auth_group name, which
  // silently broke both Gurukul visibility and student login.
  const batchGroups = await resolveBatchGroups(classBatchIds);
  const resolvedGroup = batchGroups.get(classBatchIds[0]);
  if (!resolvedGroup) {
    return NextResponse.json(
      { error: "Selected batch has no auth group configured" },
      { status: 400 }
    );
  }
  // One session carries a single group/auth_type pair.
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
    // Name first: sessionCreator truncates the quiz title to 30 chars.
    const title = `${teacher.name} - Feedback ${cycleLabel}`;
    // Hoisted so the catch can deactivate a session whose setup then failed.
    let sessionPk: number | null = null;

    try {
      // Claim the slot before any external work: the partial unique index makes
      // this INSERT the lock, so a repeat within this run is rejected before a
      // session or SNS message exists. A *second submit* mints a new
      // setup_run_id and is not covered — see the PR's idempotency debt note.
      const reserved = await query<{ id: number | string }>(
        `
        INSERT INTO lms_teacher_feedback
          (setup_run_id, cycle_label, school_code, centre_id, program_id,
           batch_class_ids, teacher_id, teacher_name, teacher_order,
           status, start_time, end_time, created_by)
        VALUES
          ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, 'pending', $10, $11, $12)
        RETURNING id
        `,
        [
          setupRunId,
          cycleLabel,
          schoolCode,
          centreId,
          centreScope.programId,
          classBatchIds,
          teacher.id,
          teacher.name,
          teacher.order,
          startIso,
          endIso,
          email,
        ]
      );
      const reservedId = reserved[0]?.id;
      if (reservedId == null) {
        throw new Error("Failed to reserve a feedback row for this teacher");
      }

      // The Lambda (triggered by the SNS db_id below) builds the quiz and fills
      // in session_id / platform_id / portal_link / admin link.
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
      sessionPk = created.sessionPk;

      // Bind the session to its reserved row BEFORE triggering the Lambda: if this
      // write fails we have not published yet, so no quiz gets built and the
      // session is deactivated below — rather than the Lambda producing a working
      // quiz the dashboard has no row for. A publish failure after this point
      // throws, and the catch flips the row to 'failed'.
      await query(
        `UPDATE lms_teacher_feedback
            SET session_pk = $1, status = 'created', updated_at = now()
          WHERE id = $2`,
        [created.sessionPk, reservedId]
      );

      // publishMessage never throws, so check the result: a failed publish means
      // the Lambda was never asked to build the quiz, and leaving the row
      // 'created' would strand the round on "Generating links…" with no reason.
      const published = await publishMessage({
        action: "db_id",
        id: created.sessionPk,
      });
      if (!published) {
        throw new Error(
          "Session created but the quiz build could not be triggered (SNS publish failed). Retry setup for this teacher."
        );
      }

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

      // The session exists but its setup did not finish, so deactivate it rather
      // than leaving a live-looking session with no quiz behind.
      if (sessionPk != null) {
        await deactivateFeedbackSession(sessionPk);
      }

      // The row is usually already reserved, so mark it failed; ON CONFLICT
      // covers the case where the reservation itself was what failed.
      try {
        await query(
          `
          INSERT INTO lms_teacher_feedback
            (setup_run_id, cycle_label, school_code, centre_id, program_id,
             batch_class_ids, teacher_id, teacher_name, teacher_order,
             status, start_time, end_time, created_by)
          VALUES
            ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, 'failed', $10, $11, $12)
          ON CONFLICT (setup_run_id, teacher_order) WHERE deleted_at IS NULL
            DO UPDATE SET status = 'failed', updated_at = now()
          `,
          [
            setupRunId,
            cycleLabel,
            schoolCode,
            centreId,
            centreScope.programId,
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
