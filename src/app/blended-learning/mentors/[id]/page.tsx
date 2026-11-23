import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  canBlendedLearning,
  isTeamLead,
  supervisedMentor,
  type BlendedLearningAccess,
} from "@/lib/blended-learning-access";
import { requireBlendedLearningPage, requireNumericPageId } from "@/lib/blended-learning-guard";
import { listMentees, listMentorCards } from "@/lib/blended-learning-mentees";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../../BlendedPageShell";
import { FilteredMenteeList } from "../../FilteredMenteeList";
import { myStudentsHref } from "../../SectionTabs";
import { ViewOnlyNotice } from "../../ViewOnlyNotice";

// One Mentor's Student list, the same grouped list, search and filters the
// Mentor sees, view only: nobody logs from another Mentor's list. Blended
// Learning Admins (view_mentors) open any Mentor's; a team lead their
// reportees' (their own id goes to their My Students tab, anyone else's is
// not found). Its copy is neutral, never "you", since the viewer is not the
// Mentor. Other Mentors are sent back to their own list.

// Lets a team lead in only for a Mentor they supervise; an admin for anyone.
function requireMentorInScope(access: BlendedLearningAccess, mentorUserId: number) {
  if (access.kind === "admin") return;
  if (mentorUserId === access.mentorUserId) redirect(myStudentsHref(true));
  if (supervisedMentor(access, mentorUserId) === null) notFound();
}

export default async function MentorPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireBlendedLearningPage("view_list");
  const teamLead = isTeamLead(access);
  if (!teamLead && !canBlendedLearning(access, "view_mentors")) redirect("/blended-learning");
  const mentorUserId = Number(await requireNumericPageId(params));
  requireMentorInScope(access, mentorUserId);
  const today = getTodayIST();
  // A team lead's cards are their own and their reportees' only.
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
        <span aria-hidden="true">←</span> {teamLead ? "Team" : "Mentors"}
      </Link>
      {/* Headed and laid out as the Mentor's own list. */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{mentor.name}</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {mentor.assigned} {mentor.assigned === 1 ? "student" : "students"} · {CURRENT_ACADEMIC_YEAR}
        </p>
      </div>
      {teamLead && <ViewOnlyNotice mentorName={mentor.name} students="these students" />}
      <FilteredMenteeList list={mentees} canLog={false} today={today} />
    </BlendedPageShell>
  );
}
