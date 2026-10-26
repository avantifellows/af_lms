import { NextRequest, NextResponse } from "next/server";

import { previewPlanAssignment } from "@/lib/curriculum-plan-assignments";
import { handlePlanRoute } from "../../../plan-route";

// Preview a save by plan without writing: per ticked Centre its current plan, whether it
// moves, and uncovered tracks, plus the move and removal counts. A read, so read-only Admins
// may preview.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handlePlanRoute(
    { request },
    async ({ body }) => previewPlanAssignment({ id: Number((await params).id), body }),
    (result) => NextResponse.json({ preview: result.preview })
  );
}
