import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import HolisticMentorshipTutorial from "@/components/holistic-mentorship/HolisticMentorshipTutorial";
import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

export default async function HolisticMentorshipTutorialPage({
  searchParams,
}: {
  searchParams?: Promise<{ school_code?: string }>;
} = {}) {
  const session = await getServerSession(authOptions);
  const schoolCode = (await searchParams)?.school_code?.trim() || undefined;
  const audience = schoolCode ? "teacher" : "admin";
  const access = await requireHolisticMentorshipAccess(
    session,
    schoolCode ? "roster_view" : "program_read",
    schoolCode ? { schoolCode } : undefined,
  );

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const backHref = schoolCode
    ? `/school/${encodeURIComponent(schoolCode)}?tab=holistic_mentorship`
    : "/admin/holistic-mentorship";

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <PageHeader
        title={`Holistic Mentorship ${audience === "teacher" ? "Teacher" : "Admin"} guide`}
        subtitle="Follow the steps below to use Holistic Mentorship."
        backHref={backHref}
        userEmail={session?.user?.email ?? undefined}
      />
      <HolisticMentorshipTutorial audience={audience} />
    </div>
  );
}
