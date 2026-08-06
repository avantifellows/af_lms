import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { checkCurriculumSchema } from "@/lib/curriculum-schema";
import { deleteCurriculumLog, updateCurriculumLog } from "@/lib/curriculum-logs";
import { getFeatureAccess, getResolvedPermission } from "@/lib/permissions";

type CurriculumSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

// The effective allowlist is type-aware: `curriculum-logs` rejects the fields that
// do not belong to the stored log's type (and rejects any type change outright).
const ALLOWED_PATCH_FIELDS = new Set([
  "log_type",
  "log_date",
  "duration_minutes",
  "topic_ids",
  "chapter_id",
]);

async function requireCurriculumEditAccess(session: CurriculumSession) {
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
  const access = getFeatureAccess(permission, "curriculum");
  if (!permission || !access.canEdit) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true as const, permission, email: session.user.email };
}

function hasOnlyPatchFields(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => ALLOWED_PATCH_FIELDS.has(key));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid log id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await requireCurriculumEditAccess(session);
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!hasOnlyPatchFields(body)) {
    return NextResponse.json(
      {
        error:
          "Only log_date, duration_minutes, topic_ids, and chapter_id can be updated",
      },
      { status: 422 }
    );
  }

  const result = await updateCurriculumLog({
    id,
    patch: body,
    permission: access.permission,
    actorEmail: access.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ log: result.log });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = Number.parseInt(rawId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid log id" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const access = await requireCurriculumEditAccess(session);
  if (!access.ok) return access.response;

  const schema = await checkCurriculumSchema();
  if (!schema.ok) {
    return NextResponse.json(schema, { status: schema.status });
  }

  const result = await deleteCurriculumLog({
    id,
    permission: access.permission,
    actorEmail: access.email,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ deleted: true });
}
