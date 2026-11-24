import { NextResponse } from "next/server";
import { authorizeAlumnus } from "@/lib/alumni/access";
import { getAlumnusContext } from "@/lib/alumni/entry";
import { journeyEnabled, revertToJourney } from "@/lib/alumni/journey";

// Restore this alumnus's record to an earlier history entry:
// { journeyId, version }. Needs edit access, like a save.

export async function POST(request: Request, { params }: { params: Promise<{ alumniId: string }> }) {
  const { alumniId } = await params;
  const auth = await authorizeAlumnus(alumniId, true);
  if (!auth.ok) return auth.response;
  if (!journeyEnabled()) return NextResponse.json({ error: "History is not turned on." }, { status: 404 });

  let body: { journeyId?: unknown; version?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const journeyId = String(body.journeyId ?? "");
  if (!/^\d+$/.test(journeyId) || typeof body.version !== "string") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const context = await getAlumnusContext(alumniId);
  if (!context) return NextResponse.json({ error: "No such alumnus." }, { status: 404 });

  try {
    const result = await revertToJourney(context, journeyId, body.version, { actorEmail: auth.email, actorRole: auth.role || undefined });
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (error) {
    console.error("[alumni/revert]", error);
    return NextResponse.json({ error: "Couldn't restore. Try again." }, { status: 500 });
  }
}
