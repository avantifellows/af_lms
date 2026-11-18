import { NextResponse } from "next/server";

import { authorizeSchoolAccess } from "@/lib/api-auth";
import { loadTestAttendance } from "@/lib/test-attendance";

// Test Attendance tab read (#517). Gate before any data read: signed in (401),
// School exists (404), School access + `test_attendance` view (403), School is
// JNV (403 for every role, Admin included). Hiding the tab is not the gate.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ udise: string }> },
) {
  const { udise } = await params;
  const auth = await authorizeSchoolAccess(udise, { feature: "test_attendance" });
  if (!auth.authorized) return auth.response;
  if (auth.school.af_school_category !== "JNV") {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  try {
    const data = await loadTestAttendance(auth.school.id);
    return NextResponse.json(data);
  } catch (error) {
    // Error message only — never Student names or ids.
    console.error("Test Attendance load failed:", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Failed to load Test Attendance" }, { status: 500 });
  }
}
