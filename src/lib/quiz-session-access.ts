import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import {
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

/**
 * Pure teacher→centre batch access: the user may act on a set of batches iff
 * EVERY batch is linked (via centre_batch) to a centre they hold a seat at.
 * School permission is not consulted. Admins (scope.centres === "all") pass.
 *
 * "Every" (not "some") because these batchIds are the batches a mutation will
 * touch — a single batch outside the user's centres must block the whole op.
 */
export async function canAccessQuizSessionBatches(
  permission: UserPermission,
  batchIds: string[]
): Promise<boolean> {
  if (batchIds.length === 0) return false;

  const centres = permission.scope?.centres;
  if (!centres) return false;
  if (centres === "all") return true;

  // Centre ids each batch is actively linked to. A batch with no link can never
  // be reachable by a seated user, so its absence here correctly denies.
  const rows = await query<{ batch_id: string; centre_id: number | string }>(
    `
    SELECT b.batch_id, cb.centre_id
    FROM batch b
    JOIN centre_batch cb ON cb.batch_id = b.id AND cb.deleted_at IS NULL
    WHERE b.batch_id = ANY($1::text[])
    `,
    [batchIds]
  );

  const centresByBatch = new Map<string, Set<number>>();
  for (const r of rows) {
    const set = centresByBatch.get(r.batch_id) ?? new Set<number>();
    set.add(Number(r.centre_id));
    centresByBatch.set(r.batch_id, set);
  }

  // Every requested batch must resolve to at least one of the user's centres.
  return batchIds.every((batchId) => {
    const linked = centresByBatch.get(batchId);
    if (!linked) return false;
    for (const centreId of linked) {
      if (centres.has(centreId)) return true;
    }
    return false;
  });
}
