import { query } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessSchool } from "@/lib/permissions";

interface Student {
  group_user_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  student_id: string | null;
  category: string | null;
  stream: string | null;
  gender: string | null;
}

interface School {
  id: string;
  name: string;
  code: string;
  udise_code: string | null;
  district: string;
  state: string;
  region: string | null;
}

async function getSchoolByCode(code: string): Promise<School | null> {
  const schools = await query<School>(
    `SELECT id, name, code, udise_code, district, state, region
     FROM school
     WHERE udise_code = $1 OR code = $1`,
    [code]
  );
  return schools[0] || null;
}

async function getStudents(schoolId: string): Promise<Student[]> {
  return query<Student>(
    `SELECT
      gu.id as group_user_id,
      u.id as user_id,
      u.first_name,
      u.last_name,
      u.phone,
      u.email,
      u.gender,
      s.student_id,
      s.category,
      s.stream
    FROM group_user gu
    JOIN "group" g ON gu.group_id = g.id
    JOIN "user" u ON gu.user_id = u.id
    LEFT JOIN student s ON s.user_id = u.id
    WHERE g.type = 'school' AND g.child_id = $1
    ORDER BY u.first_name, u.last_name`,
    [schoolId]
  );
}

interface PageProps {
  params: Promise<{ udise: string }>;
}

export default async function SchoolPage({ params }: PageProps) {
  const session = await getServerSession(authOptions);
  const { udise } = await params;

  if (!session) {
    redirect("/");
  }

  const school = await getSchoolByCode(udise);

  if (!school) {
    notFound();
  }

  // Check permissions
  const isPasscodeUser = (session as any).isPasscodeUser;
  const passcodeSchoolCode = (session as any).schoolCode;

  // For passcode users, only allow access to their school
  if (isPasscodeUser) {
    if (passcodeSchoolCode !== school.code) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">Access Denied</h1>
            <p className="text-gray-600 mb-4">
              Your passcode only grants access to a different school.
            </p>
            <Link href="/" className="text-blue-600 hover:text-blue-800">
              Return to login
            </Link>
          </div>
        </div>
      );
    }
  } else {
    // For Google users, check permissions
    const hasAccess = canAccessSchool(
      session.user?.email || null,
      school.code,
      school.region || undefined
    );

    if (!hasAccess) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">Access Denied</h1>
            <p className="text-gray-600 mb-4">
              You don&apos;t have permission to view this school.
            </p>
            <Link href="/dashboard" className="text-blue-600 hover:text-blue-800">
              Return to dashboard
            </Link>
          </div>
        </div>
      );
    }
  }

  const students = await getStudents(school.id);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href={isPasscodeUser ? "/" : "/dashboard"}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">{school.name}</h1>
                <p className="mt-1 text-sm text-gray-500">
                  {school.district}, {school.state} | Code: {school.code}
                  {school.udise_code && ` | UDISE: ${school.udise_code}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">
                {isPasscodeUser ? `School ${passcodeSchoolCode}` : session.user?.email}
              </span>
              <Link
                href="/api/auth/signout"
                className="text-sm text-red-600 hover:text-red-800"
              >
                Sign out
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            Students ({students.length})
          </h2>
        </div>

        <div className="overflow-hidden bg-white shadow ring-1 ring-black ring-opacity-5 sm:rounded-lg">
          <table className="min-w-full divide-y divide-gray-300">
            <thead className="bg-gray-50">
              <tr>
                <th className="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-gray-900 sm:pl-6">
                  Name
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Student ID
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Phone
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Gender
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Category
                </th>
                <th className="px-3 py-3.5 text-left text-sm font-semibold text-gray-900">
                  Stream
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {students.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-gray-500">
                    No students enrolled in this school
                  </td>
                </tr>
              ) : (
                students.map((student) => (
                  <tr key={student.group_user_id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-gray-900 sm:pl-6">
                      {[student.first_name, student.last_name]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {student.student_id || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {student.phone || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      {student.gender || "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500">
                      <span
                        className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                          student.category === "Gen"
                            ? "bg-green-100 text-green-800"
                            : student.category === "OBC"
                            ? "bg-blue-100 text-blue-800"
                            : student.category === "SC"
                            ? "bg-purple-100 text-purple-800"
                            : student.category === "ST"
                            ? "bg-orange-100 text-orange-800"
                            : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {student.category || "—"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-4 text-sm text-gray-500 capitalize">
                      {student.stream || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
