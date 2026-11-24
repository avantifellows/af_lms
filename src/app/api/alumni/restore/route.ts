import { NextResponse } from "next/server";
import { authorizeAlumni } from "@/lib/alumni/access";
import { findMarker, listHistory, planRestore, runRestore } from "@/lib/alumni/mass-restore";
import { RESTORE_CHUNK, type RestoreScope } from "@/lib/alumni/mass-restore-types";
import { reachesAllSchools } from "@/lib/alumni/scope";

// Version history and mass restore (mass-restore.ts): { scope, history } lists
// the scope's steps; { scope, beforeId, dryRun, alumniIds?, versions? } restores
// to just before history row `beforeId` (a step's first row).
//   scope { kind: "all" }            — edit access to every school (admins,
//                                       Alumni Managers with full access)
//   scope { kind: "school", code }   — edit access to that school
// history → the steps; dryRun → the plan; otherwise restores alumniIds (at most RESTORE_CHUNK).

interface Body {
  scope?: { kind?: unknown; code?: unknown };
  beforeId?: unknown;
  dryRun?: unknown;
  versions?: unknown;
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

/** Each alumnus's record version from the preview ({ alumniId: version }); other entries are dropped. */
function readVersions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"));
}

/** The request body, or null when it isn't JSON. */
async function readBody(request: Request): Promise<Body | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** 401/403 for this scope, or the person (who must also reach every school for "all"). */
async function authorize(scope: RestoreScope) {
  const auth = await authorizeAlumni({ requireEdit: true, ...(scope.kind === "school" ? { schoolCode: scope.code } : {}) });
  if (!auth.ok) return auth;
  if (scope.kind === "all" && !reachesAllSchools(auth.permission)) {
    return { ok: false as const, response: NextResponse.json({ error: "Restoring all alumni needs access to every school." }, { status: 403 }) };
  }
  return auth;
}

/** The alumni ids to restore: 1 to RESTORE_CHUNK numeric ids, else null. */
function readIds(value: unknown): string[] | null {
  const ids = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && /^\d+$/.test(id)) : [];
  return ids.length && ids.length <= RESTORE_CHUNK ? ids : null;
}

/** Runs a step, turning a thrown error into a 500 with `message`. */
async function guarded(label: string, message: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    console.error(label, error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = await readBody(request);
  if (!body) return bad("Invalid request.");
  const scope = readScope(body);
  if (!scope) return bad("Invalid scope.");

  const auth = await authorize(scope);
  if (!auth.ok) return auth.response;

  if (body.history === true) {
    return guarded("[alumni/history]", "Couldn't load the history.", async () => NextResponse.json({ groups: await listHistory(scope) }));
  }
  const beforeId = typeof body.beforeId === "string" && /^\d+$/.test(body.beforeId) ? body.beforeId : null;
  const marker = beforeId ? await findMarker(beforeId) : null;
  if (!marker) return bad("Pick a step from the history.");
  if (body.dryRun === true) {
    return guarded("[alumni/restore]", "Couldn't restore. Try again.", async () => NextResponse.json(await planRestore(scope, marker)));
  }
  const ids = readIds(body.alumniIds);
  if (!ids) return bad(`Send 1 to ${RESTORE_CHUNK} alumni at a time.`);
  const actor = { actorEmail: auth.email, actorRole: auth.permission.role };
  return guarded("[alumni/restore]", "Couldn't restore. Try again.", async () =>
    NextResponse.json({ results: await runRestore(scope, marker, ids, actor, readVersions(body.versions)) }),
  );
}
