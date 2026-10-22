import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { listMentees, type MenteeList } from "@/lib/blended-learning-mentees";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

import { BlendedLearningHeader } from "./BlendedLearningHeader";
import { FilteredMenteeList } from "./FilteredMenteeList";

function MentorMenteeList({ list }: { list: MenteeList }) {
  const total = list.talkToFirst.length + list.everyoneElse.length;
  if (total === 0) {
    return (
      <Card elevation="sm" className="p-4 sm:p-6">
        <p className="text-sm text-text-secondary">
          No Mentees are mapped to you for {CURRENT_ACADEMIC_YEAR}.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-text-secondary">
        {total} {total === 1 ? "Mentee" : "Mentees"} · {CURRENT_ACADEMIC_YEAR}
      </p>
      <FilteredMenteeList list={list} />
    </div>
  );
}

// Landing page for the Blended Learning section: a Mentor's own Mentee list.
// The Mentors and Flags tabs (admins) fill in the admin view later.
export default async function BlendedLearningPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const access = await getBlendedLearningAccess(email);
  if (!access || !canBlendedLearning(access, "view_list")) redirect("/dashboard");

  const mentees = access.kind === "mentor" ? await listMentees({ access, today: getTodayIST() }) : null;

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {mentees ? (
          <MentorMenteeList list={mentees} />
        ) : (
          <Card elevation="sm" className="p-4 sm:p-6">
            <p className="text-sm text-text-secondary">Mentors and Mentor Flags will appear here.</p>
          </Card>
        )}
      </main>
    </>
  );
}
