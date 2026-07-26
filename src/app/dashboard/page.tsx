import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getAccessibleSchoolCodes,
  getResolvedPermission,
  getProgramContextSync,
  getFeatureAccess,
} from "@/lib/permissions";
import { query } from "@/lib/db";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import Link from "next/link";
import SchoolSearch from "@/components/SchoolSearch";
import StudentSearch from "@/components/StudentSearch";
import SchoolCard, { School, GradeCount } from "@/components/SchoolCard";
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

  // Stopgap: hide duplicate placeholder school rows. A stale bulk import left a
  // second JNV row (null udise_code, 0 students) for ~190 schools, so they
  // double-listed on the dashboard. Exclude a row only when its udise is null
  // AND a same-named JNV row carries a real udise — that pins it as the dup.
  // Single schools that legitimately lack a udise (a few Telangana/WB rows with
  // real students) have no udise-bearing namesake and are kept. The data team
  // will purge the placeholder rows; remove this filter once they have.
  const excludeDupPlaceholders = `
    AND NOT (
      s.udise_code IS NULL
      AND EXISTS (
        SELECT 1 FROM school s2
        WHERE s2.af_school_category = 'JNV'
          AND s2.name = s.name
          AND s2.udise_code IS NOT NULL
      )
    )`;

  // School visibility scope: the historical JNV set PLUS any school linked to an
  // active centre. Centre-linked covers the non-JNV centre rollout (Punjab CoE
  // meritorious / EMRS) without disturbing JNV. Centre-driven, not a category
  // allowlist — new centre types light up by linking a centre, no code change.
  const schoolScope = `(
    s.af_school_category = 'JNV'
    OR EXISTS (SELECT 1 FROM centres c WHERE c.school_id = s.id AND c.is_active)
  )`;

  const baseQuery = `
    SELECT s.id, s.code, s.name, s.district, s.state, s.region
    FROM school s
    WHERE ${schoolScope}${excludeDupPlaceholders}`;

  const countBaseQuery = `
    SELECT COUNT(DISTINCT s.id) as total
    FROM school s
    WHERE ${schoolScope}${excludeDupPlaceholders}`;

  if (codes.length === 0) return { schools: [], totalCount: 0 };
  const plan = schoolQueryPlan(codes, searchPattern, offset);
  const [schools, countResult] = await Promise.all([
    query<School>(`${baseQuery} ${plan.listSql}`, plan.listParams),
    query<{ total: string }>(`${countBaseQuery} ${plan.countSql}`, plan.countParams),
  ]);
  return { schools, totalCount: parseInt(countResult[0]?.total || "0", 10) };
}

// Get grade-wise student counts for the loaded school cards.
// Scoped to the current academic year so the dashboard summary cards match
// the school roster, which is also restricted to CURRENT_ACADEMIC_YEAR.
//
// Cohort rule (matches the school-page roster, which attributes each student a
// program via their batch):
//  - JNV schools: the school *is* the cohort — count every current-year member
//    (historical behaviour, unchanged).
//  - Non-JNV centre-linked schools sit inside a much larger host school (e.g.
//    RSMS Bathinda has ~341 current-year members but only ~99 CoE+Nodal cohort),
//    so count only students enrolled in a batch of one of the school's
//    active-centre programs. Otherwise the card over-counts the whole host
//    school (incl. unrelated programmes like the STP Test Series group).
async function getSchoolGradeCounts(schoolIds: string[]): Promise<Map<string, GradeCount[]>> {
  if (schoolIds.length === 0) return new Map();

  const results = await query<{ school_id: string; grade: number; count: string }>(
    `SELECT
       s.id as school_id,
       gr.number as grade,
       COUNT(DISTINCT gu_school.user_id) as count
     FROM school s
     JOIN "group" g_school ON g_school.type = 'school' AND g_school.child_id = s.id
     JOIN group_user gu_school ON gu_school.group_id = g_school.id
     LEFT JOIN enrollment_record er ON er.user_id = gu_school.user_id
       AND er.group_type = 'grade' AND er.is_current = true
       AND er.academic_year = $2
     LEFT JOIN grade gr ON er.group_id = gr.id
     WHERE s.id = ANY($1) AND gr.number IS NOT NULL
       AND (
         s.af_school_category = 'JNV'
         OR EXISTS (
           SELECT 1
           FROM group_user gu_batch
           JOIN "group" g_batch ON gu_batch.group_id = g_batch.id AND g_batch.type = 'batch'
           JOIN batch b ON g_batch.child_id = b.id
           JOIN centres c ON c.school_id = s.id AND c.is_active
             AND c.program_id = b.program_id
           WHERE gu_batch.user_id = gu_school.user_id
         )
       )
     GROUP BY s.id, gr.number
     ORDER BY gr.number`,
    [schoolIds, CURRENT_ACADEMIC_YEAR]
  );

  const gradeMap = new Map<string, GradeCount[]>();
  results.forEach((row) => {
    if (!gradeMap.has(row.school_id)) {
      gradeMap.set(row.school_id, []);
    }
    gradeMap.get(row.school_id)!.push({
      grade: row.grade,
      count: parseInt(row.count, 10),
    });
  });
  return gradeMap;
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

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
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

function dashboardFeatures(permission: DashboardPermission, context: DashboardProgramContext): DashboardFeatures {
  return {
    hasPMAccess: getFeatureAccess(permission, "pm_dashboard").canView,
    canViewVisitSummary: canViewVisitSummary(permission),
    showCurriculumSummary: canViewCurriculumSummary(permission, context),
    canViewHolisticAdmin: permission.role === "admin" && getFeatureAccess(permission, "holistic_mentorship").canView,
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
  const { q: searchQuery, page: pageParam } = await searchParams;
  return { searchQuery, currentPage: Math.max(1, parseInt(pageParam || "1", 10)) };
}

async function loadDashboardData({
  email,
  permission,
  searchQuery,
  currentPage,
  hasPMAccess,
}: {
  email: string;
  permission: DashboardPermission;
  searchQuery?: string;
  currentPage: number;
  hasPMAccess: boolean;
}): Promise<DashboardData> {
  const schoolCodes = await getAccessibleSchoolCodes(email, permission);
  if (schoolCodes !== "all" && schoolCodes.length === 1 && !searchQuery) {
    redirect(`/school/${schoolCodes[0]}`);
  }
  const { schools, totalCount } = await getSchools(schoolCodes, searchQuery, currentPage);
  const [gradeCounts, recentVisits] = await Promise.all([
    getSchoolGradeCounts(schools.map((school) => school.id)),
    hasPMAccess ? getRecentVisits(email) : Promise.resolve([] as Visit[]),
  ]);
  return {
    schools: schools.map((school) => {
      const counts = gradeCounts.get(school.id) || [];
      return {
        ...school,
        grade_counts: counts,
        student_count: counts.reduce((sum, gradeCount) => sum + gradeCount.count, 0),
      };
    }),
    totalCount,
    totalPages: Math.ceil(totalCount / SCHOOLS_PER_PAGE),
    recentVisits,
  };
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const [email, { searchQuery, currentPage }] = await Promise.all([
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

  if (permission.role === "holistic_mentorship_admin") {
    redirect("/admin/holistic-mentorship");
  }

  const features = dashboardFeatures(permission, programContext);
  const data = await loadDashboardData({
    email,
    permission,
    searchQuery,
    currentPage,
    hasPMAccess: features.hasPMAccess,
  });

  return (
    <div className="min-h-screen bg-bg">
      <DashboardHeader email={email} permission={permission} totalCount={data.totalCount} features={features} />
      <DashboardMain
        searchQuery={searchQuery}
        currentPage={currentPage}
        totalPages={data.totalPages}
        totalCount={data.totalCount}
        schools={data.schools}
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
      Schools
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

function DashboardMain({ searchQuery, currentPage, totalPages, totalCount, schools, recentVisits, hasPMAccess }: {
  searchQuery?: string;
  currentPage: number;
  totalPages: number;
  totalCount: number;
  schools: DashboardSchool[];
  recentVisits: Visit[];
  hasPMAccess: boolean;
}) {
  return <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
    <PMStats enabled={hasPMAccess} totalCount={totalCount} recentVisitCount={recentVisits.length} />
    <DashboardSearch searchQuery={searchQuery} />
    <RecentVisits enabled={hasPMAccess} visits={recentVisits} />
    <SchoolsSection
      schools={schools}
      hasPMAccess={hasPMAccess}
      searchQuery={searchQuery}
      currentPage={currentPage}
      totalPages={totalPages}
    />
  </main>;
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
      <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">My Schools</h2>
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
