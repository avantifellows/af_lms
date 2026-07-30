import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import HolisticMentorshipTutorial from "@/components/holistic-mentorship/HolisticMentorshipTutorial";
import PageHeader from "@/components/PageHeader";
import { authOptions } from "@/lib/auth";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

type TutorialAudience = "admin" | "teacher";

function getSchoolCode(searchParams?: { school_code?: string }) {
  return searchParams?.school_code?.trim() || undefined;
}

function getTutorialRoute(schoolCode?: string): {
  audience: TutorialAudience;
  backHref: string;
  permission: "program_read" | "roster_view";
  scope?: { schoolCode: string };
} {
  if (schoolCode) {
    return {
      audience: "teacher",
      backHref: `/school/${encodeURIComponent(schoolCode)}?tab=holistic_mentorship`,
      permission: "roster_view",
      scope: { schoolCode },
    };
  }

  return {
    audience: "admin",
    backHref: "/admin/holistic-mentorship",
    permission: "program_read",
  };
}

function getUserEmail(session: Session | null) {
  return session?.user?.email ?? undefined;
}

export default async function HolisticMentorshipTutorialPage({
  searchParams,
}: {
  searchParams?: Promise<{ school_code?: string }>;
} = {}) {
  const session = await getServerSession(authOptions);
  const schoolCode = getSchoolCode(await searchParams);
  const route = getTutorialRoute(schoolCode);
  const access = await requireHolisticMentorshipAccess(
    session,
    route.permission,
    route.scope,
  );

  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <PageHeader
        title={`Holistic Mentorship ${route.audience === "teacher" ? "Teacher" : "Admin"} guide`}
        subtitle="Follow the steps below to use Holistic Mentorship."
        backHref={route.backHref}
        userEmail={getUserEmail(session)}
      />
      <HolisticMentorshipTutorial audience={route.audience} />
    </div>
  );
}
