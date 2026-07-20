import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireQuizSessionAccess } from "@/lib/quiz-session-access";
import { batchesForCentre, userCanAccessCentre, type CentreBatchRow } from "@/lib/centre-batch";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const centreIdParam = searchParams.get("centreId");

  if (!centreIdParam) {
    return NextResponse.json({ error: "centreId is required" }, { status: 400 });
  }

  const centreId = Number(centreIdParam);
  if (!Number.isInteger(centreId) || centreId <= 0) {
    return NextResponse.json({ error: "Invalid centreId" }, { status: 400 });
  }

  const access = await requireQuizSessionAccess(session.user.email, "view");
  if (!access.ok) {
    return access.response;
  }

  // Pure teacher→centre access: the user must hold a seat at this centre
  // (or be an admin). School permission is not consulted.
  if (!userCanAccessCentre(access.permission, centreId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Batches linked to the centre via centre_batch. The link IS the scope, so
  // there is no program-id filter here — a centre belongs to one program and
  // its linked batches are already the right set.
  let batches: CentreBatchRow[] = await batchesForCentre(centreId);

  // Pull in any parent batches not already present so hierarchies render whole.
  const parentIds = Array.from(
    new Set(batches.map((b) => b.parent_id).filter((id): id is number => id !== null))
  );
  const knownIds = new Set(batches.map((b) => b.id));
  const missingParentIds = parentIds.filter((id) => !knownIds.has(id));

  if (missingParentIds.length > 0) {
    const parentRows = await query<CentreBatchRow>(
      `
      SELECT b.id, b.name, b.batch_id, b.parent_id, b.program_id
      FROM batch b
      WHERE b.id = ANY($1::int[])
      ORDER BY b.name
      `,
      [missingParentIds]
    );
    batches = batches.concat(parentRows);
  }

  return NextResponse.json({ batches });
}
