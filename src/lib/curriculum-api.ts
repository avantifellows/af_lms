import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import { parseCurriculumRouteScope } from "@/lib/curriculum-route-scope";
import { getFeatureAccess, getResolvedPermission } from "@/lib/permissions";

export async function requireCurriculumRequestAccess(mode: "view" | "edit") {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.isPasscodeUser) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const permission = await getResolvedPermission(session.user.email);
  const featureAccess = getFeatureAccess(permission, "curriculum");
  const allowed = mode === "view" ? featureAccess.canView : featureAccess.canEdit;
  if (!permission || !allowed) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return {
      ok: false as const,
      response: NextResponse.json(schema, { status: schema.status }),
    };
  }

  return { ok: true as const, permission, email: session.user.email };
}

export async function requireCurriculumScopeRequest(request: NextRequest) {
  const access = await requireCurriculumRequestAccess("view");
  if (!access.ok) return access;

  const scope = parseCurriculumRouteScope(
    Object.fromEntries(request.nextUrl.searchParams)
  );
  if (!scope.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: scope.error }, { status: 400 }),
    };
  }

  return { ...access, scope: scope.value };
}

export async function requireCurriculumEditBody(request: NextRequest) {
  const access = await requireCurriculumRequestAccess("edit");
  if (!access.ok) return access;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }),
    };
  }

  return { ...access, body };
}

export function parsePositiveInteger(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
