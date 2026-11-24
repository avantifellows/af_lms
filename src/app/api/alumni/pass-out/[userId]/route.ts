import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { journeyEnabled } from "@/lib/alumni/journey";
import { loadPassOut, type PassOutLoad } from "@/lib/alumni/pass-out";
import { readSaveBody, respondWithSave } from "@/lib/alumni/save-request";

// A pass-out who isn't an alumnus yet, addressed by user.id. Once added they
// are an alumnus and live at /api/alumni/[alumniId] (ADR 0008).

function refusal(loaded: Exclude<PassOutLoad, { ok: true }>): NextResponse {
  const { status, error } = loaded;
  return NextResponse.json("alumniId" in loaded ? { error, alumniId: loaded.alumniId } : { error }, { status });
}

/** Everything the alumni form needs to add this pass-out (profile, ids). */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await authorizeAlumni();
  if (!auth.ok) return auth.response;
  const loaded = await loadPassOut((await params).userId, auth.permission);
  return loaded.ok ? NextResponse.json({ ...loaded.context, journeyEnabled: journeyEnabled() }) : refusal(loaded);
}

/** Add this pass-out to the alumni table through the DB Service: { values, confirmed? }. */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await authorizeAlumni({ requireEdit: true });
  if (!auth.ok) return auth.response;
  const body = await readSaveBody(request);
  if (body instanceof NextResponse) return body;
  const loaded = await loadPassOut((await params).userId, auth.permission);
  if (!loaded.ok) return refusal(loaded);
  return respondWithSave(loaded.context, body, { email: auth.email, role: auth.permission.role });
}
