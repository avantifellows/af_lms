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

  if (codes === "all") {
    if (searchPattern) {
      const [schools, countResult] = await Promise.all([
        query<School>(
          `${baseQuery}
             AND (s.name ILIKE $1 OR s.code ILIKE $1 OR s.district ILIKE $1)
           ORDER BY s.name
           LIMIT $2 OFFSET $3`,
          [searchPattern, SCHOOLS_PER_PAGE, offset]
        ),
        query<{ total: string }>(
          `${countBaseQuery} AND (s.name ILIKE $1 OR s.code ILIKE $1 OR s.district ILIKE $1)`,
          [searchPattern]
        ),
      ]);
      return { schools, totalCount: parseInt(countResult[0]?.total || "0", 10) };
    }
    const [schools, countResult] = await Promise.all([
      query<School>(
        `${baseQuery}
         ORDER BY s.name
         LIMIT $1 OFFSET $2`,
        [SCHOOLS_PER_PAGE, offset]
      ),
      query<{ total: string }>(countBaseQuery),
    ]);
    return { schools, totalCount: parseInt(countResult[0]?.total || "0", 10) };
  }

  if (codes.length === 0) return { schools: [], totalCount: 0 };

  if (searchPattern) {
    const [schools, countResult] = await Promise.all([
      query<School>(
        `${baseQuery}
           AND s.code = ANY($1)
           AND (s.name ILIKE $2 OR s.code ILIKE $2 OR s.district ILIKE $2)
         ORDER BY s.name
         LIMIT $3 OFFSET $4`,
        [codes, searchPattern, SCHOOLS_PER_PAGE, offset]
      ),
      query<{ total: string }>(
        `${countBaseQuery} AND s.code = ANY($1) AND (s.name ILIKE $2 OR s.code ILIKE $2 OR s.district ILIKE $2)`,
        [codes, searchPattern]
      ),
    ]);
    return { schools, totalCount: parseInt(countResult[0]?.total || "0", 10) };
  }

  const [schools, countResult] = await Promise.all([
    query<School>(
      `${baseQuery}
         AND s.code = ANY($1)
       ORDER BY s.name
       LIMIT $2 OFFSET $3`,
      [codes, SCHOOLS_PER_PAGE, offset]
    ),
    query<{ total: string }>(
      `${countBaseQuery} AND s.code = ANY($1)`,
      [codes]
    ),
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

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const { q: searchQuery, page: pageParam, view: viewParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam || "1", 10));

  if (!session?.user?.email) {
    redirect("/");
  }

  // Check if passcode user - redirect to their school
  if (session.isPasscodeUser && session.schoolCode) {
    redirect(`/school/${session.schoolCode}`);
  }

  const permission = await getResolvedPermission(session.user.email);

  if (!permission) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">{session.user.email}</span>
              <a href="/api/auth/signout" className="text-sm font-bold text-red-600 hover:text-red-500">Sign out</a>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="rounded-lg bg-yellow-50 p-4 border border-yellow-200">
            <p className="text-yellow-800">
              Your account ({session.user.email}) does not have access to any
              schools. Please contact an administrator.
            </p>
          </div>
        </main>
      </div>
    );
  }

  // Derive everything from the single permission object — no extra DB calls
  const programContext = getProgramContextSync(permission);
  if (!programContext.hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">{session.user.email}</span>
              <a href="/api/auth/signout" className="text-sm font-bold text-red-600 hover:text-red-500">Sign out</a>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="rounded-lg bg-yellow-50 p-4 border border-yellow-200">
            <p className="text-yellow-800">
              Your account ({session.user.email}) is not assigned to any programs.
              Please contact an administrator to get program access.
            </p>
          </div>
        </main>
      </div>
    );
  }

  const hasPMAccess = getFeatureAccess(permission, "pm_dashboard").canView;
  const canViewVisitSummary =
    (permission.role === "admin" || permission.role === "program_admin") &&
    getFeatureAccess(permission, "visits").canView;
  const showCurriculumSummary =
    (permission.role === "program_manager" ||
      permission.role === "program_admin" ||
      permission.role === "admin") &&
    programContext.hasCoEOrNodal &&
    getFeatureAccess(permission, "curriculum").canView;

  const schoolCodes = await getAccessibleSchoolCodes(session.user.email, permission);

  // Centre-seated staff are centre-scoped: their home is their centre, not the
  // whole-school roster. Default them to the Centres tab (an explicit ?view=
  // still wins), so the single-school shortcut below never bounces them to the
  // school page.
  const seated = isCentreSeated(permission);
  const view: DashboardView =
    viewParam === "centres"
      ? "centres"
      : viewParam === "jnv-nvs"
        ? "jnv-nvs"
        : seated
          ? "centres"
          : "jnv-nvs";

  // On the plain landing (no tab chosen, no search), send a single-seat user
  // straight to their centre page — the centre analog of the single-school
  // shortcut below. Multi-seat users stay on the Centres tab to pick one.
  if (seated && !searchQuery && viewParam === undefined) {
    const centres = permission.scope?.centres;
    const seatIds = centres instanceof Set ? [...centres] : [];
    if (seatIds.length === 1) {
      redirect(`/centre/${seatIds[0]}`);
    }
  }

  // School staff with a single school skip directly to it (skip heavy queries).
  // Seated users are excluded — their home is the centre, resolved above.
  if (
    !seated &&
    schoolCodes !== "all" &&
    schoolCodes.length === 1 &&
    !searchQuery &&
    view === "jnv-nvs"
  ) {
    redirect(`/school/${schoolCodes[0]}`);
  }

  // Fetch per tab so neither pays for the other's queries. getSchools runs on
  // both tabs — it drives the schools grid on jnv-nvs and the header's scope
  // count everywhere — but recent visits (jnv-nvs only) and the centre list
  // (centres only) are fetched only where they're rendered.
  let totalCount = 0;
  let recentVisits: Visit[] = [];
  // JNV NVS tab: schools with NVS-attributed grade counts (disjoint from centres).
  let schoolsWithGrades: (School & { grade_counts: GradeCount[]; student_count: number })[] = [];
  // Physical Centres tab: active centres the user can access, with counts.
  let centres: Centre[] = [];

  if (view === "centres") {
    // Centre list + the header's school count, in parallel. No visits query and
    // no school grid on this tab.
    const [centreList, { totalCount: schoolCount }] = await Promise.all([
      getAccessibleCentresWithCounts(resolveCentreAccess(permission, schoolCodes)),
      getSchools(schoolCodes, searchQuery, currentPage),
    ]);
    centres = centreList;
    totalCount = schoolCount;
  } else {
    const [{ schools, totalCount: schoolCount }, visits] = await Promise.all([
      getSchools(schoolCodes, searchQuery, currentPage),
      hasPMAccess ? getRecentVisits(session.user.email) : Promise.resolve([] as Visit[]),
    ]);
    totalCount = schoolCount;
    recentVisits = visits;
    const nvsCounts = await getNvsGradeCounts(schools.map((s) => s.id));
    schoolsWithGrades = schools.map((school) => {
      const counts = nvsCounts.get(school.id) || [];
      return {
        ...school,
        grade_counts: counts,
        student_count: counts.reduce((sum, gc) => sum + gc.count, 0),
      };
    });
  }
  const totalPages = Math.ceil(totalCount / SCHOOLS_PER_PAGE);

  return (
    <div className="min-h-screen bg-bg">
      <header className="bg-bg-card border-b border-border shadow-sm">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 flex flex-wrap justify-between items-center gap-y-2">
          <div className="flex items-center gap-3 sm:gap-6 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://cdn.avantifellows.org/af_logos/avanti_logo_black_text.webp" alt="Avanti Fellows" className="h-8 sm:h-10 shrink-0" />
            <div className="hidden sm:block border-l border-border pl-4">
              <p className="text-xs text-text-muted uppercase tracking-wide">
                {permission.role === "admin"
                  ? "Admin access"
                  : permission.level === 3
                    ? "All schools"
                    : permission.level === 2
                      ? `Region: ${permission.regions?.join(", ")}`
                      : `${totalCount} school(s)`}
              </p>
            </div>
            {(hasPMAccess || canViewVisitSummary || showCurriculumSummary) && (
              <nav className="flex gap-3 sm:gap-4">
                <Link
                  href="/dashboard"
                  className="text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-1"
                >
                  Home
                </Link>
                {canViewVisitSummary && (
                  <Link
                    href="/school-visit-summary"
                    className="text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1"
                  >
                    Visit Summary
                  </Link>
                )}
                {showCurriculumSummary && (
                  <Link
                    href="/curriculum-summary"
                    className="text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-1"
                  >
                    Curriculum Summary
                  </Link>
                )}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            {permission.role === "admin" && (
              <Link
                href="/admin"
                className="text-sm font-bold text-accent hover:text-accent-hover uppercase"
              >
                Admin
              </Link>
            )}
            <span className="text-sm text-text-muted font-mono hidden sm:inline">{session.user.email}</span>
            <Link
              href="/api/auth/signout"
              className="text-sm font-bold text-danger hover:text-danger/80"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Grouping tabs — disjoint scopes, so counts never double-count. */}
        <div className="mb-6 flex gap-6 border-b border-border">
          {(
            [
              { key: "centres", label: "Physical Centres" },
              { key: "jnv-nvs", label: "JNV NVS Schools" },
            ] as const
          ).map((tab) => (
            <Link
              key={tab.key}
              href={`/dashboard?view=${tab.key}`}
              className={
                view === tab.key
                  ? "text-sm font-bold text-text-primary uppercase tracking-wide border-b-2 border-accent pb-2 -mb-px"
                  : "text-sm font-medium text-text-muted uppercase tracking-wide hover:text-text-primary pb-2 -mb-px"
              }
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* Stats - only show for PM users */}
        {hasPMAccess && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-8">
            <Card className="p-6 border-l-4 border-l-brand-gold">
              <div className="text-xs font-bold text-brand-gold uppercase tracking-wide">My Schools</div>
              <div className="mt-1 text-3xl font-bold text-text-primary font-mono">
                {totalCount}
              </div>
            </Card>
            <Card className="p-6 border-l-4 border-l-brand-amber">
              <div className="text-xs font-bold text-brand-amber uppercase tracking-wide">Total Visits</div>
              <div className="mt-1 text-3xl font-bold text-text-primary font-mono">
                {recentVisits.length}
              </div>
            </Card>
          </div>
        )}

        {/* Search — schools tab only for now (centre search is a follow-up) */}
        {view === "jnv-nvs" && (
          <div className="mb-6">
            <div className="mb-4">
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wide mb-2">
                Search Students
              </label>
              <StudentSearch />
            </div>
            <div>
              <label className="block text-xs font-bold text-text-muted uppercase tracking-wide mb-2">
                Search Schools
              </label>
              <SchoolSearch defaultValue={searchQuery} />
            </div>
          </div>
        )}

        {/* Recent Visits - only show for PM users, on the schools tab */}
        {view === "jnv-nvs" && hasPMAccess && recentVisits.length > 0 && (
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4 border-b-2 border-brand-amber pb-3">
              <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Recent Visits</h2>
              <Link
                href="/visits"
                className="text-sm text-accent hover:text-accent-hover font-bold uppercase"
              >
                View all
              </Link>
            </div>
            <div className="bg-bg-card border border-border overflow-hidden">
              <table className="min-w-full">
                <thead className="bg-bg-card-alt border-b-2 border-border-accent">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      School
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-bold text-text-muted uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-bold text-text-muted uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-bg-card">
                  {recentVisits.map((visit) => (
                    <tr key={visit.id} className="border-b border-border/40 hover:bg-hover-bg">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-text-primary">
                        {visit.school_name || visit.school_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-text-secondary">
                        {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex ${statusBadgeClass(visit.status)}`}
                        >
                          {visit.status === "completed" ? "Completed" : "In Progress"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/visits/${visit.id}`}
                          className="text-accent hover:text-accent-hover font-bold"
                        >
                          {visit.status === "completed" ? "View" : "Continue"}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Schools Grid — JNV NVS tab */}
        {view === "jnv-nvs" && (
        <div>
          {hasPMAccess && (
            <div className="flex justify-between items-center mb-4 border-b-2 border-brand-gold pb-3">
              <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">JNV NVS Schools</h2>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {schoolsWithGrades.map((school) => (
              <SchoolCard
                key={school.id}
                school={school}
                href={`/school/${school.code}`}
                showStudentCount
                showGradeBreakdown
                showRegion={hasPMAccess}
                actions={
                  hasPMAccess ? (
                    <Link
                      href={`/school/${school.code}/visit/new`}
                      className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-bold text-text-on-accent bg-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 transition-colors"
                    >
                      Start Visit
                    </Link>
                  ) : undefined
                }
              />
            ))}
          </div>

          {schoolsWithGrades.length === 0 && (
            <div className="text-center py-12 text-text-muted">
              {searchQuery
                ? `No schools found matching "${searchQuery}"`
                : "No schools found"}
            </div>
          )}

          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            basePath="/dashboard"
            searchParams={searchQuery ? { q: searchQuery } : {}}
          />
        </div>
        )}

        {/* Physical Centres grid */}
        {view === "centres" && (
          <div>
            {hasPMAccess && (
              <div className="flex justify-between items-center mb-4 border-b-2 border-brand-gold pb-3">
                <h2 className="text-lg font-bold text-text-primary uppercase tracking-wide">Physical Centres</h2>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {centres.map((centre) => (
                <CentreCard
                  key={centre.id}
                  centre={centre}
                  showRegion={hasPMAccess}
                  actions={
                    hasPMAccess && centre.school_code ? (
                      <Link
                        href={`/school/${centre.school_code}/visit/new`}
                        className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-bold text-text-on-accent bg-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 transition-colors"
                      >
                        Start Visit
                      </Link>
                    ) : undefined
                  }
                />
              ))}
            </div>
            {centres.length === 0 && (
              <div className="text-center py-12 text-text-muted">
                No physical centres found
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
