import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAlumnusContext } from "@/lib/alumni/entry";
import { readSaveBody, respondWithSave } from "@/lib/alumni/save-request";
import { canAccessAlumni } from "@/lib/permissions";

// One existing alumnus, addressed by alumni.id — alumni are not Students
// (ADR 0008), so the gate is canAccessAlumni, never canAccessStudent.

type Params = { params: Promise<{ alumniId: string }> };

/** 401 / 400 / 403, or null when the person may go on. */
async function refuse(alumniId: string, requireEdit: boolean): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!/^\d+$/.test(alumniId)) return NextResponse.json({ error: "Invalid alumnus." }, { status: 400 });
  if (!(await canAccessAlumni(session, alumniId, { requireEdit }))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return null;
}

const notFound = () => NextResponse.json({ error: "No such alumnus." }, { status: 404 });

/** Everything the alumni form needs for this alumnus (profile, alumni record, ids). */
export async function GET(_request: Request, { params }: Params) {
  const { alumniId } = await params;
  const refused = await refuse(alumniId, false);
  if (refused) return refused;
  const context = await getAlumnusContext(alumniId);
  return context ? NextResponse.json(context) : notFound();
}

/** Update this alumnus through the DB Service: { values, confirmed? }. */
export async function POST(request: Request, { params }: Params) {
  const { alumniId } = await params;
  const refused = await refuse(alumniId, true);
  if (refused) return refused;
  const body = await readSaveBody(request);
  if (body instanceof NextResponse) return body;
  const context = await getAlumnusContext(alumniId);
  if (!context) return notFound();
  return respondWithSave(context, body);
}
