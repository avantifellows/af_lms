import { NextResponse } from "next/server";
import type { EntryContext } from "./entry";
import { saveAlumni } from "./save";

// Shared by the two save routes (an existing alumnus, a pass-out being added).

/** The form's answers and the warnings the person confirmed, or a 400. */
export async function readSaveBody(
  request: Request,
): Promise<{ values: Record<string, string>; confirmed: string[] } | NextResponse> {
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
  return { values, confirmed };
}

/** Saves through the DB Service and turns the outcome into the response. */
export async function respondWithSave(
  context: EntryContext,
  values: Record<string, string>,
  confirmed: string[],
): Promise<NextResponse> {
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
