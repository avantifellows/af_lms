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
  const availableProgramIds = access.programIds?.length
    ? access.programIds
    : [...HOLISTIC_MENTORSHIP_PROGRAM_IDS];
  const requestedProgramId = Number((await searchParams)?.program_id);
  const initialProgramId = isHolisticMentorshipProgramId(requestedProgramId) &&
    availableProgramIds.includes(requestedProgramId)
    ? requestedProgramId
    : access.programId ?? availableProgramIds[0];
  const canViewPhaseSetup = access.permission.role === "admin" ||
    access.permission.role === "holistic_mentorship_admin";

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <PageHeader
        title="Holistic Mentorship"
        subtitle="Program-wide mentorship setup and progress."
        backHref={access.permission.role === "admin" ? "/dashboard" : undefined}
        userEmail={session?.user?.email ?? undefined}
        actions={
          <span className="hidden rounded-full bg-info-bg px-3 py-1.5 text-xs font-extrabold text-info sm:inline-flex">
            {access.canEdit ? "Mentorship Admin" : "Read only"}
          </span>
        }
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <HolisticMentorshipWorkspace
          mode="admin"
          initialProgramId={initialProgramId}
          availableProgramIds={availableProgramIds}
          canEdit={access.canEdit}
          canViewPhaseSetup={canViewPhaseSetup}
        />
      </main>
    </div>
  );
}
