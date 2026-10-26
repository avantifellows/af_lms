import { NextResponse } from "next/server";
import { isSessionOnlyForProgram } from "@/lib/bigquery";
import {
  PMU_PROGRAM_ID,
  PROGRAM_ID_TO_LABEL,
  isPmuRole,
} from "@/lib/constants";

// The session-level half of the PMU Performance pin (ADR 0007).
// `resolvePerformanceProgram` only checks the `program` a caller names; routes
// keyed by a test session (or a combined-report job, which carries its
// session) must also check that the session itself is a JNV NVS test at this
// School, or a PMU caller at a mixed JNV School could name a CoE session and
// reach its reports. Returns the refusal to send, or null when the caller may
// proceed. Other roles always get null without a warehouse lookup.
//
// `status` lets job-keyed routes keep their "not found in scope" 404; routes
// keyed by a caller-supplied session answer 403 like the program pin.
export async function refuseOutsidePmuSession(
  permission: { role: string } | null | undefined,
  udise: string,
  sessionId: string,
  status: 403 | 404 = 403,
): Promise<NextResponse | null> {
  if (!permission || !isPmuRole(permission.role)) return null;
  const allowed = await isSessionOnlyForProgram(
    udise,
    sessionId,
    PROGRAM_ID_TO_LABEL[PMU_PROGRAM_ID],
  );
  if (allowed) return null;
  return NextResponse.json(
    { error: status === 404 ? "Not found" : "Access denied" },
    { status },
  );
}

// For routes that read a caller-named session's scores (deep dive, question
// level): the same 403 refusal, but a failed warehouse lookup answers 502
// (fails closed) here instead of reaching the route's own catch, whose 500
// means "the data read failed". Other roles still get null with no lookup.
export async function refusePmuSessionOr502(
  permission: { role: string } | null | undefined,
  udise: string,
  sessionId: string,
): Promise<NextResponse | null> {
  try {
    return await refuseOutsidePmuSession(permission, udise, sessionId);
  } catch (error) {
    // Message only — never the session's rows.
    console.error(
      "PMU session pin lookup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json(
      { error: "Failed to check the test's program" },
      { status: 502 },
    );
  }
}
