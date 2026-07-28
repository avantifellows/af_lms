import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipAction,
} from "@/lib/holistic-mentorship";

export function holisticApiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function holisticRouteAccess(action: HolisticMentorshipAction) {
  const session = await getServerSession(authOptions);
  return requireHolisticMentorshipAccess(session, action);
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

export function validSchoolCode(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}
