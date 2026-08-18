import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipAction,
} from "@/lib/holistic-mentorship";

export {
  holisticJsonProgramId,
  holisticProgramId,
  positiveInteger,
  positiveIntegerString,
  validSchoolCode,
} from "@/lib/holistic-request-validation";

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
