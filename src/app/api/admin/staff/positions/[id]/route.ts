import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  deletePosition,
  requireStaffAdmin,
  safeStaffApiError,
  updatePosition,
} from "@/lib/staff-admin";

async function parsePositionId(
  params: Promise<{ id: string }>
): Promise<number | null> {
  const { id } = await params;
  const positionId = Number.parseInt(id, 10);
  return Number.isInteger(positionId) && positionId > 0 ? positionId : null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireStaffAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const positionId = await parsePositionId(params);
  if (positionId === null) {
    return NextResponse.json({ error: "Invalid position id" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await updatePosition({
    id: positionId,
    body: (body ?? {}) as Record<string, unknown>,
  });
  if (!result.ok) {
    return NextResponse.json(safeStaffApiError(result), {
      status: result.status,
    });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireStaffAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const positionId = await parsePositionId(params);
  if (positionId === null) {
    return NextResponse.json({ error: "Invalid position id" }, { status: 400 });
  }

  const result = await deletePosition({ id: positionId });
  if (!result.ok) {
    return NextResponse.json(safeStaffApiError(result), {
      status: result.status,
    });
  }

  return NextResponse.json({ ok: true });
}
