import {
  assignHolisticMenteeAsAdmin,
  assignHolisticMentees,
  listHolisticAssignmentRoster,
  removeHolisticMenteeAsAdmin,
  removeHolisticMentees,
  reassignHolisticMenteeAsAdmin,
  type HolisticAssignmentRosterStudent,
  type HolisticMappingMutationResult,
} from "@/lib/holistic-mappings";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipAccessResult,
  type HolisticMentorshipSession,
} from "@/lib/holistic-mentorship";
import type {
  HolisticAdminAssignRequest,
  HolisticAdminRemoveRequest,
  HolisticAdminReassignRequest,
  HolisticMappingRosterFilters,
  HolisticTeacherMappingRequest,
  HolisticTeacherRemovalRequest,
} from "@/lib/holistic-mapping-requests";

type AccessDenied = Extract<HolisticMentorshipAccessResult, { ok: false }>;

export type HolisticMappingMutationUseCaseResult =
  | HolisticMappingMutationResult
  | AccessDenied;

export type HolisticMappingRosterUseCaseResult =
  | { ok: true; actorUserId?: number; students: HolisticAssignmentRosterStudent[] }
  | AccessDenied;

function actorParams(access: Extract<HolisticMentorshipAccessResult, { ok: true }>) {
  return {
    actorEmail: access.email.trim().toLowerCase(),
    auditActorUserId: access.permission.user_id ?? undefined,
    schoolId: access.school!.id,
  };
}

async function authorizeMutation(
  session: HolisticMentorshipSession,
  schoolCode: string,
  programId: number,
  mutate: (
    access: Extract<HolisticMentorshipAccessResult, { ok: true }>,
  ) => Promise<HolisticMappingMutationResult>,
): Promise<HolisticMappingMutationUseCaseResult> {
  const access = await requireHolisticMentorshipAccess(session, "mapping_mutation", {
    schoolCode,
    programId,
  });
  if (!access.ok) return access;
  return mutate(access);
}

async function authorizeAdminMutation(
  session: HolisticMentorshipSession,
  schoolCode: string,
  programId: number,
  mutate: (
    access: Extract<HolisticMentorshipAccessResult, { ok: true }>,
  ) => Promise<HolisticMappingMutationResult>,
): Promise<HolisticMappingMutationUseCaseResult> {
  const access = await requireHolisticMentorshipAccess(session, "admin_mapping_mutation", {
    schoolCode,
    programId,
  });
  if (!access.ok) return access;
  return mutate(access);
}

export async function getHolisticMappingRoster(
  session: HolisticMentorshipSession,
  filters: HolisticMappingRosterFilters,
): Promise<HolisticMappingRosterUseCaseResult> {
  const access = await requireHolisticMentorshipAccess(session, "roster_view", {
    schoolCode: filters.schoolCode,
    programId: filters.programId,
  });
  if (!access.ok) return access;
  return {
    ok: true,
    actorUserId: access.actorUserId,
    students: await listHolisticAssignmentRoster({
      permission: access.permission,
      actorUserId: access.actorUserId,
      schoolId: access.school!.id,
      programId: filters.programId,
      academicYear: filters.academicYear,
      search: filters.search,
      grade: filters.grade,
    }),
  };
}

export function claimHolisticMappings(
  session: HolisticMentorshipSession,
  request: HolisticTeacherMappingRequest,
): Promise<HolisticMappingMutationUseCaseResult> {
  return authorizeMutation(session, request.schoolCode, request.programId, async (access) =>
    assignHolisticMentees({
      actorUserId: access.actorUserId!,
      ...actorParams(access),
      programId: request.programId,
      academicYear: request.academicYear,
      selections: request.selections,
    }));
}

export function removeHolisticMappings(
  session: HolisticMentorshipSession,
  request: HolisticTeacherRemovalRequest,
): Promise<HolisticMappingMutationUseCaseResult> {
  return authorizeMutation(session, request.schoolCode, request.programId, async (access) =>
    removeHolisticMentees({
      actorUserId: access.actorUserId!,
      ...actorParams(access),
      programId: request.programId,
      academicYear: request.academicYear,
      mappings: request.mappings,
      confirmed: request.confirmed,
    }));
}

export function assignHolisticMappingAsAdmin(
  session: HolisticMentorshipSession,
  request: HolisticAdminAssignRequest,
): Promise<HolisticMappingMutationUseCaseResult> {
  return authorizeAdminMutation(session, request.schoolCode, request.programId, async (access) =>
    assignHolisticMenteeAsAdmin({
      ...actorParams(access),
      programId: request.programId,
      academicYear: request.academicYear,
      studentId: request.studentId,
      mentorUserId: request.mentorUserId,
      expectedMappingId: null,
      confirmed: true,
      reason: request.reason,
    }));
}

export function reassignHolisticMappingAsAdmin(
  session: HolisticMentorshipSession,
  request: HolisticAdminReassignRequest,
): Promise<HolisticMappingMutationUseCaseResult> {
  return authorizeAdminMutation(session, request.schoolCode, request.programId, async (access) =>
    reassignHolisticMenteeAsAdmin({
      ...actorParams(access),
      programId: request.programId,
      academicYear: request.academicYear,
      studentId: request.studentId,
      mentorUserId: request.mentorUserId,
      expectedMappingId: request.expectedMappingId,
      confirmed: true,
      reason: request.reason,
    }));
}

export function removeHolisticMappingAsAdmin(
  session: HolisticMentorshipSession,
  request: HolisticAdminRemoveRequest,
): Promise<HolisticMappingMutationUseCaseResult> {
  return authorizeAdminMutation(session, request.schoolCode, request.programId, async (access) =>
    removeHolisticMenteeAsAdmin({
      ...actorParams(access),
      programId: request.programId,
      academicYear: request.academicYear,
      studentId: request.studentId,
      expectedMappingId: request.expectedMappingId,
      confirmed: true,
      reason: request.reason,
    }));
}
