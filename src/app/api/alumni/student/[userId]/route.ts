import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { getEntryContext, type EntryContext } from "@/lib/alumni/entry";
import { saveAlumni } from "@/lib/alumni/save";
import { canAccessSchool, type UserPermission } from "@/lib/permissions";

const NOT_FOUND = "This student hasn't passed out of an alumni program and has no alumni record.";

/** The student must belong to a school the person can access (no school → all-schools access only). */
async function inScope(email: string, permission: UserPermission, context: EntryContext): Promise<boolean> {
  if (context.schoolCode === "none") return permission.level === 3;
  return canAccessSchool(email, context.schoolCode);
}

/** Everything the alumni form needs for one student (profile, alumni record, ids). */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await authorizeAlumni();
  if (!auth.ok) return auth.response;
  const { userId } = await params;
  if (!/^\d+$/.test(userId)) return NextResponse.json({ error: "Invalid student." }, { status: 400 });

  const context = await getEntryContext(userId);
  if (!context) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  if (!(await inScope(auth.email, auth.permission, context))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return NextResponse.json(context);
}

/** Save the student's alumni answers through the DB Service: { values, confirmed? }. */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await authorizeAlumni({ requireEdit: true });
  if (!auth.ok) return auth.response;
  const { userId } = await params;
  if (!/^\d+$/.test(userId)) return NextResponse.json({ error: "Invalid student." }, { status: 400 });

  let body: { values?: unknown; confirmed?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!body.values || typeof body.values !== "object" || Array.isArray(body.values)) {
    return NextResponse.json({ error: "Invalid values." }, { status: 400 });
  }
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.values as Record<string, unknown>)) {
    if (typeof v === "string" || typeof v === "number") values[k] = String(v).slice(0, 1000);
  }
  const confirmed = Array.isArray(body.confirmed)
    ? body.confirmed.filter((c): c is string => typeof c === "string")
    : [];

  const context = await getEntryContext(userId);
  if (!context) return NextResponse.json({ error: NOT_FOUND }, { status: 404 });
  if (!(await inScope(auth.email, auth.permission, context))) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const result = await saveAlumni(context, values, confirmed);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, fieldErrors: result.fieldErrors, warnings: result.warnings },
        { status: result.status },
      );
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[alumni/save]", error);
    return NextResponse.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
}
