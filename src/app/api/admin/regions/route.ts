import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/admin/regions - List all JNV regions
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const regions = await query<{ region: string; school_count: string }>(
    `SELECT region, COUNT(*) as school_count
     FROM school
     WHERE af_school_category = 'JNV' AND region IS NOT NULL AND region != ''
     GROUP BY region
     ORDER BY region`
  );

  return NextResponse.json(regions);
}
