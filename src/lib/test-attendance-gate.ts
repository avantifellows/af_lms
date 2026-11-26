import { NextResponse } from "next/server";

import { authorizeSchoolAccess } from "@/lib/api-auth";

/**
 * The one gate for every Test Attendance route (#517), run before any data
 * read, in this order: signed in (401), School exists (404), School access +
 * `test_attendance` view (403), School is JNV (403 for every role, Admin
 * included). Used by the read route; Download builds its file in the browser from that response, so it needs no gate of its own.
 * Hiding the tab is not the gate.
 */
export async function authorizeTestAttendance(udise: string) {
  const auth = await authorizeSchoolAccess(udise, { feature: "test_attendance" });
  if (!auth.authorized) return auth;
  if (auth.school.af_school_category !== "JNV") {
    return {
      authorized: false as const,
      response: NextResponse.json({ error: "Access denied" }, { status: 403 }),
    };
  }
  return auth;
}
