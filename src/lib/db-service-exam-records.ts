// Writes to `student_exam_record`, which the DB Service owns. Reads of the
// same table go through `@/lib/student-exam-records` (Postgres), per the
// reads-vs-writes split.

export interface ExamRecordWrite {
  student_id: number;
  exam_id: number;
  application_number: string;
  application_password: string | null;
  sessions_applied: number[] | null;
}

/** Thrown on a non-2xx from the DB Service; carries the upstream body. */
export class DbServiceExamRecordError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "DbServiceExamRecordError";
    this.status = status;
    this.body = body;
  }
}

function dbServiceUrl(): string {
  const url = process.env.DB_SERVICE_URL;
  if (!url) throw new Error("DB_SERVICE_URL is not set");
  return url;
}

function authHeaders(): HeadersInit {
  const token = process.env.DB_SERVICE_TOKEN;
  if (!token) throw new Error("DB_SERVICE_TOKEN is not set");
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

async function requireOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text();
  throw new DbServiceExamRecordError(`${what} failed (${res.status})`, res.status, body);
}

/**
 * Create a record for an exam the Student has none for.
 *
 * NOTE: the DB Service's create upserts on (`student_id`, `application_number`),
 * not on the exam — posting an application number the Student already has on
 * another exam would move that row to this exam. The route therefore refuses a
 * duplicate application number before calling this.
 */
export async function createExamRecord(input: ExamRecordWrite): Promise<void> {
  const res = await fetch(`${dbServiceUrl()}/student-exam-record`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  await requireOk(res, "createExamRecord");
}

export async function updateExamRecord(
  id: number,
  input: ExamRecordWrite,
): Promise<void> {
  const res = await fetch(`${dbServiceUrl()}/student-exam-record/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  await requireOk(res, "updateExamRecord");
}

export async function deleteExamRecord(id: number): Promise<void> {
  const res = await fetch(`${dbServiceUrl()}/student-exam-record/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  await requireOk(res, "deleteExamRecord");
}
