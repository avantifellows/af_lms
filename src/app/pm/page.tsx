import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUserPermission, getAccessibleSchoolCodes } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";

interface School {
  id: string;
  code: string;
  name: string;
  district: string;
  state: string;
  region: string;
  student_count?: number;
}

interface Visit {
  id: number;
  school_code: string;
  school_name?: string;
  visit_date: string;
  status: string;
  created_at: string;
}

async function getPMSchools(codes: string[] | "all"): Promise<School[]> {
  if (codes === "all") {
    return query<School>(
      `SELECT s.id, s.code, s.name, s.district, s.state, s.region,
              COUNT(DISTINCT gu.user_id) as student_count
       FROM school s
       LEFT JOIN "group" g ON g.type = 'school' AND g.child_id = s.id
       LEFT JOIN group_user gu ON gu.group_id = g.id
       WHERE s.af_school_category = 'JNV'
       GROUP BY s.id, s.code, s.name, s.district, s.state, s.region
       ORDER BY s.name
       LIMIT 50`
    );
  }

  if (codes.length === 0) return [];

  return query<School>(
    `SELECT s.id, s.code, s.name, s.district, s.state, s.region,
            COUNT(DISTINCT gu.user_id) as student_count
     FROM school s
     LEFT JOIN "group" g ON g.type = 'school' AND g.child_id = s.id
     LEFT JOIN group_user gu ON gu.group_id = g.id
     WHERE s.af_school_category = 'JNV'
       AND s.code = ANY($1)
     GROUP BY s.id, s.code, s.name, s.district, s.state, s.region
     ORDER BY s.name`,
    [codes]
  );
}

async function getRecentVisits(pmEmail: string, limit: number = 5): Promise<Visit[]> {
  const visits = await query<Visit>(
    `SELECT v.id, v.school_code, v.visit_date, v.status, v.created_at,
            s.name as school_name
     FROM lms_pm_school_visits v
     LEFT JOIN school s ON s.code = v.school_code
     WHERE v.pm_email = $1
     ORDER BY v.visit_date DESC, v.created_at DESC
     LIMIT $2`,
    [pmEmail, limit]
  );
  return visits;
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

export default async function PMDashboardPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getUserPermission(session.user.email);
  if (!permission) {
    redirect("/");
  }

  const schoolCodes = await getAccessibleSchoolCodes(session.user.email);
  const schools = await getPMSchools(schoolCodes);
  const recentVisits = await getRecentVisits(session.user.email);
  const openIssues = await getOpenIssuesCount(session.user.email);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-sm font-medium text-gray-500">My Schools</div>
          <div className="mt-1 text-3xl font-semibold text-gray-900">
            {schools.length}
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

      {/* Recent Visits */}
      {recentVisits.length > 0 && (
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Visits</h2>
            <Link
              href="/pm/visits"
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
                      {new Date(visit.visit_date).toLocaleDateString()}
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
                        href={`/pm/visits/${visit.id}`}
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
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-gray-900">My Schools</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schools.map((school) => (
            <div
              key={school.id}
              className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
            >
              <h3 className="font-semibold text-gray-900">{school.name}</h3>
              <p className="mt-1 text-sm text-gray-500">
                {school.district}, {school.state}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Region: {school.region} | Code: {school.code}
              </p>
              {school.student_count !== undefined && (
                <p className="mt-2 text-sm text-gray-600">
                  {school.student_count} students
                </p>
              )}
              <div className="mt-4 flex gap-2">
                <Link
                  href={`/pm/school/${school.code}`}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  View Details
                </Link>
                <span className="text-gray-300">|</span>
                <Link
                  href={`/pm/school/${school.code}/visit/new`}
                  className="text-sm text-green-600 hover:text-green-800"
                >
                  Start Visit
                </Link>
              </div>
            </div>
          ))}
        </div>

        {schools.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No schools assigned. Contact an administrator.
          </div>
        )}
      </div>
    </main>
  );
}
