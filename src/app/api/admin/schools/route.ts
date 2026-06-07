import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

// GET /api/admin/schools - List all JNV schools or search
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") || "";
  const all = searchParams.get("all") === "true";
  const centreScope = searchParams.get("scope") === "centres";

  // If "all" param is set, return all JNV schools with program_ids
  if (all) {
    const schools = await query<{
      id: number;
      code: string;
      name: string;
      udise_code: string | null;
      region: string;
      state: string | null;
      district: string | null;
      program_ids: number[] | null;
    }>(
      `SELECT id, code, name, udise_code, region, state, district, program_ids
       FROM school
       WHERE af_school_category = 'JNV'
       ORDER BY name`
    );
    return NextResponse.json(schools);
  }

  // Otherwise, search for schools. Centre linking can search every School row,
  // while existing admin-school assignment callers keep the historical JNV scope.
  const schools = await query<{
    id: number;
    code: string;
    name: string;
    udise_code: string | null;
    region: string | null;
    state: string | null;
    district: string | null;
  }>(
    `SELECT id, code, name, udise_code, region, state, district
     FROM school
     WHERE ${centreScope ? "" : "af_school_category = 'JNV' AND "}
       (name ILIKE $1 OR code ILIKE $1 OR udise_code ILIKE $1)
     ORDER BY name
     LIMIT 50`,
    [`%${search}%`]
  );

  return NextResponse.json(schools);
}
