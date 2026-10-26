import Link from "next/link";

import type { getResolvedPermission } from "@/lib/permissions";

// The LMS dashboard's chrome: its header and its tab strip. The dashboard
// renders them around the grouping views, and the Blended Learning pages
// render the same two around their content for an LMS user, with the
// Blended Learning tab selected, so that section stays inside the dashboard.

export type DashboardPermission = NonNullable<Awaited<ReturnType<typeof getResolvedPermission>>>;

// Dashboard groupings, rendered as tabs. A student belongs to exactly one
// (partitioned by attributed program), so tab counts never double-count.
export type DashboardView = "jnv-nvs" | "centres";

export type DashboardFeatures = {
  hasPMAccess: boolean;
  canViewVisitSummary: boolean;
  showCurriculumSummary: boolean;
  canViewHolisticAdmin: boolean;
};

function permissionLabel(permission: DashboardPermission, totalCount: number) {
  if (permission.role === "admin") return "Admin access";
  if (permission.level === 3) return "All schools";
  if (permission.level === 2) return `Region: ${permission.regions?.join(", ")}`;
  return `${totalCount} school(s)`;
}

export function DashboardHeader({ email, permission, totalCount, features }: {
  email: string;
  permission: DashboardPermission;
  totalCount: number;
  features: DashboardFeatures;
}) {
  return <header className="bg-bg-card border-b border-border shadow-sm">
    <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 flex flex-wrap justify-between items-center gap-y-2">
      <div className="flex items-center gap-3 sm:gap-6 min-w-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp" alt="Avanti Fellows" className="h-8 sm:h-10 shrink-0" />
        <div className="hidden sm:block border-l border-border pl-4">
          <p className="text-xs text-text-muted uppercase tracking-wide">{permissionLabel(permission, totalCount)}</p>
        </div>
        <DashboardNavigation features={features} />
      </div>
      <DashboardAccountLinks email={email} isAdmin={permission.role === "admin"} canViewHolisticAdmin={features.canViewHolisticAdmin} />
    </div>
  </header>;
}

function DashboardNavigation({ features }: { features: DashboardFeatures }) {
  if (!features.hasPMAccess && !features.canViewVisitSummary && !features.showCurriculumSummary) return null;
  return <nav className="flex gap-3 sm:gap-4">
    <Link href="/dashboard" className="text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-1">
      Home
    </Link>
    {features.canViewVisitSummary && <Link href="/school-visit-summary"
      className="text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1">
      Visit Summary
    </Link>}
    {features.showCurriculumSummary && <Link href="/curriculum-summary"
      className="text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1">
      Curriculum Summary
    </Link>}
  </nav>;
}

function DashboardAccountLinks({ email, isAdmin, canViewHolisticAdmin }: {
  email: string;
  isAdmin: boolean;
  canViewHolisticAdmin: boolean;
}) {
  return <div className="flex items-center gap-3 sm:gap-4">
    {canViewHolisticAdmin && <Link href="/admin/holistic-mentorship" className="text-sm font-bold text-accent hover:text-accent-hover">
      Holistic Mentorship
    </Link>}
    {isAdmin && <Link href="/admin" className="text-sm font-bold text-accent hover:text-accent-hover uppercase">Admin</Link>}
    <span className="text-sm text-text-muted font-mono hidden sm:inline">{email}</span>
    <Link href="/api/auth/signout" className="text-sm font-bold text-danger hover:text-danger/80">Sign out</Link>
  </div>;
}

const DASHBOARD_VIEWS = [
  { key: "centres", label: "Physical Centres" },
  { key: "jnv-nvs", label: "JNV NVS Schools" },
] as const;

type DashboardTabKey = DashboardView | "blended-learning";
type DashboardTab = { key: DashboardTabKey; label: string; href: string };

// The strip's tabs: both grouping views when the user can switch between
// them, else just their one view; then Blended Learning, a separate
// section, for those with access to it.
function dashboardTabs(view: DashboardView, showViews: boolean, showBlended: boolean): DashboardTab[] {
  const tabs: DashboardTab[] = DASHBOARD_VIEWS
    .filter((tab) => showViews || tab.key === view)
    .map((tab) => ({ key: tab.key, label: tab.label, href: `/dashboard?view=${tab.key}` }));
  if (showBlended) tabs.push({ key: "blended-learning", label: "Blended Learning", href: "/blended-learning" });
  return tabs;
}

// Grouping tabs — disjoint scopes, so counts never double-count — plus
// Blended Learning. `view` is the user's grouping view (the one kept when
// they can't switch); `current` is the selected tab, the view by default.
export function DashboardViewTabs({ view, current = view, show, showBlended }: {
  view: DashboardView;
  current?: DashboardTabKey;
  show: boolean;
  showBlended: boolean;
}) {
  const tabs = dashboardTabs(view, show, showBlended);
  // One tab left (a confined user or a PMU Manager without Blended Learning)
  // — render nothing rather than a lone tab that looks like a choice, or an
  // empty strip that leaves a stray rule on the page.
  if (tabs.length < 2) return null;
  // Wraps rather than scrolls on a phone, where three tabs don't fit a row.
  return <div className="mb-6 flex flex-wrap gap-x-6 gap-y-2 border-b border-border">
    {tabs.map((tab) => <Link
      key={tab.key}
      href={tab.href}
      aria-current={tab.key === current ? "page" : undefined}
      className={tab.key === current
        ? "text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-2 -mb-px"
        : "text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-2 -mb-px"}
    >
      {tab.label}
    </Link>)}
  </div>;
}
