import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  getCentreConfinement,
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

/**
 * Teacher Feedback data is centre-keyed — a round belongs to a centre and
 * teachers map to a centre, not the school — but every route authorized only the
 * parent SCHOOL. A centre-confined caller could therefore reach a sibling centre
 * at the same school by changing `centre_id` in the request. Call this after the
 * school check on every route that accepts a centre id.
 *
 * Only confined callers are narrowed: a seatless manager's access is school-level
 * by design and the school check above already covers them.
 */
export function requireCentreScope(
  permission: UserPermission,
  centreId: number
): TeacherFeedbackAccessResult {
  const confinement = getCentreConfinement(permission);
  if (confinement.confined && !confinement.centreIds.includes(centreId)) {
    return forbidden();
  }
  return { ok: true, permission };
}
