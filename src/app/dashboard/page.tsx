import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getAccessibleSchoolCodes,
  getResolvedPermission,
  getProgramContextSync,
  getFeatureAccess,
  isCentreSeated,
} from "@/lib/permissions";
import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";
import Link from "next/link";
import SchoolSearch from "@/components/SchoolSearch";
import StudentSearch from "@/components/StudentSearch";
import SchoolCard, { School, GradeCount } from "@/components/SchoolCard";
import CentreCard from "@/components/CentreCard";
import {
  getAccessibleCentresWithCounts,
  getNvsGradeCounts,
  resolveCentreAccess,
  type Centre,
} from "@/lib/dashboard-groupings";
import Pagination from "@/components/Pagination";
import { statusBadgeClass } from "@/lib/visit-actions";
import { Card } from "@/components/ui";


const SCHOOLS_PER_PAGE = 20;
const RECENT_VISIT_COLUMNS = [
  { label: "School", className: "px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider" },
  { label: "Date", className: "px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider" },
  { label: "Status", className: "px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider" },
  { label: "Action", className: "px-6 py-3 text-right text-xs font-bold text-text-muted uppercase tracking-wider" },
];

interface SchoolsResult {
  schools: School[];
  totalCount: number;
}

interface Visit {
  id: number;
  school_code: string;
  school_name?: string;
  visit_date: string;
  status: string;
  inserted_at: string;
}

type SchoolQueryPlan = {
  listSql: string;
  listParams: unknown[];
  countSql: string;
  countParams?: unknown[];
};

function schoolQueryPlan(codes: string[] | "all", searchPattern: string | null, offset: number): SchoolQueryPlan {
  if (codes === "all") {
    if (searchPattern) {
      const searchSql = "AND (s.name ILIKE $1 OR s.code ILIKE $1 OR s.district ILIKE $1)";
      return {
        listSql: `${searchSql} ORDER BY s.name LIMIT $2 OFFSET $3`,
        listParams: [searchPattern, SCHOOLS_PER_PAGE, offset],
        countSql: searchSql,
        countParams: [searchPattern],
      };
    }
    return {
      listSql: "ORDER BY s.name LIMIT $1 OFFSET $2",
      listParams: [SCHOOLS_PER_PAGE, offset],
      countSql: "",
    };
  }
  if (searchPattern) {
    const searchSql = "AND s.code = ANY($1) AND (s.name ILIKE $2 OR s.code ILIKE $2 OR s.district ILIKE $2)";
    return {
      listSql: `${searchSql} ORDER BY s.name LIMIT $3 OFFSET $4`,
      listParams: [codes, searchPattern, SCHOOLS_PER_PAGE, offset],
      countSql: searchSql,
      countParams: [codes, searchPattern],
    };
  }
  const codeSql = "AND s.code = ANY($1)";
  return {
    listSql: `${codeSql} ORDER BY s.name LIMIT $2 OFFSET $3`,
    listParams: [codes, SCHOOLS_PER_PAGE, offset],
    countSql: codeSql,
    countParams: [codes],
  };
}

async function getSchools(
  codes: string[] | "all",
  search?: string,
  page: number = 1
): Promise<SchoolsResult> {
  const searchPattern = search ? `%${search}%` : null;
  const offset = (page - 1) * SCHOOLS_PER_PAGE;

  // Narrow to the visible set FIRST, in a MATERIALIZED CTE, then apply the
  // dedup + search inside it.
  //
  // Previously both predicates sat in a flat WHERE over all ~10.8k school rows,
  // so every dashboard load — search or not — evaluated the dup-placeholder
  // correlated self-join against the whole table (~220 nested scans of 10.8k
  // rows). Only ~880 schools are ever visible and 688 survive dedup, so the
  // work was almost entirely wasted. MATERIALIZED is load-bearing: without it
  // PG inlines the CTE and we are back to the flat plan.
  //
  // School visibility scope: the historical JNV set PLUS any school linked to an
  // active centre. Centre-linked covers the non-JNV centre rollout (Punjab CoE
  // meritorious / EMRS / Karnataka) without disturbing JNV. Centre-driven, not a
  // category allowlist — new centre types light up by linking a centre.
  //
  // Dedup stopgap: a stale bulk import left a second JNV row (null udise_code,
  // 0 students) for ~190 schools, so they double-listed. Exclude a row only when
  // its udise is null AND a same-named JNV row carries a real udise — that pins
  // it as the dup. Schools that legitimately lack a udise (a few Telangana/WB
  // rows with real students) have no udise-bearing namesake and are kept. The
  // data team will purge the placeholder rows; remove this filter once they have.
  //
  // The namesake lookup reads `visible` rather than `school`: it only ever
  // matches JNV rows, and every JNV row is in `visible` by the first scope
  // branch, so the result is identical (verified against prod — both forms
  // return the same 688 ids, zero difference either way).
  const visibleSchoolsCte = `
    WITH visible AS MATERIALIZED (
      SELECT s.id, s.code, s.name, s.district, s.state, s.region,
             s.udise_code, s.af_school_category
      FROM school s
      WHERE s.af_school_category = 'JNV'
         OR EXISTS (SELECT 1 FROM centres c WHERE c.school_id = s.id AND c.is_active)
    )`;

  // Aliased `visible` AS s so the shared schoolQueryPlan predicates (s.name,
  // s.code, s.district) keep working unchanged.
  const dedupFilter = `
    WHERE NOT (
      s.udise_code IS NULL
      AND EXISTS (
        SELECT 1 FROM visible v2
        WHERE v2.af_school_category = 'JNV'
          AND v2.name = s.name
          AND v2.udise_code IS NOT NULL
      )
    )`;

  const baseQuery = `
    ${visibleSchoolsCte}
    SELECT s.id, s.code, s.name, s.district, s.state, s.region
    FROM visible s
    ${dedupFilter}`;

  const countBaseQuery = `
    ${visibleSchoolsCte}
    SELECT COUNT(DISTINCT s.id) as total
    FROM visible s
    ${dedupFilter}`;

  if (codes.length === 0) return { schools: [], totalCount: 0 };
  const plan = schoolQueryPlan(codes, searchPattern, offset);
  const [schools, countResult] = await Promise.all([
    query<School>(`${baseQuery} ${plan.listSql}`, plan.listParams),
    query<{ total: string }>(`${countBaseQuery} ${plan.countSql}`, plan.countParams),
  ]);
  return { schools, totalCount: parseInt(countResult[0]?.total || "0", 10) };
}

async function getRecentVisits(pmEmail: string, limit: number = 5): Promise<Visit[]> {
  return query<Visit>(
    `SELECT v.id, v.school_code, v.visit_date, v.status, v.inserted_at,
            s.name as school_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.pm_email = $1
       AND v.deleted_at IS NULL
     ORDER BY v.visit_date DESC, v.inserted_at DESC
     LIMIT $2`,
    [pmEmail, limit]
  );
}

// Dashboard groupings, rendered as tabs. A student belongs to exactly one
// (partitioned by attributed program), so tab counts never double-count.
type DashboardView = "jnv-nvs" | "centres";

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string; view?: string }>;
}

type DashboardPermission = NonNullable<Awaited<ReturnType<typeof getResolvedPermission>>>;
type DashboardProgramContext = ReturnType<typeof getProgramContextSync>;
type DashboardSchool = School & { grade_counts: GradeCount[]; student_count: number };
type DashboardFeatures = {
  hasPMAccess: boolean;
  canViewVisitSummary: boolean;
  showCurriculumSummary: boolean;
  canViewHolisticAdmin: boolean;
};
type DashboardData = {
  schools: DashboardSchool[];
  centres: Centre[];
  totalCount: number;
  totalPages: number;
  recentVisits: Visit[];
};

function canViewVisitSummary(permission: DashboardPermission) {
  const supportedRole = permission.role === "admin" || permission.role === "program_admin";
  return supportedRole && getFeatureAccess(permission, "visits").canView;
}

function canViewCurriculumSummary(permission: DashboardPermission, context: DashboardProgramContext) {
  const supportedRole = ["program_manager", "program_admin", "admin"].includes(permission.role);
  return supportedRole && context.hasCoEOrNodal && getFeatureAccess(permission, "curriculum").canView;
}

function dashboardFeatures(
  permission: DashboardPermission,
  context: DashboardProgramContext,
  canViewHolisticAdmin: boolean,
): DashboardFeatures {
  return {
    hasPMAccess: getFeatureAccess(permission, "pm_dashboard").canView,
    canViewVisitSummary: canViewVisitSummary(permission),
    showCurriculumSummary: canViewCurriculumSummary(permission, context),
    canViewHolisticAdmin,
  };
}

function NoDashboardAccess({ email, message }: { email: string; message: string }) {
  return <div className="min-h-screen bg-gray-50">
    <header className="bg-white shadow">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">{email}</span>
          <a href="/api/auth/signout" className="text-sm font-bold text-red-600 hover:text-red-500">Sign out</a>
        </div>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="rounded-lg bg-yellow-50 p-4 border border-yellow-200">
        <p className="text-yellow-800">{message}</p>
      </div>
    </main>
  </div>;
}

async function dashboardSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/");
  if (session.isPasscodeUser && session.schoolCode) redirect(`/school/${session.schoolCode}`);
  return session.user.email;
}

async function dashboardRequest(searchParams: PageProps["searchParams"]) {
  const { q: searchQuery, page: pageParam, view: viewParam } = await searchParams;
  return {
    searchQuery,
    viewParam,
    currentPage: Math.max(1, parseInt(pageParam || "1", 10)),
  };
}

// Centre-seated staff are centre-scoped: their home is their centre, not the
// whole-school roster. Default them to the Centres tab so the single-school
// shortcut never bounces them to the school page — an explicit ?view= wins.
function resolveDashboardView(viewParam: string | undefined, seated: boolean): DashboardView {
  if (viewParam === "centres") return "centres";
  if (viewParam === "jnv-nvs") return "jnv-nvs";
  return seated ? "centres" : "jnv-nvs";
}

// Single-scope shortcuts, both taken only on the plain landing (no tab chosen,
// no search): a single-seat user goes straight to their centre, and school
// staff with exactly one school straight to it. Seated users are excluded from
// the school shortcut — their home is the centre, resolved just above.
function redirectSingleScope({
  seated,
  permission,
  schoolCodes,
  searchQuery,
  viewParam,
  view,
}: {
  seated: boolean;
  permission: DashboardPermission;
  schoolCodes: Awaited<ReturnType<typeof getAccessibleSchoolCodes>>;
  searchQuery?: string;
  viewParam?: string;
  view: DashboardView;
}): void {
  if (seated && !searchQuery && viewParam === undefined) {
    const centres = permission.scope?.centres;
    const seatIds = centres instanceof Set ? [...centres] : [];
    if (seatIds.length === 1) {
      redirect(`/centre/${seatIds[0]}`);
    }
  }
  if (
    !seated &&
    schoolCodes !== "all" &&
    schoolCodes.length === 1 &&
    !searchQuery &&
    view === "jnv-nvs"
  ) {
    redirect(`/school/${schoolCodes[0]}`);
  }
}

// Fetch per tab so neither pays for the other's queries. getSchools runs on
// both tabs — it drives the schools grid on jnv-nvs and the header's scope
// count everywhere — but recent visits (jnv-nvs only) and the centre list
// (centres only) are fetched only where they're rendered.
async function loadDashboardData({
  email,
  permission,
  schoolCodes,
  searchQuery,
  currentPage,
  hasPMAccess,
  view,
}: {
  email: string;
  permission: DashboardPermission;
  schoolCodes: Awaited<ReturnType<typeof getAccessibleSchoolCodes>>;
  searchQuery?: string;
  currentPage: number;
  hasPMAccess: boolean;
  view: DashboardView;
}): Promise<DashboardData> {
  if (view === "centres") {
    // Centre list + the header's school count, in parallel. No visits query and
    // no school grid on this tab.
    const [centres, { totalCount }] = await Promise.all([
      getAccessibleCentresWithCounts(resolveCentreAccess(permission, schoolCodes)),
      getSchools(schoolCodes, searchQuery, currentPage),
    ]);
    return {
      schools: [],
      centres,
      totalCount,
      totalPages: Math.ceil(totalCount / SCHOOLS_PER_PAGE),
      recentVisits: [],
    };
  }

  const [{ schools, totalCount }, recentVisits] = await Promise.all([
    getSchools(schoolCodes, searchQuery, currentPage),
    hasPMAccess ? getRecentVisits(email) : Promise.resolve([] as Visit[]),
  ]);
  // NVS-attributed counts, not whole-school — keeps this tab disjoint from Centres.
  const nvsCounts = await getNvsGradeCounts(schools.map((school) => school.id));
  return {
    schools: schools.map((school) => {
      const counts = nvsCounts.get(school.id) || [];
      return {
        ...school,
        grade_counts: counts,
        student_count: counts.reduce((sum, gradeCount) => sum + gradeCount.count, 0),
      };
    }),
    centres: [],
    totalCount,
    totalPages: Math.ceil(totalCount / SCHOOLS_PER_PAGE),
    recentVisits,
  };
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const [email, { searchQuery, viewParam, currentPage }] = await Promise.all([
    dashboardSession(),
    dashboardRequest(searchParams),
  ]);
  const permission = await getResolvedPermission(email);

  if (!permission) {
    return <NoDashboardAccess
      email={email}
      message={`Your account (${email}) does not have access to any schools. Please contact an administrator.`}
    />;
  }

  // Derive everything from the single permission object — no extra DB calls
  const programContext = getProgramContextSync(permission);
  if (!programContext.hasAccess) {
    return <NoDashboardAccess
      email={email}
      message={`Your account (${email}) is not assigned to any programs. Please contact an administrator to get program access.`}
    />;
  }

  // The holistic-mentorship admin has no school/centre scope at all — their
  // whole surface is the admin console.
  if (permission.role === "holistic_mentorship_admin") {
    redirect("/admin/holistic-mentorship");
  }

  const holisticAccess = await requireHolisticMentorshipAccess(
    { user: { email } },
    "program_read",
  );
  const features = dashboardFeatures(permission, programContext, holisticAccess.ok);
  const seated = isCentreSeated(permission);
  const view = resolveDashboardView(viewParam, seated);
  const schoolCodes = await getAccessibleSchoolCodes(email, permission);
  redirectSingleScope({ seated, permission, schoolCodes, searchQuery, viewParam, view });

  const data = await loadDashboardData({
    email,
    permission,
    schoolCodes,
    searchQuery,
    currentPage,
    hasPMAccess: features.hasPMAccess,
    view,
  });

  return (
    <div className="min-h-screen bg-bg">
      <DashboardHeader email={email} permission={permission} totalCount={data.totalCount} features={features} />
      <DashboardMain
        view={view}
        searchQuery={searchQuery}
        currentPage={currentPage}
        totalPages={data.totalPages}
        totalCount={data.totalCount}
        schools={data.schools}
        centres={data.centres}
        recentVisits={data.recentVisits}
        hasPMAccess={features.hasPMAccess}
      />
    </div>
  );
}

function permissionLabel(permission: DashboardPermission, totalCount: number) {
  if (permission.role === "admin") return "Admin access";
  if (permission.level === 3) return "All schools";
  if (permission.level === 2) return `Region: ${permission.regions?.join(", ")}`;
  return `${totalCount} school(s)`;
}

function DashboardHeader({ email, permission, totalCount, features }: {
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

// Grouping tabs — disjoint scopes, so counts never double-count.
function DashboardViewTabs({ view }: { view: DashboardView }) {
  return <div className="mb-6 flex gap-6 border-b border-border">
    {DASHBOARD_VIEWS.map((tab) => <Link
      key={tab.key}
      href={`/dashboard?view=${tab.key}`}
      className={view === tab.key
        ? "text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-2 -mb-px"
        : "text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-2 -mb-px"}
    >
      {tab.label}
    </Link>)}
  </div>;
}

function DashboardMain({ view, searchQuery, currentPage, totalPages, totalCount, schools, centres, recentVisits, hasPMAccess }: {
  view: DashboardView;
  searchQuery?: string;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  schools: DashboardSchool[];
  centres: Centre[];
  recentVisits: Visit[];
  hasPMAccess: boolean;
}) {
  return <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <DashboardViewTabs view={view} />
    <PMStats enabled={hasPMAccess} totalCount={totalCount} recentVisitCount={recentVisits.length} />
    {view === "centres" ? (
      <CentresSection centres={centres} hasPMAccess={hasPMAccess} />
    ) : (
      <>
        {/* Search is schools-tab only for now (centre search is a follow-up) */}
        <DashboardSearch searchQuery={searchQuery} />
        <RecentVisits enabled={hasPMAccess} visits={recentVisits} />
        <SchoolsSection
          schools={schools}
          hasPMAccess={hasPMAccess}
          searchQuery={searchQuery}
          currentPage={currentPage}
          totalPages={totalPages}
        />
      </>
    )}
  </main>;
}

function CentresSection({ centres, hasPMAccess }: { centres: Centre[]; hasPMAccess: boolean }) {
  return <div>
    {hasPMAccess && <div className="flex justify-between items-center mb-4 border-b-2 border-brand-gold pb-3">
      <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Physical Centres</h2>
    </div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {centres.map((centre) => <DashboardCentreCard key={centre.id} centre={centre} hasPMAccess={hasPMAccess} />)}
    </div>
    {centres.length === 0 && <div className="text-center py-12 text-text-muted">
      No physical centres found
    </div>}
  </div>;
}

function DashboardCentreCard({ centre, hasPMAccess }: { centre: Centre; hasPMAccess: boolean }) {
  // Visits are school-linked, so Start Visit needs the centre's parent school.
  const actions = hasPMAccess && centre.school_code ? <Link href={`/school/${centre.school_code}/visit/new`}
    className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-bold text-text-on-accent bg-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 transition-colors">
    Start Visit
  </Link> : undefined;
  return <CentreCard centre={centre} showRegion={hasPMAccess} actions={actions} />;
}

function PMStats({ enabled, totalCount, recentVisitCount }: {
  enabled: boolean;
  totalCount: number;
  recentVisitCount: number;
}) {
  if (!enabled) return null;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-8">
    <Card className="p-6 border-l-4 border-l-brand-gold">
      <div className="text-xs font-bold text-brand-gold uppercase tracking-wide">My Schools</div>
      <div className="mt-1 text-3xl font-bold text-text-primary font-mono">{totalCount}</div>
    </Card>
    <Card className="p-6 border-l-4 border-l-brand-amber">
      <div className="text-xs font-bold text-brand-amber uppercase tracking-wide">Total Visits</div>
      <div className="mt-1 text-3xl font-bold text-text-primary font-mono">{recentVisitCount}</div>
    </Card>
  </div>;
}

function DashboardSearch({ searchQuery }: { searchQuery?: string }) {
  return <div className="mb-6">
    <div className="mb-4">
      <label className="block text-xs font-bold text-text-muted uppercase tracking-wide mb-2">Search Students</label>
      <StudentSearch />
    </div>
    <div>
      <label className="block text-xs font-bold text-text-muted uppercase tracking-wide mb-2">Search Schools</label>
      <SchoolSearch defaultValue={searchQuery} />
    </div>
  </div>;
}

function RecentVisits({ enabled, visits }: { enabled: boolean; visits: Visit[] }) {
  if (!enabled || visits.length === 0) return null;
  return <div className="mb-8">
    <div className="flex justify-between items-center mb-4 border-b-2 border-brand-amber pb-3">
      <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Recent Visits</h2>
      <Link href="/visits" className="text-sm text-accent hover:text-accent-hover font-bold uppercase">View all</Link>
    </div>
    <div className="bg-bg-card border border-border overflow-hidden">
      <table className="min-w-full">
        <thead className="bg-bg-card-alt border-b-2 border-border-accent"><tr>
          {RECENT_VISIT_COLUMNS.map((column) => <th key={column.label} className={column.className}>{column.label}</th>)}
        </tr></thead>
        <tbody className="bg-bg-card">{visits.map((visit) => <VisitRow key={visit.id} visit={visit} />)}</tbody>
      </table>
    </div>
  </div>;
}

function VisitRow({ visit }: { visit: Visit }) {
  const completed = visit.status === "completed";
  return <tr className="border-b border-border/40 hover:bg-hover-bg">
    <td className="px-6 py-4 whitespace-nowrap text-sm text-text-primary">{visit.school_name || visit.school_code}</td>
    <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-text-secondary">
      {new Date(visit.visit_date).toLocaleDateString("en-IN", {
        year: "numeric", month: "short", day: "numeric", timeZone: "Asia/Kolkata",
      })}
    </td>
    <td className="px-6 py-4 whitespace-nowrap">
      <span className={`inline-flex ${statusBadgeClass(visit.status)}`}>{completed ? "Completed" : "In Progress"}</span>
    </td>
    <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
      <Link href={`/visits/${visit.id}`} className="text-accent hover:text-accent-hover font-bold">{completed ? "View" : "Continue"}</Link>
    </td>
  </tr>;
}

function SchoolsSection({ schools, hasPMAccess, searchQuery, currentPage, totalPages }: {
  schools: DashboardSchool[];
  hasPMAccess: boolean;
  searchQuery?: string;
  currentPage: number;
  totalPages: number;
}) {
  return <div>
    {hasPMAccess && <div className="flex justify-between items-center mb-4 border-b-2 border-brand-gold pb-3">
      <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">JNV NVS Schools</h2>
    </div>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {schools.map((school) => <DashboardSchoolCard key={school.id} school={school} hasPMAccess={hasPMAccess} />)}
    </div>
    {schools.length === 0 && <div className="text-center py-12 text-text-muted">
      {searchQuery ? `No schools found matching "${searchQuery}"` : "No schools found"}
    </div>}
    <Pagination currentPage={currentPage} totalPages={totalPages} basePath="/dashboard"
      searchParams={searchQuery ? { q: searchQuery } : {}} />
  </div>;
}

function DashboardSchoolCard({ school, hasPMAccess }: { school: DashboardSchool; hasPMAccess: boolean }) {
  const actions = hasPMAccess ? <Link href={`/school/${school.code}/visit/new`}
    className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-bold text-text-on-accent bg-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 transition-colors">
    Start Visit
  </Link> : undefined;
  return <SchoolCard school={school} href={`/school/${school.code}`} showStudentCount showGradeBreakdown
    showRegion={hasPMAccess} actions={actions} />;
}
