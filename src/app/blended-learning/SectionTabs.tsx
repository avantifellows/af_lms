import Link from "next/link";

import type { BlendedLearningAccess } from "@/lib/blended-learning-access";

// The section's top-level tabs, as links so each tab has a URL: a Mentor's
// My Students, JEE Form, Flags and Resources; a team lead's (a Mentor who
// supervises other Mentors) Team (their own and their reportees' cards), My
// Students, JEE Form (their own Mentees only), Flags and Resources; a Blended
// Learning Admin's Mentors, JEE Form, Flags and Resources, then Manage for an
// admin who may manage (not read-only). One bar for all: the first tabs, and
// what Flags holds (a Mentor's own Students' flags, a team lead's reportees'
// too), differ. On a narrow phone the tabs wrap rather than hide. Flags
// carries the "N new" badge: flags raised since the viewer's last visit.
export type SectionTab = "students" | "mentors" | "jee_form" | "flags" | "resources" | "manage";

// Where a Mentor's own list lives: the landing, or a team lead's My Students
// tab (their landing is the Team cards).
const MY_STUDENTS_HREF = "/blended-learning";
const TEAM_LEAD_MY_STUDENTS_HREF = "/blended-learning?tab=students";

export function myStudentsHref(teamLead: boolean): string {
  return teamLead ? TEAM_LEAD_MY_STUDENTS_HREF : MY_STUDENTS_HREF;
}

type TabLink = { tab: SectionTab; label: string; href: string };

const FLAGS: TabLink = { tab: "flags", label: "Flags", href: "/blended-learning?tab=flags" };
const RESOURCES: TabLink = { tab: "resources", label: "Resources", href: "/blended-learning/resources" };
const JEE_FORM: TabLink = { tab: "jee_form", label: "JEE Form", href: "/blended-learning/jee-form" };
const MENTOR_TABS: TabLink[] = [
  { tab: "students", label: "My Students", href: MY_STUDENTS_HREF },
  JEE_FORM,
  FLAGS,
  RESOURCES,
];
const TEAM_LEAD_TABS: TabLink[] = [
  { tab: "mentors", label: "Team", href: "/blended-learning" },
  { tab: "students", label: "My Students", href: TEAM_LEAD_MY_STUDENTS_HREF },
  JEE_FORM,
  FLAGS,
  RESOURCES,
];
const ADMIN_TABS: TabLink[] = [{ tab: "mentors", label: "Mentors", href: "/blended-learning" }, JEE_FORM, FLAGS, RESOURCES];
const MANAGE: TabLink = { tab: "manage", label: "Manage", href: "/blended-learning/manage" };

// The page's name for the open tab (its H1, visually hidden: the bar names it).
const SECTION_TAB_TITLE: Record<SectionTab, string> = {
  students: "My Students",
  mentors: "Mentors",
  jee_form: "JEE Form",
  flags: "Flags",
  resources: "Resources",
  manage: "Manage",
};

export function sectionTabTitle(tab: SectionTab, teamLead = false): string {
  return teamLead && tab === "mentors" ? "Team" : SECTION_TAB_TITLE[tab];
}

function tabsFor(kind: BlendedLearningAccess["kind"], teamLead: boolean, canManage: boolean): TabLink[] {
  if (kind === "admin") return [...ADMIN_TABS, ...(canManage ? [MANAGE] : [])];
  return teamLead ? TEAM_LEAD_TABS : MENTOR_TABS;
}

export function SectionTabs({
  kind,
  current,
  newFlags = 0,
  canManage = false,
  teamLead = false,
}: {
  kind: BlendedLearningAccess["kind"];
  current: SectionTab;
  newFlags?: number;
  // canBlendedLearning(access, "manage"): adds the Manage tab.
  canManage?: boolean;
  // isTeamLead(access): the Team tab first, then My Students.
  teamLead?: boolean;
}) {
  const tabs = tabsFor(kind, teamLead, canManage);
  return (
    <nav aria-label={kind === "admin" ? "Admin views" : "Mentor views"} className="flex flex-wrap gap-x-1 border-b border-border">
      {tabs.map(({ tab, label, href }) => {
        const active = tab === current;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px flex min-h-11 min-w-11 shrink-0 items-center whitespace-nowrap justify-center border-b-2 px-3 text-sm font-bold uppercase tracking-wide sm:px-4 ${
              active
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >
            {label}
            {tab === "flags" && newFlags > 0 && (
              <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-xs font-bold normal-case tracking-normal text-danger">
                {newFlags} new
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
