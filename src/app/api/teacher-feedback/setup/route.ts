import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  canAccessQuizSessionBatches,
  requireQuizSessionAccess,
} from "@/lib/quiz-session-access";
import {
  FEEDBACK_FORM_VERSION,
  buildFeedbackQuizBody,
} from "@/lib/teacher-feedback-form";
import { createFormQuiz } from "@/lib/quiz-backend";
import { createFeedbackSession } from "@/lib/teacher-feedback-session";

const PORTAL_URL = process.env.PORTAL_URL ?? "https://auth.avantifellows.org/";
const DEFAULT_WINDOW_HOURS = 24;

interface TeacherInput {
  id?: string | null;
  name: string;
  order: number;
}

interface SetupBody {
  schoolCode?: string;
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
  quizId?: string;
  sessionId?: string;
  portalLink?: string;
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

/** group = the batch_id prefix before the first underscore (e.g. "EnableStudents"). */
function deriveGroup(parentBatchId: string): string {
  const idx = parentBatchId.indexOf("_");
  return idx === -1 ? parentBatchId : parentBatchId.slice(0, idx);
}

// POST /api/teacher-feedback/setup
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await requireQuizSessionAccess(email, "edit");
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
  const parentBatchId = body.parentBatchId?.trim();
  const classBatchIds = Array.isArray(body.classBatchIds)
    ? body.classBatchIds.map((b) => String(b).trim()).filter(Boolean)
    : [];
  const grade = Number(body.grade);
  const teachers = Array.isArray(body.teachers) ? body.teachers : [];

  if (!schoolCode) {
    return NextResponse.json({ error: "schoolCode is required" }, { status: 400 });
  }
  if (!parentBatchId) {
    return NextResponse.json({ error: "parentBatchId is required" }, { status: 400 });
  }
  if (classBatchIds.length === 0) {
    return NextResponse.json(
      { error: "At least one class batch is required" },
      { status: 400 }
    );
  }
  if (!Number.isInteger(grade) || (grade !== 11 && grade !== 12)) {
    return NextResponse.json({ error: "grade must be 11 or 12" }, { status: 400 });
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
  const allBatchIds = [parentBatchId, ...classBatchIds];
  if (!(await canAccessQuizSessionBatches(access.permission, allBatchIds))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Confirm the parent batch actually belongs to this school (don't trust the client).
  const ownership = await query<{ ok: boolean }>(
    `
    SELECT EXISTS (
      SELECT 1
      FROM batch b
      JOIN school_batch sb ON sb.batch_id = b.id
      JOIN school s ON s.id = sb.school_id
      WHERE b.batch_id = $1 AND s.code = $2
    ) AS ok
    `,
    [parentBatchId, schoolCode]
  );
  if (!ownership[0]?.ok) {
    return NextResponse.json(
      { error: "Selected batch does not belong to this school" },
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
  const startIso = startTime.toISOString();
  const endIso = endTime.toISOString();

  const group = deriveGroup(parentBatchId);
  const cycleLabel = cycleLabelFor(startTime);
  const sourceId = `teacher-feedback:${FEEDBACK_FORM_VERSION}:${schoolCode}:${cycleKeyFor(startTime)}`;
  const setupRunId = randomUUID();

  // Sort teachers by order and process LAST -> FIRST so each session can carry a
  // next_step_url pointing at the next teacher's session (chaining), exactly like
  // the prototype. We collect created portal links to thread backward.
  const ordered = [...cleanTeachers].sort((a, b) => a.order - b.order);

  const resultsByOrder = new Map<number, TeacherResult>();
  let nextStepUrl = "";

  for (let i = ordered.length - 1; i >= 0; i--) {
    const teacher = ordered[i];
    const isLast = i === ordered.length - 1;
    const nextStepText = isLast ? "Finish" : "Continue to next teacher feedback";
    const title = `Student Feedback - ${cycleLabel} - ${schoolCode} - ${teacher.name}`;

    try {
      const quiz = await createFormQuiz(
        buildFeedbackQuizBody({
          title,
          grade: String(grade),
          sourceId,
          nextStepUrl,
          nextStepText,
        })
      );

      const created = await createFeedbackSession({
        quizId: quiz.id,
        group,
        parentBatchId,
        classBatchIds,
        grade,
        stream: "",
        course: "",
        sourceId,
        startTimeUtc: startIso,
        endTimeUtc: endIso,
        portalBaseUrl: PORTAL_URL,
        name: title,
        createdBy: email,
        nextStepUrl,
        nextStepText,
        feedback: {
          teacherId: teacher.id,
          teacherName: teacher.name,
          teacherOrder: teacher.order,
          cycleLabel,
          schoolCode,
        },
      });

      await query(
        `
        INSERT INTO lms_teacher_feedback
          (setup_run_id, cycle_label, source_id, school_code, batch_parent_id,
           batch_class_ids, grade, teacher_id, teacher_name, teacher_order,
           quiz_id, session_pk, session_id, status, start_time, end_time, created_by)
        VALUES
          ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, $11, $12, $13, 'created', $14, $15, $16)
        `,
        [
          setupRunId,
          cycleLabel,
          sourceId,
          schoolCode,
          parentBatchId,
          classBatchIds,
          grade,
          teacher.id,
          teacher.name,
          teacher.order,
          quiz.id,
          created.sessionPk,
          created.sessionId,
          startIso,
          endIso,
          email,
        ]
      );

      resultsByOrder.set(teacher.order, {
        teacherName: teacher.name,
        teacherOrder: teacher.order,
        status: "created",
        quizId: quiz.id,
        sessionId: created.sessionId,
        portalLink: created.portalLink,
      });

      // The next (earlier) teacher's session should chain into this one.
      nextStepUrl = created.portalLink;
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
            (setup_run_id, cycle_label, source_id, school_code, batch_parent_id,
             batch_class_ids, grade, teacher_id, teacher_name, teacher_order,
             status, start_time, end_time, created_by)
          VALUES
            ($1, $2, $3, $4, $5, $6::text[], $7, $8, $9, $10, 'failed', $11, $12, $13)
          `,
          [
            setupRunId,
            cycleLabel,
            sourceId,
            schoolCode,
            parentBatchId,
            classBatchIds,
            grade,
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
      // A failed teacher must not chain — leave nextStepUrl unchanged so the
      // earlier teacher points at the next *successful* session (or "" / Finish).
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
