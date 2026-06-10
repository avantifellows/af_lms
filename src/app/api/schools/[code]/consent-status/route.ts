import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { listDocuments } from "@/lib/db-service-documents";
import {
  ADMISSION_GRADES,
  CONSENT_REQUIRED_DOC_TYPES,
  type ConsentByStudentId,
  type ConsentDocType,
} from "@/lib/enrollment-readiness";

function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

const REQUIRED = new Set<string>(CONSENT_REQUIRED_DOC_TYPES);

// GET /api/schools/[code]/consent-status[?grade=11]
//
// Returns the required consent doc types currently uploaded for each student
// at the school: `{ consent: { [student_pk_id]: string[] } }`. Defaults to the
// admission grades (11 & 12); pass `?grade=N` to scope to a single grade.
// Powers the admission-readiness summary + per-student consent flags.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return jsonError(401, "Unauthorized");
  }

  const { code } = await params;
  const gradeParam = request.nextUrl.searchParams.get("grade");
  let grades: number[];
  if (gradeParam == null) {
    grades = [...ADMISSION_GRADES];
  } else {
    const grade = Number(gradeParam);
    if (!Number.isInteger(grade) || grade < 1) {
      return jsonError(400, "grade must be a positive integer");
    }
    grades = [grade];
  }

  // Resolve the school by UDISE or code (same lookup as the school page).
  const schoolRows = await query<{
    id: string;
    code: string;
    region: string | null;
  }>(
    `SELECT id, code, region
     FROM school
     WHERE af_school_category = 'JNV'
       AND (udise_code = $1 OR code = $1)`,
    [code],
  );
  const school = schoolRows[0];
  if (!school) {
    return jsonError(404, "School not found");
  }

  // Access control mirrors the school page: passcode users are pinned to their
  // own school; Google users need school access + students view permission.
  const isPasscodeUser = session.isPasscodeUser ?? false;
  if (isPasscodeUser) {
    if (session.schoolCode !== school.code) {
      return jsonError(403, "Forbidden");
    }
  } else {
    const permission = session.user?.email
      ? await getUserPermission(session.user.email)
      : null;
    if (!canAccessSchoolSync(permission, school.code, school.region ?? undefined)) {
      return jsonError(403, "Forbidden");
    }
    if (!getFeatureAccess(permission, "students").canView) {
      return jsonError(403, "Forbidden");
    }
  }

  // Students in the target grade(s) currently enrolled at the school
  // (excludes dropouts).
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
     JOIN grade gr ON er.group_id = gr.id
     WHERE g.child_id = $1
       AND gr.number = ANY($3::int[])
       AND (s.status IS NULL OR s.status != 'dropout')`,
    [school.id, CURRENT_ACADEMIC_YEAR, grades],
  );

  // Fetch each student's documents from the db-service. The docs API is
  // per-student, so this fans out over the grade roster (bounded). A failed
  // lookup degrades to "no consent" rather than failing the whole summary.
  const ids = [...new Set(students.map((s) => s.student_pk_id).filter(Boolean))];
  const results = await Promise.allSettled(
    ids.map(async (id) => {
      const docs = await listDocuments(Number(id));
      const present = new Set<ConsentDocType>();
      for (const doc of docs) {
        if (doc.deleted_at == null && REQUIRED.has(doc.document_type)) {
          present.add(doc.document_type as ConsentDocType);
        }
      }
      return [id, [...present]] as [string, ConsentDocType[]];
    }),
  );

  const consent: ConsentByStudentId = {};
  results.forEach((result, i) => {
    consent[ids[i]] = result.status === "fulfilled" ? result.value[1] : [];
  });

  return NextResponse.json({ consent });
}
