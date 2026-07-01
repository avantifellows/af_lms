import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  getFeatureAccess,
  getResolvedPermission,
  type UserPermission,
} from "@/lib/permissions";

type AccessMode = "view" | "edit";

function forbidden(): AccessDenied {
  return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
}

interface AccessOk {
  ok: true;
  permission: UserPermission;
}

interface AccessDenied {
  ok: false;
  response: NextResponse;
}

export type TeacherFeedbackAccessResult = AccessOk | AccessDenied;

/**
 * Gate the Teacher Feedback routes. This is a PM-driven feature (a PM/admin sets
 * up student feedback ABOUT teachers), so it uses the dedicated `teacher_feedback`
 * feature — NOT `quiz_sessions`, under which teachers have edit access.
 */
async function requireTeacherFeedbackAccess(
  email: string,
  mode: AccessMode
): Promise<TeacherFeedbackAccessResult> {
  // Resolve seat-derived scope (centre_positions), matching the quiz-session
  // guard. A PM whose school/program access comes from centre seats (after strict
  // exclusivity clears school_codes/program_ids) would otherwise pass the page
  // render (which resolves scope) but 403 on every feedback API call.
  const permission = await getResolvedPermission(email);
  const access = getFeatureAccess(permission, "teacher_feedback");

  if ((mode === "view" && !access.canView) || (mode === "edit" && !access.canEdit)) {
    return forbidden();
  }

  if (!permission) {
    return forbidden();
  }

  return { ok: true, permission };
}

/**
 * Full route guard: resolves the session, rejects unauthenticated callers with
 * 401, then applies {@link requireTeacherFeedbackAccess}. Collapses the identical
 * preamble every Teacher Feedback route handler repeated.
 */
export async function authenticateTeacherFeedback(
  mode: AccessMode
): Promise<TeacherFeedbackAccessResult> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  return requireTeacherFeedbackAccess(email, mode);
}
