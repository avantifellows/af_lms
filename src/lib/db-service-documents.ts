import type { UploadedPage } from "./s3";

// Mirror of the db-service `LmsStudentDocument` schema (PR #514). Read by the
// LMS API routes and the documents UI.
export interface LmsStudentDocumentRow {
  id: number;
  student_id: number;
  document_type: string;
  pages: UploadedPage[];
  metadata: Record<string, unknown>;
  uploaded_by: string;
  deleted_at: string | null;
  inserted_at: string;
  updated_at: string;
}

// Thrown when the db-service call returns a non-2xx response. Carries the
// upstream status + body so the API route can decide how to surface it.
export class DbServiceError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = "DbServiceError";
    this.status = status;
    this.body = body;
  }
}

function dbServiceUrl(): string {
  const url = process.env.DB_SERVICE_URL;
  if (!url) throw new Error("DB_SERVICE_URL is not set");
  return url;
}

function dbServiceToken(): string {
  const token = process.env.DB_SERVICE_TOKEN;
  if (!token) throw new Error("DB_SERVICE_TOKEN is not set");
  return token;
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${dbServiceToken()}`,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export async function listDocuments(
  studentId: number,
): Promise<LmsStudentDocumentRow[]> {
  const url = `${dbServiceUrl()}/lms-student-document?student_id=${studentId}`;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new DbServiceError(
      `listDocuments failed (${res.status})`,
      res.status,
      body,
    );
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new DbServiceError(
      `listDocuments returned non-JSON body`,
      res.status,
      err instanceof Error ? err.message : String(err),
    );
  }
  // db-service may return `{ data: [...] }` or a bare array depending on
  // controller convention. Accept both.
  const rows: LmsStudentDocumentRow[] = Array.isArray(data)
    ? (data as LmsStudentDocumentRow[])
    : ((data as { data?: LmsStudentDocumentRow[] } | null)?.data ?? []);
  // Defense in depth: even if the upstream silently ignores the student_id
  // filter, refuse to leak documents that belong to another student.
  return rows.filter((d) => d.student_id === studentId);
}

export type CreateDocumentInput = Omit<
  LmsStudentDocumentRow,
  "id" | "deleted_at" | "inserted_at" | "updated_at"
>;

export async function createDocument(
  input: CreateDocumentInput,
): Promise<LmsStudentDocumentRow> {
  const url = `${dbServiceUrl()}/lms-student-document`;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new DbServiceError(
      `createDocument failed (${res.status})`,
      res.status,
      body,
    );
  }
  let data: unknown;
  try {
    data = await res.json();
  } catch (err) {
    throw new DbServiceError(
      `createDocument returned non-JSON body`,
      res.status,
      err instanceof Error ? err.message : String(err),
    );
  }
  const row =
    (data as { data?: LmsStudentDocumentRow } | null)?.data ??
    (data as LmsStudentDocumentRow);
  return row;
}

export async function softDeleteDocument(id: number): Promise<void> {
  const url = `${dbServiceUrl()}/lms-student-document/${id}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new DbServiceError(
      `softDeleteDocument failed (${res.status})`,
      res.status,
      body,
    );
  }
}
