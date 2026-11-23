import { query } from "@/lib/db";
import { isValidDocumentType, type DocumentType } from "@/lib/document-types";

/**
 * Which document types are on file for each of these Students, in one query
 * for the whole School.
 *
 * The DB Service's documents API is one Student at a time, which the consent
 * summary fans out over in capped batches. The Data completeness table (#468)
 * needs every type for every Student on the roster, so it reads Postgres
 * directly — a read, like the roster itself, per the reads-vs-writes split.
 * Uploads and deletes still go through the DB Service.
 *
 * Soft-deleted rows are left out: a document someone removed is one the
 * Student is missing again.
 */
export async function listDocumentTypesForStudents(
  studentIds: number[],
): Promise<Map<number, DocumentType[]>> {
  const byStudent = new Map<number, DocumentType[]>();
  const ids = [...new Set(studentIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) return byStudent;

  const rows = await query<{ student_id: string | number; document_type: string }>(
    `SELECT DISTINCT student_id, document_type
     FROM lms_student_documents
     WHERE student_id = ANY($1::bigint[])
       AND deleted_at IS NULL`,
    [ids],
  );

  for (const row of rows) {
    // A type the LMS doesn't offer (an older or hand-inserted row) is no
    // Student's missing document, so it is left out rather than counted.
    if (!isValidDocumentType(row.document_type)) continue;
    const studentId = Number(row.student_id);
    const list = byStudent.get(studentId) ?? [];
    list.push(row.document_type as DocumentType);
    byStudent.set(studentId, list);
  }

  return byStudent;
}
