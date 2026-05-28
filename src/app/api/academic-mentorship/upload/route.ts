import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { getCurrentAcademicYear } from "@/lib/academic-year";
import { query } from "@/lib/db";
import {
  canAccessSchool,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import { getTeacherIdsAtSchool } from "@/lib/mentorship-helpers";
import {
  normalizeMentorEmail,
  normalizeStudentId,
  validateUploadRows,
  type UploadCsvRow,
  type UploadMentor,
  type UploadStudent,
} from "@/lib/mentorship-csv-validation";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface DbServiceMapping {
  mentee_id: number;
}

function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function actorIsPasscodeUser(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return Boolean((session as { isPasscodeUser?: boolean } | null)?.isPasscodeUser);
}

async function getEligibleMentors(
  schoolCode: string,
  mentorEmails: string[]
): Promise<Map<string, UploadMentor>> {
  if (mentorEmails.length === 0) return new Map();

  const mentors = await query<UploadMentor>(
    `SELECT id, email
     FROM user_permission
     WHERE LOWER(email) = ANY($1::text[])
       AND role = 'teacher'
       AND level = 1
       AND cardinality(school_codes) = 1
       AND school_codes @> ARRAY[$2]::text[]`,
    [mentorEmails, schoolCode]
  );

  return new Map(mentors.map((mentor) => [mentor.email.toLowerCase(), mentor]));
}

async function getStudents(studentIds: string[], schoolCode: string): Promise<Map<string, UploadStudent[]>> {
  if (studentIds.length === 0) return new Map();

  const students = await query<UploadStudent>(
    `SELECT s.user_id,
            s.student_id,
            s.status,
            COUNT(DISTINCT CASE WHEN all_schools.code = $2 THEN all_schools.code END)
              AS selected_school_match_count,
            COUNT(DISTINCT all_schools.code) AS school_membership_count
     FROM student s
     LEFT JOIN group_user all_gu ON all_gu.user_id = s.user_id
     LEFT JOIN "group" all_groups ON all_groups.id = all_gu.group_id
       AND all_groups.type = 'school'
     LEFT JOIN school all_schools ON all_schools.id = all_groups.child_id
     WHERE s.student_id = ANY($1::text[])
     GROUP BY s.user_id, s.student_id, s.status`,
    [studentIds, schoolCode]
  );

  const byStudentId = new Map<string, UploadStudent[]>();
  for (const student of students) {
    const existing = byStudentId.get(student.student_id) ?? [];
    existing.push(student);
    byStudentId.set(student.student_id, existing);
  }
  return byStudentId;
}

async function fetchExistingMenteeIds(schoolCode: string, academicYear: string): Promise<Set<number>> {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  const teachers = await getTeacherIdsAtSchool(schoolCode);
  if (teachers.length === 0) return new Set();

  const params = new URLSearchParams({
    mentor_ids: teachers.map((teacher) => teacher.id).join(","),
    academic_year: academicYear,
  });
  const response = await fetch(
    `${DB_SERVICE_URL}/api/academic-mentorship-mapping?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
        accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error("Failed to fetch existing academic mentorship mappings:", body);
    throw new Error("db-service academic mentorship mapping fetch failed");
  }

  const data = (await response.json()) as { mappings?: DbServiceMapping[] };
  return new Set((data.mappings ?? []).map((mapping) => mapping.mentee_id));
}

async function createBatchInDbService(input: {
  mappings: Array<{
    mentor_id: number;
    mentee_id: number;
    academic_year: string;
    created_by: string;
  }>;
}) {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  return fetch(`${DB_SERVICE_URL}/api/academic-mentorship-mapping/batch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiError(401, "Unauthorized");
  }
  const createdBy = session.user.email;

  let body: {
    school_code?: unknown;
    rows?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  const rows = Array.isArray(body.rows) ? (body.rows as UploadCsvRow[]) : null;

  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }
  if (!rows) {
    return apiError(400, "rows is required");
  }
  if (rows.length > 500) {
    return apiError(400, "Maximum 500 rows allowed");
  }

  const permission = await getUserPermission(createdBy);
  const access = getFeatureAccess(permission, "academic_mentorship", {
    isPasscodeUser: actorIsPasscodeUser(session),
  });
  if (!permission || !access.canEdit) {
    return apiError(403, "Forbidden");
  }

  if (!(await canAccessSchool(createdBy, schoolCode))) {
    return apiError(403, "Forbidden");
  }

  const academicYear = getCurrentAcademicYear();

  try {
    const mentorEmails = [
      ...new Set(rows.map((row) => normalizeMentorEmail(row.mentor_email)).filter(Boolean)),
    ];
    const studentIds = [
      ...new Set(rows.map((row) => normalizeStudentId(row.student_id)).filter(Boolean)),
    ];

    const [mentorMap, studentMap, existingMappings] = await Promise.all([
      getEligibleMentors(schoolCode, mentorEmails),
      getStudents(studentIds, schoolCode),
      fetchExistingMenteeIds(schoolCode, academicYear),
    ]);

    const validation = validateUploadRows(rows, mentorMap, studentMap, existingMappings);
    if (!validation.valid) {
      return NextResponse.json({ errors: validation.errors }, { status: 400 });
    }

    const response = await createBatchInDbService({
      mappings: validation.validatedRows.map((row) => ({
        mentor_id: row.mentor_id,
        mentee_id: row.mentee_id,
        academic_year: academicYear,
        created_by: createdBy,
      })),
    });

    if (response.status === 409) {
      return apiError(
        409,
        "One or more students were assigned by another user during upload. Refresh and retry."
      );
    }
    if (!response.ok) {
      const responseBody = await response.text();
      console.error("Failed to batch create academic mentorship mappings:", responseBody);
      return apiError(502, "Academic mentorship service unavailable");
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Academic mentorship upload failed:", error);
    return apiError(502, "Academic mentorship service unavailable");
  }
}
