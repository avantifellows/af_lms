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

interface RouteContext {
  params: Promise<{ id: string }>;
}

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

function apiError(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

function actorIsPasscodeUser(session: Awaited<ReturnType<typeof getServerSession>>): boolean {
  return Boolean((session as { isPasscodeUser?: boolean } | null)?.isPasscodeUser);
}

async function fetchMapping(id: string): Promise<DbServiceMapping | null> {
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

async function deleteMappingInDbService(id: string, updatedBy: string): Promise<Response> {
  if (!DB_SERVICE_URL || !DB_SERVICE_TOKEN) {
    throw new Error("Missing db-service configuration");
  }

  return fetch(`${DB_SERVICE_URL}/api/academic-mentorship-mapping/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${DB_SERVICE_TOKEN}`,
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ updated_by: updatedBy }),
  });
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return apiError(401, "Unauthorized");
  }
  const actorEmail = session.user.email;

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim();
  if (!schoolCode) {
    return apiError(400, "school_code is required");
  }

  const permission = await getUserPermission(actorEmail);
  const access = getFeatureAccess(permission, "academic_mentorship", {
    isPasscodeUser: actorIsPasscodeUser(session),
  });
  if (!permission || !access.canEdit) {
    return apiError(403, "Forbidden");
  }

  try {
    if (!(await canAccessSchool(actorEmail, schoolCode))) {
      return apiError(403, "Forbidden");
    }

    const { id } = await context.params;
    const mapping = await fetchMapping(id);
    if (!mapping || mapping.deleted_at) {
      return apiError(404, "Mapping not found");
    }

    const mentorSchoolCode = await getMentorSchoolCode(mapping.mentor_id);
    if (mentorSchoolCode !== schoolCode) {
      return apiError(403, "Forbidden");
    }

    const response = await deleteMappingInDbService(id, actorEmail);
    if (response.status === 404) {
      return apiError(404, "Mapping not found");
    }
    if (!response.ok) {
      const body = await response.text();
      console.error("Failed to delete academic mentorship mapping:", body);
      return apiError(502, "Academic mentorship service unavailable");
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Academic mentorship DELETE failed:", error);
    return apiError(502, "Academic mentorship service unavailable");
  }
}
