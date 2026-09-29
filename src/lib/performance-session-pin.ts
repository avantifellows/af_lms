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
