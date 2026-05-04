import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getUserPermission,
  type UserPermission,
} from "@/lib/permissions";

type QuizSessionAccessMode = "view" | "edit";

interface QuizSessionAccessOk {
  ok: true;
  permission: UserPermission;
}

interface QuizSessionAccessDenied {
  ok: false;
  response: NextResponse;
}

export type QuizSessionAccessResult = QuizSessionAccessOk | QuizSessionAccessDenied;

export async function requireQuizSessionAccess(
  email: string,
  mode: QuizSessionAccessMode
): Promise<QuizSessionAccessResult> {
  const permission = await getUserPermission(email);
  const access = getFeatureAccess(permission, "quiz_sessions");

  if ((mode === "view" && !access.canView) || (mode === "edit" && !access.canEdit)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  if (!permission) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, permission };
}

export async function canAccessQuizSessionSchool(
  permission: UserPermission,
  schoolId: number
): Promise<boolean> {
  const rows = await query<{ code: string; region: string | null }>(
    `
    SELECT code, region
    FROM school
    WHERE id = $1
    LIMIT 1
    `,
    [schoolId]
  );

  const school = rows[0];
  if (!school) return false;
  return canAccessSchoolSync(permission, school.code, school.region || undefined);
}

export async function canAccessQuizSessionBatches(
  permission: UserPermission,
  batchIds: string[]
): Promise<boolean> {
  if (batchIds.length === 0) return false;

  const rows = await query<{ code: string; region: string | null }>(
    `
    SELECT DISTINCT s.code, s.region
    FROM batch b
    JOIN school_batch sb ON sb.batch_id = b.id
    JOIN school s ON s.id = sb.school_id
    WHERE b.batch_id = ANY($1::text[])
    `,
    [batchIds]
  );

  return rows.some((school) =>
    canAccessSchoolSync(permission, school.code, school.region || undefined)
  );
}
