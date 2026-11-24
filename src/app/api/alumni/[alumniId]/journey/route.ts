import { NextResponse } from "next/server";
import { authorizeAlumnus } from "@/lib/alumni/access";
import { journeyEnabled, loadJourney } from "@/lib/alumni/journey";

// This alumnus's history (alumni_journey), newest first. Anyone who may view
// the alumnus may see it. `enabled: false` while ALUMNI_JOURNEY is off.

export async function GET(_request: Request, { params }: { params: Promise<{ alumniId: string }> }) {
  const { alumniId } = await params;
  const auth = await authorizeAlumnus(alumniId, false);
  if (!auth.ok) return auth.response;
  if (!journeyEnabled()) return NextResponse.json({ enabled: false, entries: [] });
  try {
    const { available, entries } = await loadJourney(alumniId);
    return NextResponse.json({ enabled: available, entries });
  } catch (error) {
    console.error("[alumni/journey]", error);
    return NextResponse.json({ error: "Couldn't load the history." }, { status: 500 });
  }
}
