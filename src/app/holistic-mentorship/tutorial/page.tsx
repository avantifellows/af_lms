import HolisticMentorshipTutorial from "@/components/holistic-mentorship/HolisticMentorshipTutorial";
import PageHeader from "@/components/PageHeader";

type TutorialAudience = "admin" | "teacher";

function getSchoolCode(searchParams?: { school_code?: string }) {
  return searchParams?.school_code?.trim() || undefined;
}

function getTutorialRoute(schoolCode?: string): {
  audience: TutorialAudience;
  backHref: string;
} {
  if (schoolCode) {
    return {
      audience: "teacher",
      backHref: `/school/${encodeURIComponent(schoolCode)}?tab=holistic_mentorship`,
    };
  }

  return {
    audience: "admin",
    backHref: "/admin/holistic-mentorship",
  };
}

export default async function HolisticMentorshipTutorialPage({
  searchParams,
}: {
  searchParams?: Promise<{ school_code?: string }>;
} = {}) {
  const schoolCode = getSchoolCode(await searchParams);
  const route = getTutorialRoute(schoolCode);

  return (
    <div className="min-h-screen overflow-x-clip bg-bg">
      <PageHeader
        title={`Holistic Mentorship ${route.audience === "teacher" ? "Teacher" : "Admin"} guide`}
        subtitle="Follow the steps below to use Holistic Mentorship."
        backHref={route.backHref}
      />
      <HolisticMentorshipTutorial audience={route.audience} />
    </div>
  );
}
