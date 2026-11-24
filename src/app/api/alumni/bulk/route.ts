import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { BULK_MAX, runBulk } from "@/lib/alumni/bulk";
import { readBulkRequest } from "@/lib/alumni/bulk-types";

/**
 * Bulk edit: { targets, values, confirmed, overwrite, dryRun }. A dry run
 * (the default) only checks; otherwise each student is saved through the DB
 * Service. Returns { results } — one per student, in order.
 */
export async function POST(request: Request) {
  const auth = await authorizeAlumni({ requireEdit: true });
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const bulk = readBulkRequest(body, BULK_MAX);
  if (typeof bulk === "string") return NextResponse.json({ error: bulk }, { status: 400 });
  if (!Object.keys(bulk.values).length) return NextResponse.json({ error: "Fill in at least one answer." }, { status: 400 });
  return NextResponse.json({ results: await runBulk(bulk, auth.email, auth.permission) });
}
