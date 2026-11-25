import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { gateExamRecords, parsePositiveId } from "@/lib/exam-records-gate";
import {
  getExamAcknowledgement,
  listStudentExamRecords,
} from "@/lib/student-exam-records";
import {
  acknowledgementSlots,
  EXAM_ACK_DOCUMENT_TYPE,
  parseAcknowledgementSession,
  type ExamAcknowledgement,
} from "@/lib/exam-acknowledgements";
import { readDocumentPages } from "@/lib/document-upload";
import type { StudentExamSummary } from "@/lib/competitive-exams";
import { deleteDocumentObjects, S3UploadError, uploadDocumentPages } from "@/lib/s3";
import {
  createDocument,
  DbServiceError,
  softDeleteDocument,
  type LmsStudentDocumentRow,
} from "@/lib/db-service-documents";

// An exam registration's exam acknowledgement: the confirmation page
// the exam portal issues once the form is submitted. One per sitting for JEE
// Mains (Session 1, Session 2), one for any other exam.
//
// Both verbs sit behind the Exams tab's gate (edit rights on the Student, not a
// JNV NVS Student), and the registration in the URL must be this Student's.
// Viewing a page goes through the documents page route, which needs only
// access to the Student's School, like every other Student document.
//
// The DB Service owns the rules that span rows: an upload replaces the
// sitting's current acknowledgement in one transaction, and unticking a
// sitting or removing the registration retires its acknowledgements.

interface GatedRegistration {
  ok: true;
  studentId: number;
  record: StudentExamSummary;
  viewerEmail: string;
}

type Gate = GatedRegistration | { ok: false; response: NextResponse };

function error(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** The Exams tab gate, then the registration, which must be this Student's. */
async function gate(rawStudentId: string, rawRecordId: string): Promise<Gate> {
  const session = await getServerSession(authOptions);
  const gated = await gateExamRecords(session, rawStudentId);
  if (!gated.ok) return gated;

  const recordId = parsePositiveId(rawRecordId);
  if (recordId === null) return { ok: false, response: error("Invalid record id", 400) };

  const record = (await listStudentExamRecords(gated.studentId)).find(
    (candidate) => candidate.id === recordId,
  );
  if (!record) return { ok: false, response: error("Exam registration not found", 404) };

  return {
    ok: true,
    studentId: gated.studentId,
    record,
    viewerEmail: session?.user?.email || "unknown",
  };
}

function toAcknowledgement(row: LmsStudentDocumentRow): ExamAcknowledgement {
  return {
    id: row.id,
    exam_session: row.exam_session ?? null,
    pages: [...row.pages]
      .map((page) => ({ page_number: page.page_number, mime_type: page.mime_type }))
      .sort((a, b) => a.page_number - b.page_number),
    uploaded_by: row.uploaded_by,
    uploaded_at: row.inserted_at,
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const { id, recordId } = await params;
  try {
    const gated = await gate(id, recordId);
    if (!gated.ok) return gated.response;
    const { studentId, record } = gated;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return error("Invalid multipart body", 400);
    }

    const slots = acknowledgementSlots(record.exam_name, record.sessions_applied);
    if (slots.length === 0) {
      return error(`Tick and save a ${record.exam_name} session before uploading`, 400);
    }
    const session = parseAcknowledgementSession(form.get("exam_session"), slots);
    if (!session.ok) return error(session.error, 400);

    const read = await readDocumentPages(form);
    if (!read.ok) return error(read.error, 400);
    // One file per exam or session: a single photo or a single PDF.
    if (read.pages.length !== 1) return error("Upload one file: a photo or a PDF", 400);

    let uploaded;
    try {
      uploaded = await uploadDocumentPages({
        studentId,
        documentType: EXAM_ACK_DOCUMENT_TYPE,
        documentUuid: randomUUID(),
        pages: read.pages,
      });
    } catch (err) {
      if (err instanceof S3UploadError) {
        console.error("S3 upload partial failure:", err.message, err.cause);
        await deleteDocumentObjects(err.uploaded.map((p) => p.s3_key));
      } else {
        console.error("S3 upload unexpected error:", err);
      }
      return error("Failed to upload pages to storage", 502);
    }

    let row: LmsStudentDocumentRow;
    try {
      row = await createDocument({
        student_id: studentId,
        document_type: EXAM_ACK_DOCUMENT_TYPE,
        pages: uploaded,
        metadata: {},
        student_exam_record_id: record.id,
        exam_session: session.session,
        uploaded_by: gated.viewerEmail,
      });
    } catch (err) {
      await deleteDocumentObjects(uploaded.map((p) => p.s3_key));
      if (err instanceof DbServiceError) {
        console.error("db-service createDocument (acknowledgement) failed:", err.status, err.body);
        // 422: the registration changed between this read and the write (a
        // session unticked, the exam removed) — the tab should reload.
        if (err.status === 422) {
          return error("This exam changed while uploading. Reload the Exams tab and try again.", 409);
        }
        return error("Failed to record acknowledgement", 502);
      }
      throw err;
    }

    // A DB Service that predates the exam link drops the two fields it doesn't
    // know and stores an unlinked document, which no tab would ever show. Undo
    // it rather than report a success the teacher can't see.
    if (
      row.student_exam_record_id !== record.id ||
      (row.exam_session ?? null) !== session.session
    ) {
      console.error("db-service stored the acknowledgement without its exam link:", row.id);
      try {
        await softDeleteDocument(row.id);
      } catch (err) {
        console.error("Could not remove the unlinked acknowledgement:", row.id, err);
      }
      await deleteDocumentObjects(uploaded.map((p) => p.s3_key));
      return error("Exam acknowledgements can't be stored yet. Try again later.", 502);
    }

    return NextResponse.json(toAcknowledgement(row), { status: 201 });
  } catch (err) {
    console.error("Error uploading exam acknowledgement:", err);
    return error("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; recordId: string }> },
) {
  const { id, recordId } = await params;
  try {
    const gated = await gate(id, recordId);
    if (!gated.ok) return gated.response;

    const documentId = parsePositiveId(
      new URL(request.url).searchParams.get("document_id") ?? "",
    );
    if (documentId === null) return error("Invalid document id", 400);

    const current = await getExamAcknowledgement(gated.studentId, gated.record.id, documentId);
    if (!current) return error("Acknowledgement not found", 404);

    try {
      await softDeleteDocument(documentId);
    } catch (err) {
      if (err instanceof DbServiceError) {
        if (err.status === 404) return error("Acknowledgement not found", 404);
        console.error("db-service softDeleteDocument (acknowledgement) failed:", err.status, err.body);
        return error("Failed to remove acknowledgement", 502);
      }
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("Error removing exam acknowledgement:", err);
    return error("Internal server error", 500);
  }
}
