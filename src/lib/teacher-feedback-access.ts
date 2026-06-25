import { NextResponse } from "next/server";
import {
  getFeatureAccess,
  getUserPermission,
  type UserPermission,
} from "@/lib/permissions";

type AccessMode = "view" | "edit";

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
export async function requireTeacherFeedbackAccess(
  email: string,
  mode: AccessMode
): Promise<TeacherFeedbackAccessResult> {
  const permission = await getUserPermission(email);
  const access = getFeatureAccess(permission, "teacher_feedback");

  if ((mode === "view" && !access.canView) || (mode === "edit" && !access.canEdit)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  if (!permission) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, permission };
}
