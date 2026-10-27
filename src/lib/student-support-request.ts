import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "./api-auth";
import { isNvsProgram } from "./constants";
import { resolvePerformanceProgram } from "./performance-program";

export type StudentSupportRequest =
  | { ok: true; program: string; grade: number; searchParams: URLSearchParams }
  | { ok: false; response: NextResponse };

const fail = (error: string, status: number): StudentSupportRequest => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
});

/**
 * Gate for the Student support reads: Performance access to the School, then
 * a program that is required and not JNV NVS. Student support is for
 * physical centres only. Unlike the chapter-test report's gate, a missing
 * program is refused rather than read as "not NVS", so an NVS-only School
 * can't get in by leaving the param out.
 */
export async function authorizeStudentSupportRead(
  request: Request,
  udise: string
): Promise<StudentSupportRequest> {
  const auth = await authorizeSchoolAccess(udise, { feature: "performance" });
  if (!auth.authorized) return { ok: false, response: auth.response };

  const { searchParams } = new URL(request.url);
  const pinned = resolvePerformanceProgram(auth.permission, searchParams.get("program") || undefined);
  if (!pinned.ok) return { ok: false, response: pinned.response };
  if (!pinned.program) return fail("program is required", 400);
  if (isNvsProgram(pinned.program)) return fail("Not available for JNV NVS", 403);

  const grade = Number(searchParams.get("grade"));
  if (!searchParams.get("grade") || !Number.isInteger(grade)) {
    return fail("grade must be an integer", 400);
  }
  return { ok: true, program: pinned.program, grade, searchParams };
}
