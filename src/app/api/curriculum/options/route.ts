import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import { getCurriculumOptions } from "@/lib/curriculum-options";
import { getFeatureAccess, getUserPermission } from "@/lib/permissions";

async function requireCurriculumViewAccess(session: Awaited<ReturnType<typeof getServerSession>>) {
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

  const permission = await getUserPermission(session.user.email);
  const access = getFeatureAccess(permission, "curriculum");
  if (!permission || !access.canView) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, permission };
}

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumViewAccess(session);
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const schoolCode = request.nextUrl.searchParams.get("school_code")?.trim() || "";
  if (!schoolCode) {
    return NextResponse.json({ error: "school_code is required" }, { status: 400 });
  }

  const rawProgramId = request.nextUrl.searchParams.get("program_id");
  const programIdOverride = rawProgramId ? Number.parseInt(rawProgramId, 10) : null;

  const result = await getCurriculumOptions({
    schoolCode,
    programIdOverride: Number.isFinite(programIdOverride) ? programIdOverride : null,
    permission: access.permission,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { ok: _ok, ...body } = result;
  return NextResponse.json(body);
}
