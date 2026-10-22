
import { Card } from "@/components/ui";
import { canBlendedLearning, type BlendedLearningAccess } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage } from "@/lib/blended-learning-guard";
import {
  countNewFlags,
  FLAG_RECIPIENTS,
  flagsCutoffParam,
  listFlagMentors,
  listFlags,
  parseFlagsCutoff,
  readFlagsCutoff,
} from "@/lib/blended-learning-flags";
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
import { FlagsFeed, type FlagsView } from "./FlagsFeed";
import { MarkFlagsSeen } from "./MarkFlagsSeen";
import { MentorCards } from "./MentorCards";

type SearchParam = string | string[] | undefined;
type SearchParams = {
  tab?: SearchParam;
  mentor?: SearchParam;
  recipient?: SearchParam;
  cursor?: SearchParam;
  since?: SearchParam;
};

function MentorMenteeList({ list, canLog, today }: { list: MenteeList; canLog: boolean; today: string }) {
  const total = list.talkToFirst.length + list.everyoneElse.length;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">Students</h1>
        <p className="mt-1 text-sm text-text-secondary">
          {total} {total === 1 ? "student" : "students"} · {CURRENT_ACADEMIC_YEAR}
        </p>
      </div>
      {total === 0 ? (
        <Card elevation="sm" className="p-4 sm:p-6">
          <p className="text-sm text-text-secondary">
            No students are mapped to you for {CURRENT_ACADEMIC_YEAR}.
          </p>
        </Card>
      ) : (
        <FilteredMenteeList list={list} canLog={canLog} today={today} />
      )}
    </div>
  );
}

function AdminLanding({
  tab,
  cards,
  flags,
  newFlags,
}: {
  tab: AdminTab;
  cards: MentorCard[];
  flags: { view: FlagsView; newVisit: boolean } | null;
  newFlags: number;
}) {
  return (
    <div className="space-y-5">
      <AdminTabs current={tab} newFlags={newFlags} />
      {tab === "mentors" && <MentorCards cards={cards} />}
      {flags && (
        <>
          <FlagsFeed view={flags.view} />
          {/* Only on entering the tab: filter and page changes are the same visit. */}
          {flags.newVisit && <MarkFlagsSeen />}
        </>
      )}
    </div>
  );
}

function pageWidth(studentList: boolean): string {
  return studentList ? "max-w-6xl" : "max-w-5xl";
}

function single(value: SearchParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function positiveId(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

// The Flags tab's page, from the URL's filters and cursor; unknown values are
// ignored. Without a visit cutoff (`since`) this is a new visit: the cutoff is
// the viewer's "last seen" as it stands, and the visit gets recorded.
async function readFlags(
  access: BlendedLearningAccess,
  params: SearchParams
): Promise<{ view: FlagsView; newVisit: boolean } | null> {
  const mentorUserId = positiveId(single(params.mentor));
  const recipientParam = single(params.recipient);
  const recipient = FLAG_RECIPIENTS.find((value) => value === recipientParam) ?? null;
  const cursor = positiveId(single(params.cursor));
  const carried = parseFlagsCutoff(single(params.since));
  const cutoff = carried ?? (await readFlagsCutoff(access));
  const [page, mentors] = await Promise.all([
    listFlags(access, { mentorUserId, recipient, cursor }, cutoff),
    listFlagMentors(access),
  ]);
  if (!page) return null;
  return {
    view: { page, mentors, mentorUserId, recipient, cursor, since: flagsCutoffParam(cutoff) },
    newVisit: carried === null,
  };
}

// Landing page for the Blended Learning section: a Mentor's own Student list,
// or for a Blended Learning Admin the Mentors and Flags tabs.
export default async function BlendedLearningPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
} = {}) {
  const access = await requireBlendedLearningPage("view_list");

  const today = getTodayIST();
  const mentees = access.kind === "mentor" ? await listMentees({ access, today }) : null;
  const params = (await searchParams) ?? {};
  const tab: AdminTab = single(params.tab) === "flags" ? "flags" : "mentors";
  const cards =
    !mentees && tab === "mentors" && canBlendedLearning(access, "view_mentors")
      ? await listMentorCards(access, today)
      : [];
  const flags = !mentees && tab === "flags" ? await readFlags(access, params) : null;
  const newFlags = mentees ? 0 : flags ? flags.view.page.newCount : await countNewFlags(access);

  return (
    <>
      {/* The Student list is wider, to fit its columns. */}
      <BlendedLearningHeader access={access} wide={Boolean(mentees)} />
      <main className={`mx-auto px-4 py-6 sm:px-6 ${pageWidth(Boolean(mentees))}`}>
        {mentees ? (
          <MentorMenteeList list={mentees} canLog={canBlendedLearning(access, "log")} today={today} />
        ) : (
          <AdminLanding tab={tab} cards={cards} flags={flags} newFlags={newFlags} />
        )}
      </main>
    </>
  );
}
