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

interface CanonicalExamRecordsPayload {
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

type ExamResult =
  | { ok: true; exam: CanonicalExamRecordInput }
  | { ok: false; error: string };

/** One entry of `exams`, against the exam the picker says it is. */
function canonicalizeExam(raw: unknown, exam: ExamOption): ExamResult {
  const entry = raw as Record<string, unknown>;

  const applicationNumber = trimmed(entry.application_number);
  if (!applicationNumber) {
    return { ok: false, error: `Application number is required for ${exam.name}` };
  }
  if (applicationNumber.length > APPLICATION_NUMBER_MAX_LENGTH) {
    return { ok: false, error: `Application number for ${exam.name} is too long` };
  }

  const password = trimmed(entry.application_password);
  if (password.length > APPLICATION_PASSWORD_MAX_LENGTH) {
    return { ok: false, error: `Application password for ${exam.name} is too long` };
  }

  const sessions = canonicalizeSessions(entry.sessions_applied, exam.name);
  if (!sessions.ok) return { ok: false, error: sessions.error };

  return {
    ok: true,
    exam: {
      exam_id: exam.id,
      exam_name: exam.name,
      application_number: applicationNumber,
      application_password: password || null,
      sessions_applied: sessions.sessions,
    },
  };
}

/** The exam each entry names, refused unless the picker offers it. */
function resolveExam(
  raw: unknown,
  examsById: Map<number, ExamOption>,
): { ok: true; exam: ExamOption } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Each exam must be an object" };
  }
  const examId = (raw as Record<string, unknown>).exam_id;
  if (!isPositiveInteger(examId)) return { ok: false, error: "exam_id is not valid" };
  const exam = examsById.get(examId);
  if (!exam) {
    return { ok: false, error: "That exam cannot be recorded against a Student" };
  }
  return { ok: true, exam };
}

function canonicalizeRemovedIds(
  raw: unknown[],
): { ok: true; ids: number[] } | { ok: false; error: string } {
  const ids: number[] = [];
  for (const id of raw) {
    if (!isPositiveInteger(id)) {
      return { ok: false, error: "removed_record_ids is not valid" };
    }
    if (!ids.includes(id)) ids.push(id);
  }
  return { ok: true, ids };
}

/** The two lists the body may carry, each optional but each a list if present. */
function readLists(
  input: unknown,
): { ok: true; exams: unknown[]; removed: unknown[] } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Request body must be an object" };
  }
  const body = input as Record<string, unknown>;
  const exams = body.exams ?? [];
  if (!Array.isArray(exams)) return { ok: false, error: "exams must be a list" };
  const removed = body.removed_record_ids ?? [];
  if (!Array.isArray(removed)) {
    return { ok: false, error: "removed_record_ids must be a list" };
  }
  return { ok: true, exams, removed };
}

/** The set of registrations to store: one per exam, one per application number. */
function canonicalizeExams(
  rawExams: unknown[],
  examsById: Map<number, ExamOption>,
): { ok: true; exams: CanonicalExamRecordInput[] } | { ok: false; error: string } {
  const exams: CanonicalExamRecordInput[] = [];
  const seenExamIds = new Set<number>();
  // Application numbers are compared case-insensitively: the DB Service's
  // create upserts on (student, application number), so two registrations that
  // differ only in case would collide there rather than here.
  const seenApplicationNumbers = new Set<string>();

  for (const raw of rawExams) {
    const resolved = resolveExam(raw, examsById);
    if (!resolved.ok) return resolved;
    const { exam } = resolved;
    if (seenExamIds.has(exam.id)) {
      return { ok: false, error: `${exam.name} is listed twice` };
    }
    seenExamIds.add(exam.id);

    const canonical = canonicalizeExam(raw, exam);
    if (!canonical.ok) return canonical;

    const { application_number: number } = canonical.exam;
    if (seenApplicationNumbers.has(number.toLowerCase())) {
      return { ok: false, error: `Application number ${number} is used for two exams` };
    }
    seenApplicationNumbers.add(number.toLowerCase());
    exams.push(canonical.exam);
  }
  return { ok: true, exams };
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
  const lists = readLists(input);
  if (!lists.ok) return fail(lists.error);

  const examsById = new Map(examOptions.map((exam) => [exam.id, exam]));
  const exams = canonicalizeExams(lists.exams, examsById);
  if (!exams.ok) return fail(exams.error);

  const removed = canonicalizeRemovedIds(lists.removed);
  if (!removed.ok) return fail(removed.error);

  return {
    ok: true,
    payload: { exams: exams.exams, removed_record_ids: removed.ids },
  };
}
