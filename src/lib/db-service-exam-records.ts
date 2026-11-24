// Writes to `student_exam_record`, which the DB Service owns. Reads of the
// same table go through `@/lib/student-exam-records` (Postgres), per the
// reads-vs-writes split.

export interface ExamRecordWrite {
  student_id: number;
  exam_id: number;
  application_number: string;
  sessions_applied: number[] | null;
  /**
   * Only ever null: the DB Service still has the legacy plaintext column, and
   * sending null wipes whatever a not-yet-backfilled row holds there.
   */
  application_password?: null;
  /**
   * Base64 KMS ciphertext, or null to clear the password. Leave both password
   * keys out to keep what is stored.
   */
  application_password_ciphertext?: string | null;
}

/** Thrown on a non-2xx from the DB Service; carries the upstream body. */
class DbServiceExamRecordError extends Error {
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
 * Confirm the DB Service stored the password columns this write sent.
 *
 * A DB Service that predates `application_password_ciphertext` answers 2xx and
 * silently drops the unknown key, which would leave the old password in place
 * while the tab reports success. Only checked when the write touched the
 * password; the plaintext column must come back empty either way.
 */
async function requirePasswordStored(
  res: Response,
  input: ExamRecordWrite,
  what: string,
): Promise<void> {
  if (!("application_password_ciphertext" in input)) return;
  if (!passwordStoredAsSent(await storedRecord(res), input)) {
    throw new DbServiceExamRecordError(`${what} did not store the password`, res.status, "");
  }
}

/** The record the DB Service answered with, or null if the body is not JSON. */
async function storedRecord(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown> | null;
  } catch {
    return null;
  }
}

function passwordStoredAsSent(
  record: Record<string, unknown> | null,
  input: ExamRecordWrite,
): boolean {
  if (!record || !("application_password_ciphertext" in record)) return false;
  const sent = input.application_password_ciphertext ?? null;
  return (
    (record.application_password_ciphertext ?? null) === sent &&
    (record.application_password ?? null) === null
  );
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
  await requirePasswordStored(res, input, "createExamRecord");
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
  await requirePasswordStored(res, input, "updateExamRecord");
}

// --- Plaintext-free writes (Blended Learning JEE form) ----------------------
//
// The JEE form never sends, reads or stores a plaintext password. The legacy
// plaintext `application_password` column is only ever cleared: a write that
// sets a ciphertext also sends `application_password: null`, as the Exams tab
// does, so a record never holds both. Each body is built from named fields
// only (never a spread); the legacy key, when present, always goes out as the
// literal null, whatever the caller passed; and a PATCH without a key leaves
// that column as it is (the DB Service casts only the keys sent). A password
// travels only as the KMS ciphertext the caller made
// (`application_password_ciphertext`). The DB Service answers with the whole
// record, legacy password included, so the response body is never read: only
// the status is looked at, and on failure only the status is logged. The
// caller confirms the write by reading back from Postgres that the ciphertext
// is stored and the legacy column is null (an IS NULL test; its value is
// never selected).

export interface ExamRecordCreateWithoutPlaintext {
  student_id: number;
  exam_id: number;
  exam_year: number;
  application_number: string;
  sessions_applied?: number[];
  /** Only ever null: clears the legacy plaintext. Send it with a ciphertext. */
  application_password?: null;
  application_password_ciphertext?: string;
}

export interface ExamRecordPatchWithoutPlaintext {
  application_number?: string;
  exam_year?: number;
  sessions_applied?: number[];
  /** Only ever null: clears the legacy plaintext. Send it with a ciphertext. */
  application_password?: null;
  application_password_ciphertext?: string;
}

/** Thrown on a non-2xx; carries the status only, never the response body. */
export class DbServiceExamRecordStatusError extends Error {
  readonly status: number;
  constructor(what: string, status: number) {
    super(`${what} failed (${status})`);
    this.name = "DbServiceExamRecordStatusError";
    this.status = status;
  }
}

async function requireOkWithoutReading(res: Response, what: string): Promise<void> {
  await res.body?.cancel();
  if (!res.ok) throw new DbServiceExamRecordStatusError(what, res.status);
}

const CREATE_KEYS = [
  "student_id",
  "exam_id",
  "exam_year",
  "application_number",
  "sessions_applied",
  "application_password",
  "application_password_ciphertext",
] as const;
const PATCH_KEYS = [
  "application_number",
  "exam_year",
  "sessions_applied",
  "application_password",
  "application_password_ciphertext",
] as const;

// The named keys that are set, in a fixed order; nothing else ever goes out.
// The legacy plaintext key is only ever sent as null, so even a caller that
// slipped a value in can't write one.
function plaintextFreeBody<T extends object>(input: T, keys: readonly (keyof T)[]): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of keys) {
    if (input[key] === undefined) continue;
    body[key as string] = key === "application_password" ? null : input[key];
  }
  return body;
}

export async function createExamRecordWithoutPlaintext(
  input: ExamRecordCreateWithoutPlaintext,
): Promise<void> {
  const res = await fetch(`${dbServiceUrl()}/student-exam-record`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(plaintextFreeBody(input, CREATE_KEYS)),
  });
  await requireOkWithoutReading(res, "createExamRecordWithoutPlaintext");
}

export async function patchExamRecordWithoutPlaintext(
  id: number,
  input: ExamRecordPatchWithoutPlaintext,
): Promise<void> {
  const res = await fetch(`${dbServiceUrl()}/student-exam-record/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(plaintextFreeBody(input, PATCH_KEYS)),
  });
  await requireOkWithoutReading(res, "patchExamRecordWithoutPlaintext");
}

export async function deleteExamRecord(id: number): Promise<void> {
  const res = await fetch(`${dbServiceUrl()}/student-exam-record/${id}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  await requireOk(res, "deleteExamRecord");
}
