import type { UserPermission } from "@/lib/permissions";
import { reachesSchool } from "./access";
import { getEntryContext, type EntryContext } from "./entry";

// A pass-out who isn't an alumnus yet, addressed by user.id: shared by the
// pass-out route and bulk edit. Once added they are an alumnus (ADR 0008).

const NOT_FOUND = "This student hasn't passed out of an alumni program.";

export type PassOutLoad =
  | { ok: true; context: EntryContext }
  | { ok: false; status: 400 | 403 | 404; error: string }
  | { ok: false; status: 409; error: string; alumniId: string };

/** The pass-out's form data, if they exist, are in the person's scope and aren't an alumnus yet. */
export async function loadPassOut(userId: string, permission: UserPermission): Promise<PassOutLoad> {
  if (!/^\d+$/.test(userId)) return { ok: false, status: 400, error: "Invalid student." };
  const context = await getEntryContext(userId);
  if (!context) return { ok: false, status: 404, error: NOT_FOUND };
  // No school enrollment → only all-schools access.
  const inScope = context.schoolCode === "none" ? permission.level === 3 : await reachesSchool(permission, context.schoolCode);
  if (!inScope) return { ok: false, status: 403, error: "Access denied" };
  if (context.kind === "edit") return { ok: false, status: 409, error: "Already an alumnus.", alumniId: context.ids.alumniId };
  return { ok: true, context };
}
