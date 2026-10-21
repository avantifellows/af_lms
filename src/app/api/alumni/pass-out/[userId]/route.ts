import { NextResponse } from "next/server";
import { authorizeAlumni, reachesSchool } from "@/lib/alumni/access";
import { getEntryContext, type EntryContext } from "@/lib/alumni/entry";
import { readSaveBody, respondWithSave } from "@/lib/alumni/save-request";
import type { UserPermission } from "@/lib/permissions";

// A pass-out who isn't an alumnus yet, addressed by user.id. Once added they
// are an alumnus and live at /api/alumni/[alumniId] (ADR 0008).

const NOT_FOUND = "This student hasn't passed out of an alumni program.";

type Loaded = { ok: true; context: EntryContext } | { ok: false; response: NextResponse };

const fail = (status: number, body: Record<string, unknown>): Loaded => ({
  ok: false,
  response: NextResponse.json(body, { status }),
});

/** The pass-out's form data, if they exist, are in the person's scope and aren't an alumnus yet. */
async function loadPassOut(userId: string, permission: UserPermission): Promise<Loaded> {
  if (!/^\d+$/.test(userId)) return fail(400, { error: "Invalid student." });
  const context = await getEntryContext(userId);
  if (!context) return fail(404, { error: NOT_FOUND });
  // No school enrollment → only all-schools access.
  const inScope = context.schoolCode === "none" ? permission.level === 3 : await reachesSchool(permission, context.schoolCode);
  if (!inScope) return fail(403, { error: "Access denied" });
  if (context.kind === "edit") return fail(409, { error: "Already an alumnus.", alumniId: context.ids.alumniId });
  return { ok: true, context };
}

/** Everything the alumni form needs to add this pass-out (profile, ids). */
export async function GET(_request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await authorizeAlumni();
  if (!auth.ok) return auth.response;
  const loaded = await loadPassOut((await params).userId, auth.permission);
  return loaded.ok ? NextResponse.json(loaded.context) : loaded.response;
}

/** Add this pass-out to the alumni table through the DB Service: { values, confirmed? }. */
export async function POST(request: Request, { params }: { params: Promise<{ userId: string }> }) {
  const auth = await authorizeAlumni({ requireEdit: true });
  if (!auth.ok) return auth.response;
  const body = await readSaveBody(request);
  if (body instanceof NextResponse) return body;
  const loaded = await loadPassOut((await params).userId, auth.permission);
  if (!loaded.ok) return loaded.response;
  return respondWithSave(loaded.context, body);
}
