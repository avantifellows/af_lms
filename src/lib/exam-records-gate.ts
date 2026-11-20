import { NextResponse } from "next/server";
import type { Session } from "next-auth";
import {
  canAccessStudent,
  getFeatureAccess,
  getUserPermission,
  isPmuOnlyStudent,
} from "@/lib/permissions";

// The gate for the Exams tab routes (server-only): session → edit rights on the
// Student (school-scoped, so a teacher reaches their own schools' Students and
// a PM their assigned schools') → not a JNV NVS Student.
//
// Edit, not just view: these routes set exam-portal passwords and, behind the
// extra `exam_passwords` check, reveal them.
//
// Exam registrations are a physical-centre feature (#434, confirmed with the
// Programs team), so a PMU (JNV NVS) Student is refused outright — the UI hides
// the tab for them, and the endpoints can't be used behind its back.

/** A positive integer path segment, exactly — `parseInt` would read "5abc" as 5. */
export function parsePositiveId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function gateExamRecords(
  session: Session | null,
  rawStudentId: string,
): Promise<{ ok: true; studentId: number } | { ok: false; response: NextResponse }> {
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const studentId = parsePositiveId(rawStudentId);
  if (studentId === null) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid student id" }, { status: 400 }),
    };
  }
  if (!(await canAccessStudent(session, studentId, { requireEdit: true }))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  if (await isPmuOnlyStudent(studentId)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Exam registrations are not collected for JNV NVS Students" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, studentId };
}

/**
 * Whether the signed-in user may reveal a stored password, and the role to log
 * against the reveal. Call only after {@link gateExamRecords} passed.
 */
export async function examPasswordViewer(
  session: Session,
): Promise<{ canReveal: boolean; email: string; role: string } | null> {
  const email = session.user?.email;
  if (!email) return null;
  const permission = await getUserPermission(email);
  if (!permission) return null;
  return {
    canReveal: getFeatureAccess(permission, "exam_passwords").canView,
    email,
    role: permission.role,
  };
}
