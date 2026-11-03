import Link from "next/link";

import type { BlendedLearningAccess } from "@/lib/blended-learning-access";

// The section's top-level tabs, as links so each tab has a URL: a Mentor's
// My Students, Flags and Resources; a Blended Learning Admin's Mentors, Flags
// and Resources, then Manage for an admin who may manage (not read-only).
// One bar for both: only the first tab, and what Flags holds (a Mentor's own
// Students' flags), differ. On a narrow phone the tabs wrap rather than hide. Flags carries the "N new" badge: flags raised
// since the viewer's last visit.
export type SectionTab = "students" | "mentors" | "flags" | "resources" | "manage";

type TabLink = { tab: SectionTab; label: string; href: string };

const FLAGS: TabLink = { tab: "flags", label: "Flags", href: "/blended-learning?tab=flags" };
const RESOURCES: TabLink = { tab: "resources", label: "Resources", href: "/blended-learning/resources" };
const MENTOR_TABS: TabLink[] = [{ tab: "students", label: "My Students", href: "/blended-learning" }, FLAGS, RESOURCES];
const ADMIN_TABS: TabLink[] = [{ tab: "mentors", label: "Mentors", href: "/blended-learning" }, FLAGS, RESOURCES];
const MANAGE: TabLink = { tab: "manage", label: "Manage", href: "/blended-learning/manage" };

// The page's name for the open tab (its H1, visually hidden: the bar names it).
export const SECTION_TAB_TITLE: Record<SectionTab, string> = {
  students: "My Students",
  mentors: "Mentors",
  flags: "Flags",
  resources: "Resources",
  manage: "Manage",
};

export function SectionTabs({
  kind,
  current,
  newFlags = 0,
  canManage = false,
}: {
  kind: BlendedLearningAccess["kind"];
  current: SectionTab;
  newFlags?: number;
  // canBlendedLearning(access, "manage"): adds the Manage tab.
  canManage?: boolean;
}) {
  const tabs = kind === "admin" ? [...ADMIN_TABS, ...(canManage ? [MANAGE] : [])] : MENTOR_TABS;
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
