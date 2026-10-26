import type {
  DashboardFeatures,
  DashboardPermission,
  DashboardView,
} from "@/components/DashboardChrome";
import type { BlendedLearningAccess } from "./blended-learning-access";
import {
  isBlendedRole,
  isPmuRole,
  PMU_GOVT_SCHOOL_USER_ROLE,
  PMU_MANAGER_ROLE,
} from "./constants";
import { requireHolisticMentorshipAccess } from "./holistic-mentorship";
import {
  getAccessibleSchoolCodes,
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
  isCentreSeated,
} from "./permissions";
import { buildVisitsActor, canViewVisitSummary } from "./visits-policy";

// What the dashboard's header and tab strip need (server-only): shared by
// the dashboard and the Blended Learning pages, which wrap their content in
// the same chrome for an LMS user.

type DashboardProgramContext = ReturnType<typeof getProgramContextSync>;

function canOpenVisitSummary(email: string, permission: DashboardPermission) {
  return getFeatureAccess(permission, "visits").canView &&
    canViewVisitSummary(buildVisitsActor(email, permission));
}

function canViewCurriculumSummary(permission: DashboardPermission, context: DashboardProgramContext) {
  const supportedRole = ["program_manager", "program_admin", "admin"].includes(permission.role);
  return supportedRole && context.hasCoEOrNodal && getFeatureAccess(permission, "curriculum").canView;
}

export function dashboardFeatures(
  email: string,
  permission: DashboardPermission,
  context: DashboardProgramContext,
  canViewHolisticAdmin: boolean,
): DashboardFeatures {
  return {
    hasPMAccess: getFeatureAccess(permission, "pm_dashboard").canView,
    canViewVisitSummary: canOpenVisitSummary(email, permission),
    showCurriculumSummary: canViewCurriculumSummary(permission, context),
    canViewHolisticAdmin,
  };
}

// Hard-pinned roles/scopes first, then an explicit valid ?view=, then the
// Program-context fallback: Physical Centres for anyone whose resolved Programs
// include a physical-centre Program, JNV NVS Schools otherwise. A missing and an
// invalid ?view= fall back alike (they differ only for the seated shortcut).
export function resolveDashboardView(
  viewParam: string | undefined,
  seated: boolean,
  permission: DashboardPermission,
  programContext: DashboardProgramContext,
): DashboardView {
  // PMU Managers are JNV NVS only (ADR 0007): no Physical Centres tab to pick.
  if (permission.role === PMU_MANAGER_ROLE) return "jnv-nvs";
  // A confined user has no NVS scope at all, so ?view=jnv-nvs is not an escape
  // hatch for them — it is the whole-school tab, carrying the school-wide
  // student search. Pin them to Centres whatever the URL says.
  if (seated) return "centres";
  if (viewParam === "centres") return "centres";
  if (viewParam === "jnv-nvs") return "jnv-nvs";
  return programContext.hasCoEOrNodal ? "centres" : "jnv-nvs";
}

// Seated and PMU users see only their one grouping view, no switcher.
export function showsDashboardViewTabs(seated: boolean, permission: DashboardPermission): boolean {
  return !seated && !isPmuRole(permission.role);
}

export type DashboardChrome = {
  email: string;
  permission: DashboardPermission;
  totalCount: number;
  features: DashboardFeatures;
  view: DashboardView;
  showViews: boolean;
};

// Roles whose dashboard is only a redirect elsewhere: no chrome to show.
const NO_DASHBOARD_ROLES: ReadonlySet<string> = new Set([
  PMU_GOVT_SCHOOL_USER_ROLE,
  "holistic_mentorship_admin",
]);

async function dashboardPermission(email: string) {
  const permission = await getResolvedPermission(email);
  if (!permission || NO_DASHBOARD_ROLES.has(permission.role)) return null;
  const context = getProgramContextSync(permission);
  return context.hasAccess ? { permission, context } : null;
}

// The header's scope figure: only a school-level user's label shows a count.
async function scopeSchoolCount(email: string, permission: DashboardPermission): Promise<number> {
  if (permission.role === "admin" || permission.level !== 1) return 0;
  const codes = await getAccessibleSchoolCodes(email, permission);
  return codes === "all" ? 0 : codes.length;
}

// The dashboard chrome for a Blended Learning page, with the viewer's default
// grouping view; null for the Blended Learning roles (no dashboard) and for
// anyone the dashboard would turn away or send elsewhere.
export async function loadDashboardChrome(access: BlendedLearningAccess): Promise<DashboardChrome | null> {
  if (isBlendedRole(access.role)) return null;
  const email = access.actorEmail;
  const resolved = await dashboardPermission(email);
  if (!resolved) return null;
  const { permission, context } = resolved;
  const [holistic, totalCount] = await Promise.all([
    requireHolisticMentorshipAccess({ user: { email } }, "program_read"),
    scopeSchoolCount(email, permission),
  ]);
  const seated = isCentreSeated(permission);
  return {
    email,
    permission,
    totalCount,
    features: dashboardFeatures(email, permission, context, holistic.ok),
    view: resolveDashboardView(undefined, seated, permission, context),
    showViews: showsDashboardViewTabs(seated, permission),
  };
}
