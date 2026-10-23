import Link from "next/link";
import { notFound } from "next/navigation";

import { canBlendedLearning } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage, requireNumericPageId } from "@/lib/blended-learning-guard";
import { listMentees, listMentorCards } from "@/lib/blended-learning-mentees";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../../BlendedPageShell";
import { FilteredMenteeList } from "../../FilteredMenteeList";
import { MentorResources } from "../../MentorResources";

// One Mentor's Student list for Blended Learning Admins (view_mentors), the
// same grouped list, search and filters the Mentor sees. Its copy is neutral,
// never "you", since the viewer is not the Mentor. From here an admin
// opens a Mentee's detail page, view only: admins never log. Mentors are sent
// back to their own list.
export default async function MentorPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireBlendedLearningPage("view_mentors", "/blended-learning");
  const mentorUserId = Number(await requireNumericPageId(params));
  const today = getTodayIST();
  const mentor = (await listMentorCards(access, today)).find((card) => card.mentorUserId === mentorUserId);
  if (!mentor) notFound();
  const [mentees, chrome] = await Promise.all([
    listMentees({ access, mentorUserId, today }),
    loadDashboardChrome(access),
  ]);

  return (
    <BlendedPageShell access={access} chrome={chrome} className="space-y-5">
      <Link
        href="/blended-learning"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-bold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span aria-hidden="true">←</span> Mentors
      </Link>
      {/* Headed and laid out as the Mentor's own list. */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{mentor.name}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {mentor.assigned} {mentor.assigned === 1 ? "student" : "students"} · {CURRENT_ACADEMIC_YEAR}
        </p>
      </div>
      <FilteredMenteeList list={mentees} canLog={canBlendedLearning(access, "log")} today={today} />
      <MentorResources />
    </BlendedPageShell>
  );
}
