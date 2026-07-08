import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
  canAccessSchoolSync,
  getFeatureAccess,
  getResolvedPermission,
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
  const permission = await getResolvedPermission(email);
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

export interface BatchGroupInfo {
  /** auth_group.name — the program tag stamped as meta_data.group (Gurukul matches on it). */
  group: string;
  /** auth_group.input_schema.auth_type — "ID,DOB", "ID", etc. portal-frontend honours it. */
  authType: string;
}

/**
 * Resolve each class batch's program group + login auth type from the
 * batch.auth_group_id FK (NOT by parsing the batch_id prefix — ~29% of batches
 * use short codes like "EMRS-11-25-P01"/"AIS-11-A25" whose prefix does not match
 * the auth_group name). Returns a map keyed by batch_id; batches with no row are
 * absent. auth_type defaults to "ID" when the auth_group lacks the field.
 */
export async function resolveBatchGroups(
  batchIds: string[]
): Promise<Map<string, BatchGroupInfo>> {
  const byBatch = new Map<string, BatchGroupInfo>();
  if (batchIds.length === 0) return byBatch;
  const rows = await query<{ batch_id: string; group: string; auth_type: string | null }>(
    `
    SELECT b.batch_id, ag.name AS group, ag.input_schema->>'auth_type' AS auth_type
    FROM batch b
    JOIN auth_group ag ON ag.id = b.auth_group_id
    WHERE b.batch_id = ANY($1::text[])
    `,
    [batchIds]
  );
  for (const r of rows) {
    byBatch.set(r.batch_id, { group: r.group, authType: r.auth_type || "ID" });
  }
  return byBatch;
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
