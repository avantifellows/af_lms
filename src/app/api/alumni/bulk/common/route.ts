import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { COMMON_MAX, loadCommonAnswers } from "@/lib/alumni/bulk";
import { readBulkTargets } from "@/lib/alumni/bulk-types";

/**
 * Bulk edit's starting point: { targets } -> what those students already have
 * on record, the same for all (prefilled) or differing.
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
  const targets = readBulkTargets(body, COMMON_MAX);
  if (typeof targets === "string") return NextResponse.json({ error: targets }, { status: 400 });
  try {
    return NextResponse.json(await loadCommonAnswers(targets, auth.permission));
  } catch (error) {
    console.error("[alumni/bulk/common]", error);
    return NextResponse.json({ error: "Couldn't load the students' records." }, { status: 500 });
  }
}
