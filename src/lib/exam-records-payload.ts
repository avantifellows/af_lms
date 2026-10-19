// Canonicalizes and validates what the Exams tab sends. Client-safe, so the
// form and the route agree on what a saveable registration looks like.

import {
  APPLICATION_NUMBER_MAX_LENGTH,
  APPLICATION_PASSWORD_MAX_LENGTH,
  examSessionsFor,
  type ExamOption,
} from "@/lib/competitive-exams";

export interface CanonicalExamRecordInput {
  exam_id: number;
  exam_name: string;
  application_number: string;
  application_password: string | null;
  sessions_applied: number[] | null;
}

export interface CanonicalExamRecordsPayload {
  exams: CanonicalExamRecordInput[];
  removed_record_ids: number[];
}

type PayloadResult =
  | { ok: true; payload: CanonicalExamRecordsPayload }
  | { ok: false; error: string };

function fail(error: string): PayloadResult {
  return { ok: false, error };
}

function trimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function canonicalizeSessions(
  value: unknown,
  examName: string,
): { ok: true; sessions: number[] | null } | { ok: false; error: string } {
  const allowed = examSessionsFor(examName);
  if (value === undefined || value === null) return { ok: true, sessions: null };
  if (!Array.isArray(value)) {
    return { ok: false, error: `Sessions applied for ${examName} is not valid` };
  }
  if (value.length === 0) return { ok: true, sessions: null };
  if (allowed.length === 0) {
    return { ok: false, error: `${examName} does not run in sessions` };
  }
  const sessions = [...new Set(value)];
  if (!sessions.every((session) => allowed.includes(session as number))) {
    return {
      ok: false,
      error: `Sessions applied for ${examName} must be ${allowed
        .map((session) => `Session ${session}`)
        .join(" or ")}`,
    };
  }
  return { ok: true, sessions: (sessions as number[]).sort((a, b) => a - b) };
}

/**
 * Turn the request body into the exact set of registrations to store.
 *
 * `examOptions` is the list the picker offered, read from the database — an
 * exam outside it is refused here rather than written, so the API can't be
 * used to attach an internal exam row (Baseline, Hiring Test, …) to a Student.
 */
export function canonicalizeExamRecordsPayload(
  input: unknown,
  examOptions: ExamOption[],
): PayloadResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return fail("Request body must be an object");
  }
  const body = input as Record<string, unknown>;
  const rawExams = body.exams;
  if (rawExams !== undefined && !Array.isArray(rawExams)) {
    return fail("exams must be a list");
  }
  const rawRemoved = body.removed_record_ids;
  if (rawRemoved !== undefined && !Array.isArray(rawRemoved)) {
    return fail("removed_record_ids must be a list");
  }

  const examsById = new Map(examOptions.map((exam) => [exam.id, exam]));
  const exams: CanonicalExamRecordInput[] = [];
  const seenExamIds = new Set<number>();
  // Application numbers are compared case-insensitively: the DB Service's
  // create upserts on (student, application number), so two registrations that
  // differ only in case would collide there rather than here.
  const seenApplicationNumbers = new Set<string>();

  for (const raw of rawExams ?? []) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return fail("Each exam must be an object");
    }
    const entry = raw as Record<string, unknown>;
    const examId = entry.exam_id;
    if (!isPositiveInteger(examId)) return fail("exam_id is not valid");
    const exam = examsById.get(examId);
    if (!exam) return fail("That exam cannot be recorded against a Student");
    if (seenExamIds.has(examId)) return fail(`${exam.name} is listed twice`);
    seenExamIds.add(examId);

    const applicationNumber = trimmed(entry.application_number);
    if (!applicationNumber) {
      return fail(`Application number is required for ${exam.name}`);
    }
    if (applicationNumber.length > APPLICATION_NUMBER_MAX_LENGTH) {
      return fail(`Application number for ${exam.name} is too long`);
    }
    const applicationKey = applicationNumber.toLowerCase();
    if (seenApplicationNumbers.has(applicationKey)) {
      return fail(`Application number ${applicationNumber} is used for two exams`);
    }
    seenApplicationNumbers.add(applicationKey);

    const password = trimmed(entry.application_password);
    if (password.length > APPLICATION_PASSWORD_MAX_LENGTH) {
      return fail(`Application password for ${exam.name} is too long`);
    }

    const sessions = canonicalizeSessions(entry.sessions_applied, exam.name);
    if (!sessions.ok) return fail(sessions.error);

    exams.push({
      exam_id: examId,
      exam_name: exam.name,
      application_number: applicationNumber,
      application_password: password || null,
      sessions_applied: sessions.sessions,
    });
  }

  const removed: number[] = [];
  for (const id of rawRemoved ?? []) {
    if (!isPositiveInteger(id)) return fail("removed_record_ids is not valid");
    if (!removed.includes(id)) removed.push(id);
  }

  return { ok: true, payload: { exams, removed_record_ids: removed } };
}
