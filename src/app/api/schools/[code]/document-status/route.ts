import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getResolvedPermission,
} from "@/lib/permissions";
import { CURRENT_ACADEMIC_YEAR, isPmuRole } from "@/lib/constants";
import { findVisibleSchool } from "@/lib/school-lookup";
import { listDocumentTypesForStudents } from "@/lib/student-documents";
import type { DocumentType } from "@/lib/document-types";

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

// GET /api/schools/[code]/document-status
//
// Which document types are on file for each of the School's current Students:
// `{ documents: { [student_pk_id]: string[] } }`. Powers the Enrollment tab's
// Data completeness table (#468), which needs all seven types for the whole
// roster — two queries for the School, not one request per Student as the
// consent summary makes.
//
// Physical centres only: documents are not collected for PMU (JNV NVS)
// Students (#433), so a PMU role is refused outright rather than served an
// empty map it would then count as gaps.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return jsonError(401, "Unauthorized");

  const { code } = await params;
  const school = await findVisibleSchool(code);
  if (!school) return jsonError(404, "School not found");

  // Access control mirrors the School page: School access + students view.
  const permission = session.user?.email
    ? await getResolvedPermission(session.user.email)
    : null;
  if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
    return jsonError(403, "Forbidden");
  }
  if (!getFeatureAccess(permission, "students").canView) {
    return jsonError(403, "Forbidden");
  }
  if (isPmuRole(permission?.role)) {
    return jsonError(403, "Documents are not collected for JNV NVS Students");
  }

  // The School's current Students, every grade — the table covers the whole
  // roster, and the client narrows it to the selected Program, grade and
  // stream. Dropouts are left out, as they are on the roster.
  const students = await query<{ student_pk_id: string }>(
    `SELECT s.id AS student_pk_id
     FROM group_user gu
     JOIN "group" g ON gu.group_id = g.id AND g.type = 'school'
     JOIN "user" u ON gu.user_id = u.id
     JOIN student s ON s.user_id = u.id
     JOIN enrollment_record er ON er.user_id = u.id
       AND er.group_type = 'grade'
       AND er.is_current = true
       AND er.academic_year = $2
     WHERE g.child_id = $1
       AND (s.status IS NULL OR s.status != 'dropout')`,
    [school.id, CURRENT_ACADEMIC_YEAR],
  );

  const ids = students
    .map((row) => Number(row.student_pk_id))
    .filter((id) => Number.isFinite(id) && id > 0);

  try {
    const byStudent = await listDocumentTypesForStudents(ids);
    const documents: Record<string, DocumentType[]> = {};
    for (const id of ids) documents[String(id)] = byStudent.get(id) ?? [];
    return NextResponse.json({ documents });
  } catch (error) {
    console.error("Error loading school document status:", error);
    return jsonError(500, "Internal server error");
  }
}
