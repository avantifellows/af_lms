import { NextRequest, NextResponse } from "next/server";
import { PROGRAM_IDS_ORDERED } from "@/lib/permissions";
import { query } from "@/lib/db";
import { requireAdminApiAccess } from "../../route-helpers";

interface RouteParams {
  params: Promise<{ code: string }>;
}

// PATCH /api/admin/schools/[code] - Update school program_ids
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { code } = await params;

  const access = await requireAdminApiAccess({ forWrite: true });
  if (!access.ok) {
    return access.response;
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
