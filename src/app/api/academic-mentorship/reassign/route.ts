import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  canAccessSchool,
  getFeatureAccess,
  getUserPermission,
} from "@/lib/permissions";

const DB_SERVICE_URL = process.env.DB_SERVICE_URL;
const DB_SERVICE_TOKEN = process.env.DB_SERVICE_TOKEN;

interface DbServiceMapping {
  id: number;
  mentor_id: number;
  mentee_id: number;
  academic_year: string;
  deleted_at: string | null;
}

interface MentorSchoolRow {
  school_codes: string[] | null;
}

interface MentorEligibilityRow {
  id: number;
  email: string;
  full_name: string | null;
}

interface MenteeSchoolValidationRow {
  id: number;
  selected_school_match_count: number | string;
  school_membership_count: number | string;
}

function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function actorIsPasscodeUser(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return Boolean((session as { isPasscodeUser?: boolean } | null)?.isPasscodeUser);
}

async function fetchMapping(id: number): Promise<DbServiceMapping | null> {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  const response = await fetch(`${DB_SERVICE_URL}/api/academic-mentorship-mapping/${id}`, {
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      accept: "application/json",
    },
    cache: "no-store",
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const body = await response.text();
    console.error("Failed to fetch academic mentorship mapping:", body);
    throw new Error("db-service academic mentorship mapping fetch failed");
  }

  const data = (await response.json()) as { mapping?: DbServiceMapping | null };
  return data.mapping ?? null;
}

async function getMentorSchoolCode(mentorId: number): Promise<string | null> {
  const rows = await query<MentorSchoolRow>(
    `SELECT school_codes
     FROM user_permission
     WHERE id = $1`,
    [mentorId]
  );
  const schoolCodes = rows[0]?.school_codes ?? [];
  return schoolCodes.length === 1 ? schoolCodes[0] : null;
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

async function validateMenteeSchool(menteeId: number, schoolCode: string): Promise<string | null> {
  const rows = await query<MenteeSchoolValidationRow>(
    `SELECT u.id,
            COUNT(DISTINCT CASE WHEN all_schools.code = $2 THEN all_schools.code END)
              AS selected_school_match_count,
            COUNT(DISTINCT all_schools.code) AS school_membership_count
     FROM "user" u
     LEFT JOIN group_user all_gu ON all_gu.user_id = u.id
     LEFT JOIN "group" all_groups ON all_groups.id = all_gu.group_id
       AND all_groups.type = 'school'
     LEFT JOIN school all_schools ON all_schools.id = all_groups.child_id
     WHERE u.id = $1
     GROUP BY u.id`,
    [menteeId, schoolCode]
  );

  const mentee = rows[0];
  if (!mentee || Number(mentee.selected_school_match_count) !== 1) {
    return "Mentee is not enrolled at selected school";
  }
  if (Number(mentee.school_membership_count) !== 1) {
    return "Mentee has multiple school memberships";
  }
  return null;
}

async function reassignMappingInDbService(input: {
  old_mapping_id: number;
  new_mentor_id: number;
  updated_by: string;
}) {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  return fetch(`${DB_SERVICE_URL}/api/academic-mentorship-mapping/reassign`, {
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

  let body: {
    school_code?: unknown;
    old_mapping_id?: unknown;
    new_mentor_email?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body");
  }

  const schoolCode = typeof body.school_code === "string" ? body.school_code.trim() : "";
  const oldMappingId = Number(body.old_mapping_id);
  const newMentorEmail =
    typeof body.new_mentor_email === "string"
      ? body.new_mentor_email.trim().toLowerCase()
      : "";

  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }
  if (!Number.isInteger(oldMappingId) || oldMappingId <= 0) {
    return apiError(400, "old_mapping_id is invalid");
  }
  if (!newMentorEmail) {
    return apiError(400, "new_mentor_email is required");
  }

  const permission = await getUserPermission(session.user.email);
  const access = getFeatureAccess(permission, "academic_mentorship", {
    isPasscodeUser: actorIsPasscodeUser(session),
  });
  if (!permission || !access.canEdit) {
    return apiError(403, "Forbidden");
  }

  try {
    const mapping = await fetchMapping(oldMappingId);
    if (!mapping) {
      return apiError(404, "Mapping not found");
    }
    if (mapping.deleted_at) {
      return apiError(422, "Mapping already unassigned");
    }

    const mentorSchoolCode = await getMentorSchoolCode(mapping.mentor_id);
    if (mentorSchoolCode !== schoolCode) {
      return apiError(403, "Forbidden");
    }

    if (!(await canAccessSchool(session.user.email, schoolCode))) {
      return apiError(403, "Forbidden");
    }

    const newMentor = await resolveEligibleMentor(newMentorEmail, schoolCode);
    if (!newMentor) {
      return apiError(400, "Mentor is not eligible for academic mentorship at this school");
    }

    const menteeError = await validateMenteeSchool(mapping.mentee_id, schoolCode);
    if (menteeError) {
      return apiError(400, menteeError);
    }

    const response = await reassignMappingInDbService({
      old_mapping_id: oldMappingId,
      new_mentor_id: newMentor.id,
      updated_by: session.user.email,
    });
    if (response.status === 409) {
      return apiError(409, "This student already has an active mentor for this academic year");
    }
    if (!response.ok) {
      const responseBody = await response.text();
      console.error("Failed to reassign academic mentorship mapping:", responseBody);
      return apiError(502, "Academic mentorship service unavailable");
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Academic mentorship reassign failed:", error);
    return apiError(502, "Academic mentorship service unavailable");
  }
}
