import { getServerSession } from "next-auth";
import { NextRequest, NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import {
  assignHolisticMappingAsAdmin,
  claimHolisticMappings,
  getHolisticMappingRoster,
  removeHolisticMappingAsAdmin,
  removeHolisticMappings,
  reassignHolisticMappingAsAdmin,
  type HolisticMappingMutationUseCaseResult,
} from "@/lib/holistic-mapping-use-cases";
import {
  isAdminAssignRequest,
  isAdminRemoveRequest,
  parseHolisticAdminAssign,
  parseHolisticAdminRemove,
  parseHolisticAdminReassign,
  parseHolisticMappingRosterFilters,
  parseHolisticTeacherClaim,
  parseHolisticTeacherRemoval,
} from "@/lib/holistic-mapping-requests";
import { holisticApiError, readJsonObject } from "../route-helpers";

function parseError(result: { ok: false; error: string }) {
  return holisticApiError(result.error);
}

function mutationResponse(result: HolisticMappingMutationUseCaseResult) {
  return result.ok
    ? NextResponse.json(result)
    : NextResponse.json(
        "ownership" in result
          ? { error: result.error, ownership: result.ownership }
          : { error: result.error },
        { status: result.status },
      );
}

export async function GET(request: NextRequest) {
  const parsed = parseHolisticMappingRosterFilters(new URL(request.url).searchParams);
  if (!parsed.ok) return parseError(parsed);

  const session = await getServerSession(authOptions);
  const result = await getHolisticMappingRoster(session, parsed.value);
  if (!result.ok) return holisticApiError(result.error, result.status);
  return NextResponse.json({ actorUserId: result.actorUserId, students: result.students });
}

export async function POST(request: NextRequest) {
  const value = await readJsonObject(request);
  if (value && isAdminAssignRequest(value)) {
    const parsed = parseHolisticAdminAssign(value);
    if (!parsed.ok) return parseError(parsed);
    const session = await getServerSession(authOptions);
    return mutationResponse(await assignHolisticMappingAsAdmin(session, parsed.value));
  }

  const parsed = parseHolisticTeacherClaim(value);
  if (!parsed.ok) return parseError(parsed);
  const session = await getServerSession(authOptions);
  return mutationResponse(await claimHolisticMappings(session, parsed.value));
}

export async function PATCH(request: NextRequest) {
  const value = await readJsonObject(request);
  if (!value) return holisticApiError("Invalid Mapping reassignment");
  const parsed = parseHolisticAdminReassign(value);
  if (!parsed.ok) return parseError(parsed);
  const session = await getServerSession(authOptions);
  return mutationResponse(await reassignHolisticMappingAsAdmin(session, parsed.value));
}

export async function DELETE(request: NextRequest) {
  const value = await readJsonObject(request);
  if (value && isAdminRemoveRequest(value)) {
    const parsed = parseHolisticAdminRemove(value);
    if (!parsed.ok) return parseError(parsed);
    const session = await getServerSession(authOptions);
    return mutationResponse(await removeHolisticMappingAsAdmin(session, parsed.value));
  }

  const parsed = parseHolisticTeacherRemoval(value);
  if (!parsed.ok) return parseError(parsed);
  const session = await getServerSession(authOptions);
  return mutationResponse(await removeHolisticMappings(session, parsed.value));
}
