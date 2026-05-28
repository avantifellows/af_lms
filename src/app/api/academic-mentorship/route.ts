import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import { validateAcademicYear } from "@/lib/academic-year";
import {
  canAccessSchool,
  getFeatureAccess,
  getUserPermission,
  type UserPermission,
} from "@/lib/permissions";
import {
  getMentorDisplayName,
  getTeacherIdsAtSchool,
  type TeacherMentorRow,
} from "@/lib/mentorship-helpers";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface DbServiceMapping {
  id: number;
  mentor_id: number;
  mentee_id: number;
  academic_year: string;
  created_by: string;
  inserted_at: string;
}

interface MenteeRow {
  id: number;
  mentee_name: string | null;
  mentee_student_id: string | null;
  mentee_grade: number | null;
}

interface MentorEligibilityRow {
  id: number;
  email: string;
  full_name: string | null;
}

interface MenteeValidationRow {
  id: number;
  selected_school_match_count: number | string;
  school_membership_count: number | string;
  is_dropout: boolean | null;
}

function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function actorIsPasscodeUser(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return Boolean((session as { isPasscodeUser?: boolean } | null)?.isPasscodeUser);
}

async function getMentorsForScope(
  permission: UserPermission,
  schoolCode: string
): Promise<TeacherMentorRow[]> {
  if (permission.role === "teacher") {
    return [
      {
        id: permission.id,
        email: permission.email,
        full_name: permission.full_name,
      },
    ];
  }

  return getTeacherIdsAtSchool(schoolCode);
}

async function fetchMappingsFromDbService(
  mentorIds: number[],
  academicYear: string
): Promise<DbServiceMapping[]> {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  const params = new URLSearchParams({
    mentor_ids: mentorIds.join(","),
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
    console.error("Failed to fetch academic mentorship mappings:", body);
    throw new Error("db-service academic mentorship mapping fetch failed");
  }

  const data = (await response.json()) as { mappings?: DbServiceMapping[] };
  return data.mappings ?? [];
}

async function getMenteesById(menteeIds: number[]): Promise<Map<number, MenteeRow>> {
  if (menteeIds.length === 0) return new Map();

  const rows = await query<MenteeRow>(
    `SELECT u.id,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS mentee_name,
            s.student_id AS mentee_student_id,
            gr.number AS mentee_grade
     FROM "user" u
     LEFT JOIN student s ON s.user_id = u.id
     LEFT JOIN enrollment_record er ON er.user_id = u.id
       AND er.group_type = 'grade'
       AND er.is_current = true
     LEFT JOIN grade gr ON er.group_id = gr.id
     WHERE u.id = ANY($1::int[])`,
    [menteeIds]
  );

  return new Map(rows.map((row) => [row.id, row]));
}

async function resolveEligibleMentor(mentorEmail: string, schoolCode: string) {
  const rows = await query<MentorEligibilityRow>(
    `SELECT id, email, full_name
     FROM user_permission
     WHERE LOWER(email) = LOWER($1)
       AND role = 'teacher'
       AND level = 1
       AND cardinality(school_codes) = 1
       AND school_codes @> ARRAY[$2]::text[]`,
    [mentorEmail, schoolCode]
  );

  return rows[0] ?? null;
}

async function validateMenteeForSchool(menteeUserId: number, schoolCode: string): Promise<string | null> {
  const rows = await query<MenteeValidationRow>(
    `SELECT u.id,
            COUNT(DISTINCT CASE WHEN all_schools.code = $2 THEN all_schools.code END)
              AS selected_school_match_count,
            COUNT(DISTINCT all_schools.code) AS school_membership_count,
            BOOL_OR(s.status = 'dropout') AS is_dropout
     FROM "user" u
     JOIN student s ON s.user_id = u.id
     LEFT JOIN group_user all_gu ON all_gu.user_id = u.id
     LEFT JOIN "group" all_groups ON all_groups.id = all_gu.group_id
       AND all_groups.type = 'school'
     LEFT JOIN school all_schools ON all_schools.id = all_groups.child_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [menteeUserId, schoolCode]
  );

  const mentee = rows[0];
  if (!mentee) {
    return "Mentee is not enrolled at selected school";
  }
  if (mentee.is_dropout) {
    return "Mentee is not enrolled at selected school";
  }
  if (Number(mentee.selected_school_match_count) !== 1) {
    return "Mentee is not enrolled at selected school";
  }
  if (Number(mentee.school_membership_count) !== 1) {
    return "Mentee has multiple school memberships";
  }

  return null;
}

async function createMappingInDbService(input: {
  mentor_id: number;
  mentee_id: number;
  academic_year: string;
  created_by: string;
}) {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  return fetch(`${DB_SERVICE_URL}/api/academic-mentorship-mapping`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(input),
  });
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiError(401, "Unauthorized");
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  const academicYear = request.nextUrl.searchParams.get("academic_year")?.trim();
  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }
  if (!academicYear || !validateAcademicYear(academicYear)) {
    return apiError(400, "academic_year is invalid");
  }

  const permission = await getUserPermission(session.user.email);
  const access = getFeatureAccess(permission, "academic_mentorship", {
    isPasscodeUser: actorIsPasscodeUser(session),
  });
  if (!permission || !access.canView) {
    return apiError(403, "Forbidden");
  }

  if (!(await canAccessSchool(session.user.email, schoolCode))) {
    return apiError(403, "Forbidden");
  }

  const mentors = await getMentorsForScope(permission, schoolCode);
  if (mentors.length === 0) {
    return NextResponse.json({ mappings: [] });
  }

  try {
    const mentorById = new Map(mentors.map((mentor) => [mentor.id, mentor]));
    const mappings = await fetchMappingsFromDbService(
      mentors.map((mentor) => mentor.id),
      academicYear
    );
    const menteeRows = await getMenteesById([
      ...new Set(mappings.map((mapping) => mapping.mentee_id)),
    ]);

    return NextResponse.json({
      mappings: mappings.map((mapping) => {
        const mentor = mentorById.get(mapping.mentor_id);
        const mentee = menteeRows.get(mapping.mentee_id);
        return {
          id: mapping.id,
          mentor_id: mapping.mentor_id,
          mentor_name: mentor ? getMentorDisplayName(mentor) : `Mentor ${mapping.mentor_id}`,
          mentor_email: mentor?.email ?? null,
          mentee_id: mapping.mentee_id,
          mentee_name: mentee?.mentee_name ?? null,
          mentee_grade: mentee?.mentee_grade ?? null,
          mentee_student_id: mentee?.mentee_student_id ?? null,
          academic_year: mapping.academic_year,
          created_by: mapping.created_by,
          inserted_at: mapping.inserted_at,
        };
      }),
    });
  } catch (error) {
    console.error("Academic mentorship GET failed:", error);
    return apiError(502, "Academic mentorship service unavailable");
  }
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiError(401, "Unauthorized");
  }

  let body: {
    school_code?: unknown;
    mentor_email?: unknown;
    mentee_user_id?: unknown;
    academic_year?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  const mentorEmail =
    typeof body.mentor_email === "string" ? body.mentor_email.trim().toLowerCase() : "";
  const academicYear =
    typeof body.academic_year === "string" ? body.academic_year.trim() : "";
  const menteeUserId = Number(body.mentee_user_id);

  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }
  if (!mentorEmail) {
    return apiError(400, "mentor_email is required");
  }
  if (!Number.isInteger(menteeUserId) || menteeUserId <= 0) {
    return apiError(400, "mentee_user_id is invalid");
  }
  if (!academicYear || !validateAcademicYear(academicYear)) {
    return apiError(400, "academic_year is invalid");
  }

  const permission = await getUserPermission(session.user.email);
  const access = getFeatureAccess(permission, "academic_mentorship", {
    isPasscodeUser: actorIsPasscodeUser(session),
  });
  if (!permission || !access.canEdit) {
    return apiError(403, "Forbidden");
  }

  if (!(await canAccessSchool(session.user.email, schoolCode))) {
    return apiError(403, "Forbidden");
  }

  try {
    const mentor = await resolveEligibleMentor(mentorEmail, schoolCode);
    if (!mentor) {
      return apiError(400, "Mentor is not eligible for academic mentorship at this school");
    }

    const menteeError = await validateMenteeForSchool(menteeUserId, schoolCode);
    if (menteeError) {
      return apiError(400, menteeError);
    }

    const response = await createMappingInDbService({
      mentor_id: mentor.id,
      mentee_id: menteeUserId,
      academic_year: academicYear,
      created_by: session.user.email,
    });

    if (response.status === 409) {
      return apiError(409, "This student already has an active mentor for this academic year");
    }
    if (!response.ok) {
      const responseBody = await response.text();
      console.error("Failed to create academic mentorship mapping:", responseBody);
      return apiError(502, "Academic mentorship service unavailable");
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Academic mentorship POST failed:", error);
    return apiError(502, "Academic mentorship service unavailable");
  }
}
