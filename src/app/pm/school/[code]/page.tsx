import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessSchool, canEditStudents, getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import StudentTable, { Grade } from "@/components/StudentTable";

interface School {
  id: string;
  code: string;
  name: string;
  udise_code: string | null;
  district: string;
  state: string;
  region: string | null;
}

interface Student {
  group_user_id: string;
  user_id: string;
  student_pk_id: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  date_of_birth: string | null;
  student_id: string | null;
  apaar_id: string | null;
  category: string | null;
  stream: string | null;
  gender: string | null;
  program_name: string | null;
  grade: number | null;
  grade_id: string | null;
  status: string | null;
}

interface Visit {
  id: number;
  visit_date: string;
  status: string;
  created_at: string;
}

async function getSchool(code: string): Promise<School | null> {
  const results = await query<School>(
    `SELECT id, code, name, udise_code, district, state, region
     FROM school
     WHERE code = $1`,
    [code]
  );
  return results[0] || null;
}

async function getGrades(): Promise<Grade[]> {
  return query<Grade>(`SELECT id, number FROM grade ORDER BY number`, []);
}

async function getStudents(schoolId: string): Promise<Student[]> {
  return query<Student>(
    `SELECT
      gu.id as group_user_id,
      u.id as user_id,
      s.id as student_pk_id,
      u.first_name,
      u.last_name,
      u.phone,
      u.email,
      u.date_of_birth,
      u.gender,
      s.student_id,
      s.apaar_id,
      s.category,
      s.stream,
      s.status,
      s.grade_id,
      gr.number as grade,
      p.name as program_name
    FROM group_user gu
    JOIN "group" g ON gu.group_id = g.id
    JOIN "user" u ON gu.user_id = u.id
    LEFT JOIN student s ON s.user_id = u.id
    LEFT JOIN grade gr ON s.grade_id = gr.id
    LEFT JOIN LATERAL (
      SELECT p.name
      FROM group_user gu_batch
      JOIN "group" g_batch ON gu_batch.group_id = g_batch.id AND g_batch.type = 'batch'
      JOIN batch b ON g_batch.child_id = b.id
      JOIN program p ON b.program_id = p.id
      WHERE gu_batch.user_id = u.id
      LIMIT 1
    ) p ON true
    WHERE g.type = 'school' AND g.child_id = $1
    ORDER BY gr.number, u.first_name, u.last_name`,
    [schoolId]
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

  const canAccess = await canAccessSchool(session.user.email, school.code, school.region || undefined);
  if (!canAccess) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-yellow-800">You do not have access to this school.</p>
        </div>
      </main>
    );
  }

  const [allStudents, grades, visits] = await Promise.all([
    getStudents(school.id),
    getGrades(),
    getSchoolVisits(code, session.user.email),
  ]);

  // Separate active and dropout students
  const activeStudents = allStudents.filter((s) => s.status !== "dropout");
  const dropoutStudents = allStudents.filter((s) => s.status === "dropout");

  // Check if user can edit students
  const canEdit = await canEditStudents(session.user.email);

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
              Code: {school.code}
              {school.udise_code && ` | UDISE: ${school.udise_code}`}
              {school.region && ` | Region: ${school.region}`}
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
            <div className="text-sm text-gray-500">Active Students</div>
            <div className="text-2xl font-semibold">{activeStudents.length}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="text-sm text-gray-500">Dropout</div>
            <div className="text-2xl font-semibold">{dropoutStudents.length}</div>
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

      {/* Active Students */}
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-gray-900">
          Active Students ({activeStudents.length})
        </h2>
      </div>

      <StudentTable
        students={activeStudents}
        canEdit={canEdit}
        grades={grades}
      />

      {/* Dropout Students */}
      {dropoutStudents.length > 0 && (
        <>
          <div className="mt-10 mb-4">
            <h2 className="text-xl font-semibold text-gray-900">
              Dropout Students ({dropoutStudents.length})
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Students marked as dropout
            </p>
          </div>

          <StudentTable
            students={dropoutStudents}
            canEdit={canEdit}
            grades={grades}
          />
        </>
      )}
    </main>
  );
}
