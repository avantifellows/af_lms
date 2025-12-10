import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessSchool, getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";

interface School {
  id: string;
  code: string;
  name: string;
  district: string;
  state: string;
  region: string;
}

interface Student {
  user_id: number;
  student_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  gender: string;
  category: string;
  stream: string;
}

interface Visit {
  id: number;
  visit_date: string;
  status: string;
  created_at: string;
}

async function getSchool(code: string): Promise<School | null> {
  const results = await query<School>(
    `SELECT id, code, name, district, state, region
     FROM school
     WHERE code = $1`,
    [code]
  );
  return results[0] || null;
}

async function getStudents(schoolCode: string): Promise<Student[]> {
  return query<Student>(
    `SELECT u.id as user_id, s.student_id, u.first_name, u.last_name,
            u.phone, u.email, u.gender, s.category, s.stream
     FROM "user" u
     JOIN student s ON s.user_id = u.id
     JOIN group_user gu ON gu.user_id = u.id
     JOIN "group" g ON g.id = gu.group_id
     JOIN school sc ON sc.id = g.child_id AND g.type = 'school'
     WHERE sc.code = $1
     ORDER BY u.first_name, u.last_name
     LIMIT 100`,
    [schoolCode]
  );
}

async function getSchoolVisits(schoolCode: string, pmEmail: string): Promise<Visit[]> {
  return query<Visit>(
    `SELECT id, visit_date, status, created_at
     FROM lms_pm_school_visits
     WHERE school_code = $1 AND pm_email = $2
     ORDER BY visit_date DESC
     LIMIT 10`,
    [schoolCode, pmEmail]
  );
}

interface PageProps {
  params: Promise<{ code: string }>;
}

export default async function PMSchoolPage({ params }: PageProps) {
  const { code } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const permission = await getUserPermission(session.user.email);
  if (!permission || (permission.role !== "program_manager" && permission.role !== "admin")) {
    redirect("/dashboard");
  }

  const school = await getSchool(code);
  if (!school) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-800">School not found.</p>
        </div>
      </main>
    );
  }

  const canAccess = await canAccessSchool(session.user.email, school.code, school.region);
  if (!canAccess) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">You do not have access to this school.</p>
        </div>
      </main>
    );
  }

  const students = await getStudents(code);
  const visits = await getSchoolVisits(code, session.user.email);

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      {/* Back link */}
      <div className="mb-4">
        <Link href="/pm" className="text-sm text-gray-500 hover:text-gray-700">
          &larr; Back to Dashboard
        </Link>
      </div>

      {/* School Header */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{school.name}</h1>
            <p className="mt-1 text-gray-500">
              {school.district}, {school.state}
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Region: {school.region} | Code: {school.code}
            </p>
          </div>
          <Link
            href={`/pm/school/${code}/visit/new`}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
          >
            Start New Visit
          </Link>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-500">Students</div>
            <div className="text-2xl font-semibold">{students.length}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-500">Visits</div>
            <div className="text-2xl font-semibold">{visits.length}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-500">Last Visit</div>
            <div className="text-lg font-semibold">
              {visits.length > 0
                ? new Date(visits[0].visit_date).toLocaleDateString()
                : "Never"}
            </div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-500">In Progress</div>
            <div className="text-2xl font-semibold">
              {visits.filter((v) => v.status === "in_progress").length}
            </div>
          </div>
        </div>
      </div>

      {/* Visit History */}
      {visits.length > 0 && (
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Visit History</h2>
          <div className="space-y-3">
            {visits.map((visit) => (
              <div
                key={visit.id}
                className="flex justify-between items-center p-3 bg-gray-50 rounded-lg"
              >
                <div>
                  <span className="font-medium">
                    {new Date(visit.visit_date).toLocaleDateString()}
                  </span>
                  <span
                    className={`ml-3 inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      visit.status === "completed"
                        ? "bg-green-100 text-green-800"
                        : "bg-yellow-100 text-yellow-800"
                    }`}
                  >
                    {visit.status === "completed" ? "Completed" : "In Progress"}
                  </span>
                </div>
                <Link
                  href={`/pm/visits/${visit.id}`}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {visit.status === "completed" ? "View" : "Continue"}
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Students Table */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Students</h2>
            <span className="text-sm text-gray-500">{students.length} total</span>
          </div>
        </div>
        {students.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Student ID
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Gender
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Stream
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Contact
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.map((student) => (
                  <tr key={student.user_id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">
                        {student.first_name} {student.last_name}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.student_id || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.gender || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.category || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.stream || "-"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {student.phone || student.email || "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center text-gray-500">
            No students enrolled in this school.
          </div>
        )}
      </div>
    </main>
  );
}
