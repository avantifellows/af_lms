import { NextResponse } from "next/server";
import type { EntryContext } from "./entry";
import { journeyEnabled } from "./journey";
import { remarkNote, type Remark } from "./remarks";
import { saveAlumni } from "./save";

// Shared by the two save routes (an existing alumnus, a pass-out being added).

export interface SaveBody {
  values: Record<string, string>;
  confirmed: string[];
  /** The record's version when the form loaded it (edits). */
  version?: string;
  /** This call's remark (saved with the history row). */
  remark: Remark;
}

/** The form's answers, the warnings the person confirmed and the version they edited, or a 400. */
export async function readSaveBody(request: Request): Promise<SaveBody | NextResponse> {
  let body: { values?: unknown; confirmed?: unknown; version?: unknown; remark?: unknown };
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
  const version = typeof body.version === "string" ? body.version : undefined;
  const r = (body.remark ?? {}) as { option?: unknown; details?: unknown };
  const remark = {
    option: typeof r.option === "string" ? r.option : "",
    details: typeof r.details === "string" ? r.details.slice(0, 1000) : "",
  };
  return { values, confirmed, version, remark };
}

/** Who is saving, for the alumni history. */
export interface Actor {
  email: string;
  role: string;
}

/** Saves through the DB Service and turns the outcome into the response. */
export async function respondWithSave(context: EntryContext, body: SaveBody, actor: Actor): Promise<NextResponse> {
  const remark = remarkNote(body.remark);
  if ("error" in remark) {
    return NextResponse.json({ error: "Some fields need fixing.", fieldErrors: { remark: remark.error } }, { status: 400 });
  }
  if (remark.note && !journeyEnabled()) {
    return NextResponse.json({ error: "Remarks can't be saved yet (alumni history is off)." }, { status: 400 });
  }
  try {
    const journey = {
      source: "call" as const,
      actorEmail: actor.email,
      actorRole: actor.role || undefined,
      ...(remark.note ? { notes: remark.note } : {}),
    };
    const result = await saveAlumni(context, body.values, body.confirmed, body.version, journey);
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
