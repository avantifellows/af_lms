import { NextRequest, NextResponse } from "next/server";
import { requireAdminApiAccess } from "../../route-helpers";
import { query } from "@/lib/db";

interface BatchSearchRow {
  id: number;
  batch_id: string;
  name: string;
}

/**
 * Batch lookup for the centre "Manage Batches" picker. Read-only against the
 * local batch table, matched by name or external batch_id. Admin-gated.
 */
export async function GET(request: NextRequest) {
  const access = await requireAdminApiAccess();
  if (!access.ok) return access.response;

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") || "").trim();

  if (q.length < 2) {
    return NextResponse.json({ batches: [] });
  }

  const batches = await query<BatchSearchRow>(
    `SELECT id, batch_id, name
     FROM batch
     WHERE name ILIKE $1 OR batch_id ILIKE $1
     ORDER BY name
     LIMIT 25`,
    [`%${q}%`]
  );

  return NextResponse.json({ batches });
}
