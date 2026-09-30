import { NextResponse } from "next/server";
import { authorizeSchoolAccess } from "@/lib/api-auth";
import { resolvePerformanceProgram } from "@/lib/performance-program";
import { refusePmuSessionOr502 } from "@/lib/performance-session-pin";

type AuthorizedSchool = Extract<
  Awaited<ReturnType<typeof authorizeSchoolAccess>>,
  { authorized: true }
>;

export type SessionReadRequest =
  | {
      ok: true;
      auth: AuthorizedSchool;
      program: string | undefined;
      grade: number;
      sessionId: string;
      stream: string | undefined;
    }
  | { ok: false; response: NextResponse };

// The shared gate for Performance routes that read one caller-named test
// session's results (test-deep-dive, test-questions, student-questions), in
// order: School access, the PMU program pin, grade/sessionId validation, then
// the PMU session pin (403 for a session that is not a JNV NVS test at this
// School, 502 when that lookup fails). Other roles skip the session lookup.
export async function authorizeSessionRead(
  request: Request,
  udise: string,
): Promise<SessionReadRequest> {
  const auth = await authorizeSchoolAccess(udise);
  if (!auth.authorized) return { ok: false, response: auth.response };

  const url = new URL(request.url);
  const pinned = resolvePerformanceProgram(
    auth.permission,
    url.searchParams.get("program") || undefined,
  );
  if (!pinned.ok) return { ok: false, response: pinned.response };
  const gradeParam = url.searchParams.get("grade");
  const sessionId = url.searchParams.get("sessionId");

  if (!gradeParam || !sessionId) {
    return refuse("grade and sessionId are required");
  }
  const grade = Number(gradeParam);
  if (!Number.isInteger(grade)) return refuse("grade must be an integer");

  const outside = await refusePmuSessionOr502(auth.permission, udise, sessionId);
  if (outside) return { ok: false, response: outside };

  return {
    ok: true,
    auth,
    program: pinned.program,
    grade,
    sessionId,
    stream: url.searchParams.get("stream")?.toLowerCase() || undefined,
  };
}

function refuse(error: string): SessionReadRequest {
  return { ok: false, response: NextResponse.json({ error }, { status: 400 }) };
}
