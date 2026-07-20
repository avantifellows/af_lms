import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import {
  requireCentreAdmin,
  safeCentreApiError,
  listCentreBatches,
  linkBatchToCentre,
} from "@/lib/centres";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const centreId = Number.parseInt(id, 10);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    return NextResponse.json({ error: "Invalid centre id" }, { status: 400 });
  }

  const batches = await listCentreBatches(centreId);
  return NextResponse.json({ batches });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = await requireCentreAdmin(session);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { id } = await params;
  const centreId = Number.parseInt(id, 10);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    return NextResponse.json({ error: "Invalid centre id" }, { status: 400 });
  }

  let body: { batchId?: string };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const batchId = (body.batchId || "").trim();
  if (!batchId) {
    return NextResponse.json({ error: "batchId is required" }, { status: 422 });
  }

  const result = await linkBatchToCentre({ centreId, batchId });
  if (!result.ok) {
    return NextResponse.json(safeCentreApiError(result), { status: result.status });
  }

  const batches = await listCentreBatches(centreId);
  return NextResponse.json({ batches });
}
