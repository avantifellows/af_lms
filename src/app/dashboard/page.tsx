import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import {
  getAccessibleSchoolCodes,
  getUserPermission,
  canAccessPMFeatures,
} from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import SchoolSearch from "@/components/SchoolSearch";
import StudentSearch from "@/components/StudentSearch";
import SchoolCard, { School, GradeCount } from "@/components/SchoolCard";
import Pagination from "@/components/Pagination";
import { JNV_NVS_PROGRAM_ID } from "@/lib/constants";

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

  // Query to get schools with NVS student count
  const baseQuery = `
    SELECT s.id, s.code, s.name, s.district, s.state, s.region,
           COUNT(DISTINCT CASE WHEN b.program_id = $1 THEN gu_batch.user_id END) as nvs_student_count
    FROM school s
    LEFT JOIN "group" g ON g.type = 'school' AND g.child_id = s.id
    LEFT JOIN group_user gu ON gu.group_id = g.id
    LEFT JOIN group_user gu_batch ON gu_batch.user_id = gu.user_id
    LEFT JOIN "group" g_batch ON gu_batch.group_id = g_batch.id AND g_batch.type = 'batch'
    LEFT JOIN batch b ON g_batch.child_id = b.id
    WHERE s.af_school_category = 'JNV'`;

  const countBaseQuery = `
    SELECT COUNT(DISTINCT s.id) as total
    FROM school s
    WHERE s.af_school_category = 'JNV'`;

  if (codes === "all") {
    if (searchPattern) {
      const [schools, countResult] = await Promise.all([
        query<School>(
          `${baseQuery}
             AND (s.name ILIKE $2 OR s.code ILIKE $2 OR s.district ILIKE $2)
           GROUP BY s.id, s.code, s.name, s.district, s.state, s.region
           ORDER BY s.name
           LIMIT $3 OFFSET $4`,
          [JNV_NVS_PROGRAM_ID, searchPattern, SCHOOLS_PER_PAGE, offset]
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
         GROUP BY s.id, s.code, s.name, s.district, s.state, s.region
         ORDER BY s.name
         LIMIT $2 OFFSET $3`,
        [JNV_NVS_PROGRAM_ID, SCHOOLS_PER_PAGE, offset]
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
           AND s.code = ANY($2)
           AND (s.name ILIKE $3 OR s.code ILIKE $3 OR s.district ILIKE $3)
         GROUP BY s.id, s.code, s.name, s.district, s.state, s.region
         ORDER BY s.name
         LIMIT $4 OFFSET $5`,
        [JNV_NVS_PROGRAM_ID, codes, searchPattern, SCHOOLS_PER_PAGE, offset]
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
         AND s.code = ANY($2)
       GROUP BY s.id, s.code, s.name, s.district, s.state, s.region
       ORDER BY s.name
       LIMIT $3 OFFSET $4`,
      [JNV_NVS_PROGRAM_ID, codes, SCHOOLS_PER_PAGE, offset]
    ),
    query<{ total: string }>(
      `${countBaseQuery} AND s.code = ANY($1)`,
      [codes]
    ),
  ]);
  return { schools, totalCount: parseInt(countResult[0]?.total || "0", 10) };
}

// Get grade-wise NVS student counts for all schools
async function getSchoolGradeCounts(schoolIds: string[]): Promise<Map<string, GradeCount[]>> {
  if (schoolIds.length === 0) return new Map();

  const results = await query<{ school_id: string; grade: number; count: string }>(
    `SELECT
       s.id as school_id,
       gr.number as grade,
       COUNT(DISTINCT gu_batch.user_id) as count
     FROM school s
     JOIN "group" g_school ON g_school.type = 'school' AND g_school.child_id = s.id
     JOIN group_user gu_school ON gu_school.group_id = g_school.id
     JOIN group_user gu_batch ON gu_batch.user_id = gu_school.user_id
     JOIN "group" g_batch ON gu_batch.group_id = g_batch.id AND g_batch.type = 'batch'
     JOIN batch b ON g_batch.child_id = b.id AND b.program_id = $1
     LEFT JOIN enrollment_record er ON er.user_id = gu_school.user_id
       AND er.group_type = 'grade' AND er.is_current = true
     LEFT JOIN grade gr ON er.group_id = gr.id
     WHERE s.id = ANY($2) AND gr.number IS NOT NULL
     GROUP BY s.id, gr.number
     ORDER BY gr.number`,
    [JNV_NVS_PROGRAM_ID, schoolIds]
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
     ORDER BY v.visit_date DESC, v.inserted_at DESC
     LIMIT $2`,
    [pmEmail, limit]
  );
}

async function getOpenIssuesCount(pmEmail: string): Promise<number> {
  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count
     FROM lms_pm_school_visits v,
          jsonb_array_elements(v.data->'issueLog') as issue
     WHERE v.pm_email = $1
       AND issue->>'status' = 'open'`,
    [pmEmail]
  );
  return parseInt(result[0]?.count || "0", 10);
}

interface PageProps {
  searchParams: Promise<{ q?: string; page?: string }>;
}

export default async function DashboardPage({ searchParams }: PageProps) {
  const session = await getServerSession(authOptions);
  const { q: searchQuery, page: pageParam } = await searchParams;
  const currentPage = Math.max(1, parseInt(pageParam || "1", 10));

  if (!session?.user?.email) {
    redirect("/");
  }

  // Check if passcode user - redirect to their school
  if (session.isPasscodeUser && session.schoolCode) {
    redirect(`/school/${session.schoolCode}`);
  }

  const permission = await getUserPermission(session.user.email);

  if (!permission) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
            <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
            <div className="text-sm text-gray-500">{session.user.email}</div>
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

  // Check if user has PM access for visits features
  const hasPMAccess = await canAccessPMFeatures(session.user.email);

  const schoolCodes = await getAccessibleSchoolCodes(session.user.email);
  const { schools, totalCount } = await getSchools(schoolCodes, searchQuery, currentPage);
  const totalPages = Math.ceil(totalCount / SCHOOLS_PER_PAGE);

  // Fetch grade-wise counts for NVS students in each school
  const schoolIds = schools.map((s) => s.id);
  const gradeCounts = await getSchoolGradeCounts(schoolIds);

  // Merge grade counts into schools
  const schoolsWithGrades = schools.map((school) => ({
    ...school,
    grade_counts: gradeCounts.get(school.id) || [],
  }));

  // Fetch PM-specific data only if user has PM access
  let recentVisits: Visit[] = [];
  let openIssues = 0;
  if (hasPMAccess) {
    [recentVisits, openIssues] = await Promise.all([
      getRecentVisits(session.user.email),
      getOpenIssuesCount(session.user.email),
    ]);
  }

  // If user has access to only one school and no search, redirect directly
  if (schoolCodes !== "all" && schoolCodes.length === 1 && !searchQuery) {
    redirect(`/school/${schoolCodes[0]}`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 flex justify-between items-center">
          <div className="flex items-center gap-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Schools</h1>
              <p className="mt-1 text-sm text-gray-500">
                {permission.level === 4
                  ? "Admin access"
                  : permission.level === 3
                    ? "All schools access"
                    : permission.level === 2
                      ? `Region access: ${permission.regions?.join(", ")}`
                      : `${totalCount} school(s)`}
              </p>
            </div>
            {hasPMAccess && (
              <nav className="flex gap-4 ml-8">
                <Link
                  href="/dashboard"
                  className="text-sm font-medium text-gray-900"
                >
                  Schools
                </Link>
                <Link
                  href="/visits"
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Visits
                </Link>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-4">
            {permission.level === 4 && (
              <Link
                href="/admin"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Admin
              </Link>
            )}
            <span className="text-sm text-gray-500">{session.user.email}</span>
            <Link
              href="/api/auth/signout"
              className="text-sm text-red-600 hover:text-red-800"
            >
              Sign out
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Stats - only show for PM users */}
        {hasPMAccess && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500">My Schools</div>
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {totalCount}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500">Total Visits</div>
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {recentVisits.length}
              </div>
            </div>
            <div className="bg-white rounded-lg shadow p-6">
              <div className="text-sm font-medium text-gray-500">Open Issues</div>
              <div className="mt-1 text-3xl font-semibold text-gray-900">
                {openIssues}
              </div>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="mb-6">
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Students
            </label>
            <StudentSearch />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Search Schools
            </label>
            <SchoolSearch defaultValue={searchQuery} />
          </div>
        </div>

        {/* Recent Visits - only show for PM users */}
        {hasPMAccess && recentVisits.length > 0 && (
          <div className="mb-8">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Recent Visits</h2>
              <Link
                href="/visits"
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                View all
              </Link>
            </div>
            <div className="bg-white shadow rounded-lg overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      School
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentVisits.map((visit) => (
                    <tr key={visit.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {visit.school_name || visit.school_code}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(visit.visit_date).toLocaleDateString("en-IN", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                          timeZone: "Asia/Kolkata",
                        })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            visit.status === "completed"
                              ? "bg-green-100 text-green-800"
                              : "bg-yellow-100 text-yellow-800"
                          }`}
                        >
                          {visit.status === "completed" ? "Completed" : "In Progress"}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                        <Link
                          href={`/visits/${visit.id}`}
                          className="text-blue-600 hover:text-blue-800"
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

        {/* Schools Grid */}
        <div>
          {hasPMAccess && (
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold text-gray-900">My Schools</h2>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {schoolsWithGrades.map((school) => (
              <SchoolCard
                key={school.id}
                school={school}
                href={`/school/${school.code}`}
                showNVSCount
                showGradeBreakdown
                showRegion={hasPMAccess}
                actions={
                  hasPMAccess ? (
                    <Link
                      href={`/school/${school.code}/visit/new`}
                      className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md"
                    >
                      Start Visit
                    </Link>
                  ) : undefined
                }
              />
            ))}
          </div>

          {schoolsWithGrades.length === 0 && (
            <div className="text-center py-12 text-gray-500">
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
      </main>
    </div>
  );
}
