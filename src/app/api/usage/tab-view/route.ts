import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessCentreSync,
  canAccessSchool,
  getResolvedPermission,
} from "@/lib/permissions";
import { recordUsageEvent } from "@/lib/usage-events";

const TAB_ID = /^[a-z0-9_-]{1,50}$/;

// Records a school/centre tab view (deduped to one row per person, tab, place and day).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    tab?: unknown;
    schoolCode?: unknown;
    centreId?: unknown;
  } | null;
  const tab = typeof body?.tab === "string" ? body.tab : "";
  const schoolCode = typeof body?.schoolCode === "string" ? body.schoolCode : "";
  const centreId = typeof body?.centreId === "number" ? body.centreId : null;
  if (!TAB_ID.test(tab) || !schoolCode) {
    return NextResponse.json({ error: "Invalid tab view" }, { status: 400 });
  }

  let allowed: boolean;
  if (session.isPasscodeUser) {
    allowed = session.schoolCode === schoolCode;
  } else {
    const permission = await getResolvedPermission(email);
    allowed =
      (centreId !== null && canAccessCentreSync(permission, centreId)) ||
      (await canAccessSchool(email, schoolCode));
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await recordUsageEvent({
    event: "tab_viewed",
    email,
    role: session.isPasscodeUser ? "passcode" : null,
    schoolCode,
    centreId,
    detail: tab,
  });
  return new NextResponse(null, { status: 204 });
}
