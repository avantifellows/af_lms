import { NextRequest, NextResponse } from "next/server";
import {
  parsePositiveInteger,
  requireCurriculumEditBody,
  requireCurriculumRequestAccess,
} from "@/lib/curriculum-api";
import { deleteCurriculumLog, updateCurriculumLog } from "@/lib/curriculum-logs";

// The effective allowlist is type-aware: `curriculum-logs` rejects the fields that
// do not belong to the stored log's type (and rejects any type change outright).
const ALLOWED_PATCH_FIELDS = new Set([
  "log_type",
  "log_date",
  "duration_minutes",
  "topic_ids",
  "chapter_id",
]);

function hasOnlyPatchFields(body: Record<string, unknown>): boolean {
  return Object.keys(body).every((key) => ALLOWED_PATCH_FIELDS.has(key));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params;
  const id = parsePositiveInteger(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid log id" }, { status: 400 });
  }

  const access = await requireCurriculumEditBody(request);
  if (!access.ok) return access.response;
  const { body } = access;
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

export async function DELETE(_request: NextRequest, context: {
  params: Promise<{ id: string }>;
}) {
  const { params } = context;
  const { id: rawId } = await params;
  const id = parsePositiveInteger(rawId);
  if (id === null) {
    return NextResponse.json({ error: "Invalid log id" }, { status: 400 });
  }

  const access = await requireCurriculumRequestAccess("edit");
  if (!access.ok) return access.response;

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
