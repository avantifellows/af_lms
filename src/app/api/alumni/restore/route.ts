import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { journeyEnabled } from "@/lib/alumni/journey";
import { listHistory, planRestore, runRestore } from "@/lib/alumni/mass-restore";
import { RESTORE_CHUNK, type RestoreScope } from "@/lib/alumni/mass-restore-types";
import { reachesAllSchools } from "@/lib/alumni/scope";

// Version history and mass restore (mass-restore.ts): { scope, history } lists
// the scope's steps; { scope, at, dryRun, alumniIds? } restores to a moment.
//   scope { kind: "all" }            — edit access to every school (admins,
//                                       Alumni Managers with full access)
//   scope { kind: "school", code }   — edit access to that school
// history → the steps; dryRun → the plan; otherwise restores alumniIds (at most RESTORE_CHUNK).

interface Body {
  scope?: { kind?: unknown; code?: unknown };
  at?: unknown;
  dryRun?: unknown;
  alumniIds?: unknown;
  history?: unknown;
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 });

function readScope(body: Body): RestoreScope | null {
  if (body.scope?.kind === "all") return { kind: "all" };
  if (body.scope?.kind === "school" && typeof body.scope.code === "string" && body.scope.code) {
    return { kind: "school", code: body.scope.code };
  }
  return null;
}

/** A moment in the past (since 2000). */
function readMoment(at: unknown): Date | null {
  const date = typeof at === "string" ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.getTime() <= Date.now() && date.getUTCFullYear() >= 2000 ? date : null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return bad("Invalid request.");
  }
  const scope = readScope(body);
  if (!scope) return bad("Invalid scope.");

  const auth = await authorizeAlumni({ requireEdit: true, ...(scope.kind === "school" ? { schoolCode: scope.code } : {}) });
  if (!auth.ok) return auth.response;
  if (scope.kind === "all" && !reachesAllSchools(auth.permission)) {
    return NextResponse.json({ error: "Restoring all alumni needs access to every school." }, { status: 403 });
  }
  if (!journeyEnabled()) return NextResponse.json({ error: "Alumni history is not turned on." }, { status: 404 });

  if (body.history === true) {
    try {
      return NextResponse.json({ groups: await listHistory(scope) });
    } catch (error) {
      console.error("[alumni/history]", error);
      return NextResponse.json({ error: "Couldn't load the history." }, { status: 500 });
    }
  }

  const at = readMoment(body.at);
  if (!at) return bad("Pick a date and time in the past.");

  try {
    if (body.dryRun === true) return NextResponse.json(await planRestore(scope, at));
    const ids = Array.isArray(body.alumniIds) ? body.alumniIds.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)) : [];
    if (!ids.length || ids.length > RESTORE_CHUNK) return bad(`Send 1 to ${RESTORE_CHUNK} alumni at a time.`);
    const results = await runRestore(scope, at, ids, { actorEmail: auth.email, actorRole: auth.permission.role });
    return NextResponse.json({ results });
  } catch (error) {
    console.error("[alumni/restore]", error);
    return NextResponse.json({ error: "Couldn't restore. Try again." }, { status: 500 });
  }
}
