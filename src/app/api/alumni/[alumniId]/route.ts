import { NextResponse } from "next/server";
import { authorizeAlumnus } from "@/lib/alumni/access";
import { getAlumnusContext } from "@/lib/alumni/entry";
import { readSaveBody, respondWithSave } from "@/lib/alumni/save-request";

// One existing alumnus, addressed by alumni.id — alumni are not Students
// (ADR 0008), so the gate is canAccessAlumni, never canAccessStudent.

type Params = { params: Promise<{ alumniId: string }> };

const notFound = () => NextResponse.json({ error: "No such alumnus." }, { status: 404 });

/** Everything the alumni form needs for this alumnus (profile, alumni record, ids). */
export async function GET(_request: Request, { params }: Params) {
  const { alumniId } = await params;
  const auth = await authorizeAlumnus(alumniId, false);
  if (!auth.ok) return auth.response;
  const context = await getAlumnusContext(alumniId);
  return context ? NextResponse.json(context) : notFound();
}

/** Update this alumnus through the DB Service: { values, confirmed? }. */
export async function POST(request: Request, { params }: Params) {
  const { alumniId } = await params;
  const auth = await authorizeAlumnus(alumniId, true);
  if (!auth.ok) return auth.response;
  const body = await readSaveBody(request);
  if (body instanceof NextResponse) return body;
  const context = await getAlumnusContext(alumniId);
  if (!context) return notFound();
  return respondWithSave(context, body, auth);
}
