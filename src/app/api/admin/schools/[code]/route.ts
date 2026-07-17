import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isAdmin, PROGRAM_IDS_ORDERED } from "@/lib/permissions";
import { query } from "@/lib/db";

interface RouteParams {
  params: Promise<{ code: string }>;
}

// PATCH /api/admin/schools/[code] - Update school program_ids
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const session = await getServerSession(authOptions);
  const { code } = await params;

  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = await isAdmin(session.user.email);
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { program_ids } = body;

    if (!Array.isArray(program_ids)) {
      return NextResponse.json(
        { error: "program_ids must be an array" },
        { status: 400 }
      );
    }

    // Validate against the known program ids (PROGRAM_IDS in constants) rather
    // than a frozen list, so newly onboarded programs (Punjab/EMRS/RGNV/…) are
    // accepted automatically.
    const invalidIds = program_ids.filter(
      (id: number) => !PROGRAM_IDS_ORDERED.includes(id)
    );
    if (invalidIds.length > 0) {
      return NextResponse.json(
        {
          error: `Invalid program IDs: ${invalidIds.join(", ")}. Valid IDs are: ${PROGRAM_IDS_ORDERED.join(", ")}`,
        },
        { status: 400 }
      );
    }

    await query(
      `UPDATE school
       SET program_ids = $1,
           updated_at = NOW()
       WHERE code = $2`,
      [program_ids, code]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating school:", error);
    return NextResponse.json(
      { error: "Failed to update school" },
      { status: 500 }
    );
  }
}
