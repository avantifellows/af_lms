import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { isHolisticMentorshipProgramId } from "@/lib/constants";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipAction,
} from "@/lib/holistic-mentorship";

export function holisticApiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function holisticRouteAccess(
  action: HolisticMentorshipAction,
  options?: Parameters<typeof requireHolisticMentorshipAccess>[2],
) {
  const session = await getServerSession(authOptions);
  return requireHolisticMentorshipAccess(session, action, options);
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export function positiveIntegerString(value: string): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function holisticProgramId(value: unknown): number | null {
  // Query-string values arrive as strings, while JSON mutation bodies should
  // be checked for a numeric type by their route before calling this helper.
  // Missing/null/empty input is never a valid Holistic Program.
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return isHolisticMentorshipProgramId(parsed) ? parsed : null;
}

/** Parse the numeric Program contract used by Holistic JSON mutation bodies. */
export function holisticJsonProgramId(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? holisticProgramId(value)
    : null;
}

export function validSchoolCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
