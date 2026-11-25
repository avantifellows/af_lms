// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { routeParams } from "@/app/api/__test-utils__/api-test-helpers";
import { queueExamRecordsGate } from "@/app/api/__test-utils__/exam-records-gate";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/student-exam-records", () => ({
  listStudentExamRecords: vi.fn(),
  getExamAcknowledgement: vi.fn(),
}));
vi.mock("@/lib/s3", () => ({
  uploadDocumentPages: vi.fn(),
  deleteDocumentObjects: vi.fn(),
  S3UploadError: class S3UploadError extends Error {
    uploaded: { s3_key: string }[] = [];
  },
}));
vi.mock("@/lib/db-service-documents", () => ({
  createDocument: vi.fn(),
  softDeleteDocument: vi.fn(),
  DbServiceError: class DbServiceError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly body: string,
    ) {
      super(message);
    }
  },
}));

import { getServerSession } from "next-auth";
import { query } from "@/lib/db";
import { getExamAcknowledgement, listStudentExamRecords } from "@/lib/student-exam-records";
import { deleteDocumentObjects, uploadDocumentPages } from "@/lib/s3";
import { createDocument, DbServiceError, softDeleteDocument } from "@/lib/db-service-documents";
import { DELETE, POST } from "./route";

const mockSession = vi.mocked(getServerSession);
const mockQuery = vi.mocked(query);
const mockListRecords = vi.mocked(listStudentExamRecords);
const mockGetAck = vi.mocked(getExamAcknowledgement);
const mockUpload = vi.mocked(uploadDocumentPages);
const mockDeleteObjects = vi.mocked(deleteDocumentObjects);
const mockCreate = vi.mocked(createDocument);
const mockSoftDelete = vi.mocked(softDeleteDocument);

const JEE_RECORD = {
  id: 10,
  exam_id: 1,
  exam_name: "JEE Mains",
  application_number: "JEE123",
  has_password: false,
  sessions_applied: [1, 2],
};
const NEET_RECORD = {
  id: 11,
  exam_id: 2,
  exam_name: "NEET",
  application_number: "NEET9",
  has_password: false,
  sessions_applied: null,
};
const UPLOADED = [
  { s3_key: "k/page-1.pdf", page_number: 1, mime_type: "application/pdf", byte_size: 4 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
  mockListRecords.mockResolvedValue([JEE_RECORD, NEET_RECORD]);
  mockUpload.mockResolvedValue(UPLOADED);
  mockCreate.mockImplementation(async (input) => ({
    id: 501,
    ...input,
    deleted_at: null,
    inserted_at: "2026-11-25T10:00:00.000Z",
    updated_at: "2026-11-25T10:00:00.000Z",
  }));
});

function authorize(options: { pmuOnly?: boolean; readOnly?: boolean } = {}) {
  queueExamRecordsGate(mockSession, mockQuery, options);
}

function uploadRequest(fields: Record<string, string>, files: Blob[] = [pdf()]) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  files.forEach((file, index) => form.set(`page_${index + 1}`, file, `page-${index + 1}`));
  return new Request("http://test/api/students/7/exam-records/10/acknowledgement", {
    method: "POST",
    body: form,
  });
}

function pdf() {
  return new Blob(["%PDF"], { type: "application/pdf" });
}

const params = (recordId = "10") => routeParams({ id: "7", recordId });

describe("POST /api/students/[id]/exam-records/[recordId]/acknowledgement", () => {
  it("refuses an unauthenticated caller", async () => {
    mockSession.mockResolvedValue(null);
    const res = await POST(uploadRequest({ exam_session: "1" }), params());
    expect(res.status).toBe(401);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("refuses a JNV NVS Student", async () => {
    authorize({ pmuOnly: true });
    const res = await POST(uploadRequest({ exam_session: "1" }), params());
    expect(res.status).toBe(403);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("refuses a read-only user", async () => {
    authorize({ readOnly: true });
    const res = await POST(uploadRequest({ exam_session: "1" }), params());
    expect(res.status).toBe(403);
  });

  it("refuses a registration that isn't this Student's", async () => {
    authorize();
    const res = await POST(uploadRequest({ exam_session: "1" }), params("99"));
    expect(res.status).toBe(404);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("stores a JEE Mains session acknowledgement linked to the registration", async () => {
    authorize();
    const res = await POST(uploadRequest({ exam_session: "2" }), params());

    expect(res.status).toBe(201);
    expect(mockUpload).toHaveBeenCalledWith(
      expect.objectContaining({ studentId: 7, documentType: "exam_acknowledgement" }),
    );
    expect(mockCreate).toHaveBeenCalledWith({
      student_id: 7,
      document_type: "exam_acknowledgement",
      pages: UPLOADED,
      metadata: {},
      student_exam_record_id: 10,
      exam_session: 2,
      uploaded_by: "admin@avantifellows.org",
    });
    expect(await res.json()).toEqual({
      id: 501,
      exam_session: 2,
      pages: [{ page_number: 1, mime_type: "application/pdf" }],
      uploaded_by: "admin@avantifellows.org",
      uploaded_at: "2026-11-25T10:00:00.000Z",
    });
  });

  it("stores one with no session for an exam without sessions", async () => {
    authorize();
    const res = await POST(uploadRequest({}), params("11"));
    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ student_exam_record_id: 11, exam_session: null }),
    );
  });

  it("refuses a JEE Mains upload with no session", async () => {
    authorize();
    const res = await POST(uploadRequest({}), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick the session this acknowledgement is for" });
  });

  it("refuses a session the Student did not apply for", async () => {
    authorize();
    mockListRecords.mockResolvedValue([{ ...JEE_RECORD, sessions_applied: [1] }]);
    const res = await POST(uploadRequest({ exam_session: "2" }), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Session 2 is not a session this Student applied for",
    });
  });

  it("refuses a session on an exam without sessions", async () => {
    authorize();
    const res = await POST(uploadRequest({ exam_session: "1" }), params("11"));
    expect(res.status).toBe(400);
  });

  it("asks for a session to be saved first when JEE Mains has none", async () => {
    authorize();
    mockListRecords.mockResolvedValue([{ ...JEE_RECORD, sessions_applied: null }]);
    const res = await POST(uploadRequest({ exam_session: "1" }), params());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Tick and save a JEE Mains session/);
  });

  it("refuses a file that isn't a photo or a PDF", async () => {
    authorize();
    const res = await POST(
      uploadRequest({ exam_session: "1" }, [new Blob(["x"], { type: "text/plain" })]),
      params(),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unsupported MIME type: text/plain" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("refuses more than one file — one per exam or session", async () => {
    authorize();
    const photo = () => new Blob(["x"], { type: "image/jpeg" });
    const res = await POST(uploadRequest({ exam_session: "1" }, [photo(), photo()]), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Upload one file: a photo or a PDF" });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("removes the uploaded pages when the DB Service refuses the row", async () => {
    authorize();
    mockCreate.mockRejectedValue(new DbServiceError("nope", 422, "{}"));
    const res = await POST(uploadRequest({ exam_session: "1" }), params());
    expect(res.status).toBe(409);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["k/page-1.pdf"]);
  });

  it("undoes an upload a DB Service without the exam link stored unlinked", async () => {
    authorize();
    mockCreate.mockImplementation(async (input) => ({
      id: 502,
      student_id: input.student_id,
      document_type: input.document_type,
      pages: input.pages,
      metadata: {},
      uploaded_by: input.uploaded_by,
      deleted_at: null,
      inserted_at: "t",
      updated_at: "t",
    }));

    const res = await POST(uploadRequest({ exam_session: "1" }), params());

    expect(res.status).toBe(502);
    expect(mockSoftDelete).toHaveBeenCalledWith(502);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["k/page-1.pdf"]);
  });

  it("answers 502 when the DB Service fails", async () => {
    authorize();
    mockCreate.mockRejectedValue(new DbServiceError("down", 503, ""));
    const res = await POST(uploadRequest({ exam_session: "1" }), params());
    expect(res.status).toBe(502);
    expect(mockDeleteObjects).toHaveBeenCalledWith(["k/page-1.pdf"]);
  });
});

describe("DELETE /api/students/[id]/exam-records/[recordId]/acknowledgement", () => {
  function deleteRequest(documentId: string) {
    return new Request(
      `http://test/api/students/7/exam-records/10/acknowledgement?document_id=${documentId}`,
      { method: "DELETE" },
    );
  }

  it("refuses a JNV NVS Student", async () => {
    authorize({ pmuOnly: true });
    const res = await DELETE(deleteRequest("501"), params());
    expect(res.status).toBe(403);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("soft-deletes the registration's acknowledgement", async () => {
    authorize();
    mockGetAck.mockResolvedValue({
      id: 501,
      exam_session: 1,
      pages: [],
      uploaded_by: "a",
      uploaded_at: "x",
    });
    const res = await DELETE(deleteRequest("501"), params());
    expect(res.status).toBe(204);
    expect(mockGetAck).toHaveBeenCalledWith(7, 10, 501);
    expect(mockSoftDelete).toHaveBeenCalledWith(501);
  });

  it("refuses a document that isn't this registration's acknowledgement", async () => {
    authorize();
    mockGetAck.mockResolvedValue(null);
    const res = await DELETE(deleteRequest("777"), params());
    expect(res.status).toBe(404);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("refuses a malformed document id", async () => {
    authorize();
    const res = await DELETE(deleteRequest("5abc"), params());
    expect(res.status).toBe(400);
  });
});
