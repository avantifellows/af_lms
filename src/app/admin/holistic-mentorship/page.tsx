import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import HolisticMentorshipWorkspace from "@/components/holistic-mentorship/HolisticMentorshipWorkspace";
import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import {
  HOLISTIC_MENTORSHIP_PROGRAM_IDS,
  isHolisticMentorshipProgramId,
} from "@/lib/constants";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

function availablePrograms(programIds?: number[]) {
  return programIds?.length ? programIds : [...HOLISTIC_MENTORSHIP_PROGRAM_IDS];
}

function selectedProgramId(
  requestedValue: string | undefined,
  programIds: number[],
  fallbackProgramId?: number,
) {
  const requestedProgramId = Number(requestedValue);
  if (isHolisticMentorshipProgramId(requestedProgramId) && programIds.includes(requestedProgramId)) {
    return requestedProgramId;
  }
  return fallbackProgramId ?? programIds[0];
}

function canViewPhaseSetup(role: string) {
  return role === "admin" || role === "holistic_mentorship_admin";
}

function dashboardBackHref(role: string) {
  return role === "admin" ? "/dashboard" : undefined;
}

function accessBadge(canEdit: boolean) {
  return canEdit ? "Mentorship Admin" : "Read only";
}

export default async function HolisticMentorshipAdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ program_id?: string }>;
} = {}) {
  const session = await getServerSession(authOptions);
  const access = await requireHolisticMentorshipAccess(session, "program_read");
  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }
  const availableProgramIds = availablePrograms(access.programIds);
  const initialProgramId = selectedProgramId(
    (await searchParams)?.program_id,
    availableProgramIds,
    access.programId,
  );

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <PageHeader
        title="Holistic Mentorship"
        subtitle="Program-wide mentorship setup and progress."
        backHref={dashboardBackHref(access.permission.role)}
        userEmail={session?.user?.email ?? undefined}
        actions={
          <span className="hidden rounded-full bg-info-bg px-3 py-1.5 text-xs font-extrabold text-info sm:inline-flex">
            {accessBadge(access.canEdit)}
          </span>
        }
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <HolisticMentorshipWorkspace
          mode="admin"
          initialProgramId={initialProgramId}
          availableProgramIds={availableProgramIds}
          canEdit={access.canEdit}
          canViewPhaseSetup={canViewPhaseSetup(access.permission.role)}
        />
      </main>
    </div>
  );
}
