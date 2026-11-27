import { Card } from "@/components/ui";
import {
  canBlendedLearning,
  isTeamLead,
  viewableMentorUserIds,
  type BlendedLearningAccess,
} from "@/lib/blended-learning-access";
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
  listSupervisedMentors,
  type MenteeList,
  type MentorCard,
  type SupervisedMentor,
} from "@/lib/blended-learning-mentees";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "./BlendedPageShell";
import { FilteredMenteeList } from "./FilteredMenteeList";
import { FlagsFeed, type FlagsView } from "./FlagsFeed";
import { MarkFlagsSeen } from "./MarkFlagsSeen";
import { MentorCards } from "./MentorCards";
import { myStudentsHref, sectionTabTitle, SectionTabs, type SectionTab } from "./SectionTabs";

type SearchParam = string | string[] | undefined;
type LandingTab = Exclude<SectionTab, "jee_form" | "resources" | "manage">;
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
    <>
      <p className="text-sm text-text-secondary">
        <span className="font-bold text-text-primary">{total}</span> {total === 1 ? "student" : "students"} ·{" "}
        {CURRENT_ACADEMIC_YEAR}
      </p>
      {total === 0 ? (
        <Card elevation="sm" className="p-4 sm:p-6">
          <p className="text-sm text-text-secondary">
            No students are mapped to you for {CURRENT_ACADEMIC_YEAR}.
          </p>
        </Card>
      ) : (
        <FilteredMenteeList list={list} canLog={canLog} today={today} />
      )}
    </>
  );
}

type FlagsRead = { view: FlagsView; newVisit: boolean };

// The landing's data for the open tab; only its reads run.
type Landing = {
  tab: LandingTab;
  mentees: MenteeList | null;
  cards: MentorCard[];
  flags: FlagsRead | null;
  newFlags: number;
};

// A team lead's own card, which opens their own list under My Students.
function ownCard(access: BlendedLearningAccess) {
  if (!isTeamLead(access) || access.mentorUserId == null) return null;
  return { mentorUserId: access.mentorUserId, href: myStudentsHref(true) };
}

function LandingView({
  access,
  landing,
  today,
}: {
  access: BlendedLearningAccess;
  landing: Landing;
  today: string;
}) {
  const { tab, mentees, cards, flags, newFlags } = landing;
  const teamLead = isTeamLead(access);
  return (
    <div className="space-y-5">
      {/* The header's name isn't a heading, so the open tab names the page. */}
      <h1 className="sr-only">{sectionTabTitle(tab, teamLead)}</h1>
      <SectionTabs
        kind={access.kind}
        current={tab}
        newFlags={newFlags}
        canManage={canBlendedLearning(access, "manage")}
        teamLead={teamLead}
      />
      {mentees && <MentorMenteeList list={mentees} canLog={canBlendedLearning(access, "log")} today={today} />}
      {tab === "mentors" && <MentorCards cards={cards} own={ownCard(access)} />}
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
): Promise<FlagsRead | null> {
  // An admin filters by any Mentor, a supervisor by a Mentor in their scope;
  // a Mentor's feed is theirs already.
  const mentorUserId = flagsMentorParam(access, positiveId(single(params.mentor)));
  const recipientParam = single(params.recipient);
  const recipient = FLAG_RECIPIENTS.find((value) => value === recipientParam) ?? null;
  const cursor = positiveId(single(params.cursor));
  const carried = parseFlagsCutoff(single(params.since));
  const cutoff = carried ?? (await readFlagsCutoff(access));
  const [page, mentors] = await Promise.all([
    listFlags(access, { mentorUserId, recipient, cursor }, cutoff),
    flagsMentorOptions(access),
  ]);
  if (!page) return null;
  return {
    view: {
      page,
      mentors,
      // Without a Mentor filter, a Mentor's flags are all their own.
      ownStudents: access.kind === "mentor" && mentors.length === 0,
      mentorUserId,
      recipient,
      cursor,
      since: flagsCutoffParam(cutoff),
    },
    newVisit: carried === null,
  };
}

function flagsMentorParam(access: BlendedLearningAccess, mentorUserId: number | null): number | null {
  const mentors = viewableMentorUserIds(access);
  return mentors === null || (mentorUserId !== null && mentors.includes(mentorUserId)) ? mentorUserId : null;
}

// The Flags tab's Mentor filter: an admin's every flagged Mentor; a
// supervisor's own Students and each supervised Mentor's; none for a Mentor.
async function flagsMentorOptions(access: BlendedLearningAccess): Promise<SupervisedMentor[]> {
  if (access.kind === "admin") return listFlagMentors(access);
  const supervised = await listSupervisedMentors(access);
  if (supervised.length === 0 || access.mentorUserId == null) return [];
  return [{ mentorUserId: access.mentorUserId, name: "My students" }, ...supervised];
}

// Flags when asked for, else the viewer's first tab: an admin's Mentors, a
// team lead's Team (Mentor cards) unless they asked for My Students, and a
// Mentor's My Students.
function landingTab(access: BlendedLearningAccess, params: SearchParams): LandingTab {
  const asked = single(params.tab);
  if (asked === "flags") return "flags";
  if (access.kind === "admin") return "mentors";
  return isTeamLead(access) && asked !== "students" ? "mentors" : "students";
}

async function readLanding(access: BlendedLearningAccess, params: SearchParams, today: string): Promise<Landing> {
  const tab = landingTab(access, params);
  const [mentees, cards, flags] = await Promise.all([
    tab === "students" ? listMentees({ access, today }) : null,
    // An admin's every Mentor, or a team lead's own and reportees' cards.
    tab === "mentors" ? listMentorCards(access, today) : [],
    tab === "flags" ? readFlags(access, params) : null,
  ]);
  const newFlags = flags ? flags.view.page.newCount : await countNewFlags(access);
  return { tab, mentees, cards, flags, newFlags };
}

// Landing page for the Blended Learning section, under the section's tabs: a
// Mentor's own Student list (My Students); for a team lead, cards for
// themselves and the Mentors they supervise (Team; their own list moves to My
// Students, a reportee's opens view only); for a Blended Learning Admin, every
// Mentor's card; then Flags (a Mentor's own and supervised Mentors' Students'
// only). Resources is its own page.
export default async function BlendedLearningPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
} = {}) {
  const access = await requireBlendedLearningPage("view_list");
  const today = getTodayIST();
  const [landing, chrome] = await Promise.all([
    readLanding(access, (await searchParams) ?? {}, today),
    loadDashboardChrome(access),
  ]);
  return (
    <BlendedPageShell access={access} chrome={chrome}>
      <LandingView access={access} landing={landing} today={today} />
    </BlendedPageShell>
  );
}
