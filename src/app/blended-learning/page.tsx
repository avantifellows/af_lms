import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import {
  listMentees,
  listMentorCards,
  type MenteeList,
  type MentorCard,
} from "@/lib/blended-learning-mentees";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

import { AdminTabs, type AdminTab } from "./AdminTabs";
import { BlendedLearningHeader } from "./BlendedLearningHeader";
import { FilteredMenteeList } from "./FilteredMenteeList";
import { MentorCards } from "./MentorCards";

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

function AdminLanding({ tab, cards }: { tab: AdminTab; cards: MentorCard[] }) {
  return (
    <div className="space-y-5">
      <AdminTabs current={tab} />
      {tab === "mentors" ? (
        <MentorCards cards={cards} />
      ) : (
        <Card elevation="sm" className="p-4 sm:p-6">
          <p className="text-sm text-text-secondary">Mentor Flags will appear here.</p>
        </Card>
      )}
    </div>
  );
}

// Landing page for the Blended Learning section: a Mentor's own Mentee list,
// or for a Blended Learning Admin the Mentors and Flags tabs.
export default async function BlendedLearningPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string | string[] }>;
} = {}) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const access = await getBlendedLearningAccess(email);
  if (!access || !canBlendedLearning(access, "view_list")) redirect("/dashboard");

  const today = getTodayIST();
  const mentees = access.kind === "mentor" ? await listMentees({ access, today }) : null;
  const tab: AdminTab = (await searchParams)?.tab === "flags" ? "flags" : "mentors";
  const cards =
    !mentees && tab === "mentors" && canBlendedLearning(access, "view_mentors")
      ? await listMentorCards(access, today)
      : [];

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {mentees ? <MentorMenteeList list={mentees} /> : <AdminLanding tab={tab} cards={cards} />}
      </main>
    </>
  );
}
