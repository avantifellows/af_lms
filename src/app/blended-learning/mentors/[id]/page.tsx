import Link from "next/link";
import { notFound } from "next/navigation";

import { canBlendedLearning } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage, requireNumericPageId } from "@/lib/blended-learning-guard";
import { listMentees, listMentorCards } from "@/lib/blended-learning-mentees";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

import { BlendedLearningHeader } from "../../BlendedLearningHeader";
import { FilteredMenteeList } from "../../FilteredMenteeList";

// One Mentor's Mentee list for Blended Learning Admins (view_mentors), the
// same grouped list, search and filters the Mentor sees. From here an admin
// opens a Mentee and logs on the Mentor's behalf. Mentors are sent back to
// their own list.
export default async function MentorPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireBlendedLearningPage("view_mentors", "/blended-learning");
  const mentorUserId = Number(await requireNumericPageId(params));
  const today = getTodayIST();
  const mentor = (await listMentorCards(access, today)).find((card) => card.mentorUserId === mentorUserId);
  if (!mentor) notFound();
  const mentees = await listMentees({ access, mentorUserId, today });

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href="/blended-learning"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden="true">←</span> Mentors
        </Link>
        <div>
          <h2 className="text-xl font-bold text-text-primary">{mentor.name}</h2>
          <p className="text-sm text-text-secondary">
            {mentor.assigned} {mentor.assigned === 1 ? "Mentee" : "Mentees"} · {CURRENT_ACADEMIC_YEAR}
          </p>
        </div>
        <FilteredMenteeList list={mentees} canLog={canBlendedLearning(access, "log")} />
      </main>
    </>
  );
}
