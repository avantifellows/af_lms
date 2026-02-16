import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getUserPermission, getFeatureAccess } from "@/lib/permissions";
import { query } from "@/lib/db";
import { validateGpsReading } from "@/lib/geo-validation";

// POST /api/pm/visits/[id]/end - End a visit with GPS
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const permission = await getUserPermission(session.user.email);
  if (!getFeatureAccess(permission, "visits").canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  // Validate GPS reading
  const gps = validateGpsReading(body, "end");
  if (!gps.valid) {
    return NextResponse.json({ error: gps.error }, { status: 400 });
  }

  // Fetch the visit
  const visits = await query<{
    id: number;
    pm_email: string;
    ended_at: string | null;
  }>(
    `SELECT id, pm_email, ended_at FROM lms_pm_school_visits WHERE id = $1`,
    [id]
  );

  if (visits.length === 0) {
    return NextResponse.json({ error: "Visit not found" }, { status: 404 });
  }

  const visit = visits[0];

  // Permission: PM can end own visit, admin can end any visit
  const userIsAdmin = permission?.role === "admin";
  if (visit.pm_email !== session.user.email && !userIsAdmin) {
    return NextResponse.json(
      { error: "You can only end your own visits" },
      { status: 403 }
    );
  }

  // Idempotent: if already ended, return success without changes
  if (visit.ended_at) {
    return NextResponse.json({
      message: "Visit already ended",
      ended_at: visit.ended_at,
    });
  }

  // End the visit: server-side timestamp + GPS
  await query(
    `UPDATE lms_pm_school_visits
     SET ended_at = NOW(),
         end_lat = $1,
         end_lng = $2,
         end_accuracy = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [gps.reading!.lat, gps.reading!.lng, gps.reading!.accuracy, id]
  );

  const response: { success: true; warning?: string } = { success: true };
  if (gps.warning) {
    response.warning = gps.warning;
  }

  return NextResponse.json(response);
}
