import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { validateAcademicYear } from "@/lib/academic-year";
import { query } from "@/lib/db";
import {
  canAccessSchool,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";
import { getTeacherIdsAtSchool } from "@/lib/mentorship-helpers";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface DbServiceMapping {
  mentee_id: number;
}

interface CandidateMenteeRow {
  id: number;
  name: string | null;
  grade: number | null;
  student_id: string | null;
  school_membership_count: number | string;
}

function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function actorIsPasscodeUser(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return Boolean((session as { isPasscodeUser?: boolean } | null)?.isPasscodeUser);
}

async function fetchAssignedMenteeIds(mentorIds: number[], academicYear: string): Promise<Set<number>> {
  if (mentorIds.length === 0) return new Set();
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
    console.error("Failed to fetch assigned academic mentorship mappings:", body);
    throw new Error("db-service academic mentorship mapping fetch failed");
  }

  const data = (await response.json()) as { mappings?: DbServiceMapping[] };
  return new Set((data.mappings ?? []).map((mapping) => mapping.mentee_id));
}

async function getCandidateMentees(schoolCode: string): Promise<CandidateMenteeRow[]> {
  return query<CandidateMenteeRow>(
    `SELECT u.id,
            NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS name,
            gr.number AS grade,
            s.student_id,
            COUNT(DISTINCT all_schools.code) AS school_membership_count
     FROM "user" u
     JOIN student s ON s.user_id = u.id
     JOIN group_user selected_gu ON selected_gu.user_id = u.id
     JOIN "group" selected_group ON selected_group.id = selected_gu.group_id
       AND selected_group.type = 'school'
     JOIN school selected_school ON selected_school.id = selected_group.child_id
       AND selected_school.code = $1
     LEFT JOIN group_user all_gu ON all_gu.user_id = u.id
     LEFT JOIN "group" all_groups ON all_groups.id = all_gu.group_id
       AND all_groups.type = 'school'
     LEFT JOIN school all_schools ON all_schools.id = all_groups.child_id
     LEFT JOIN enrollment_record er ON er.user_id = u.id
       AND er.group_type = 'grade'
       AND er.is_current = true
     LEFT JOIN grade gr ON gr.id = er.group_id
     WHERE (s.status IS NULL OR s.status != 'dropout')
     GROUP BY u.id, u.first_name, u.last_name, gr.number, s.student_id
     ORDER BY gr.number NULLS LAST, name NULLS LAST`,
    [schoolCode]
  );
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
  if (!permission || !access.canEdit) {
    return apiError(403, "Forbidden");
  }

  if (!(await canAccessSchool(session.user.email, schoolCode))) {
    return apiError(403, "Forbidden");
  }

  try {
    const teachers = await getTeacherIdsAtSchool(schoolCode);
    const assignedMenteeIds = await fetchAssignedMenteeIds(
      teachers.map((teacher) => teacher.id),
      academicYear
    );
    const candidates = await getCandidateMentees(schoolCode);
    const students = candidates.flatMap((student) => {
      const schoolMembershipCount = Number(student.school_membership_count);
      if (schoolMembershipCount !== 1) {
        console.error("Skipping academic mentorship mentee with school membership anomaly:", {
          id: student.id,
          school_membership_count: schoolMembershipCount,
        });
        return [];
      }
      if (assignedMenteeIds.has(student.id)) {
        return [];
      }
      return [
        {
          id: student.id,
          name: student.name,
          grade: student.grade,
          student_id: student.student_id,
        },
      ];
    });

    return NextResponse.json({ students });
  } catch (error) {
    console.error("Academic mentorship unassigned mentees GET failed:", error);
    return apiError(502, "Academic mentorship service unavailable");
  }
}
