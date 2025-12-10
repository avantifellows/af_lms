import { query } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  canAccessSchool,
  canEditStudents,
  getAccessibleSchoolCodes,
} from "@/lib/permissions";
import StudentTable, { Grade } from "@/components/StudentTable";
import PageHeader from "@/components/PageHeader";

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
     WHERE af_school_category = 'JNV'
       AND (udise_code = $1 OR code = $1)`,
    [code],
  );
  return schools[0] || null;
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
    [schoolId],
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
  const isPasscodeUser = session.isPasscodeUser;
  const passcodeSchoolCode = session.schoolCode;

  // For passcode users, only allow access to their school
  if (isPasscodeUser) {
    if (passcodeSchoolCode !== school.code) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">
              Access Denied
            </h1>
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
    const hasAccess = await canAccessSchool(
      session.user?.email || null,
      school.code,
      school.region || undefined,
    );

    if (!hasAccess) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">
              Access Denied
            </h1>
            <p className="text-gray-600 mb-4">
              You don&apos;t have permission to view this school.
            </p>
            <Link
              href="/dashboard"
              className="text-blue-600 hover:text-blue-800"
            >
              Return to dashboard
            </Link>
          </div>
        </div>
      );
    }
  }

  const allStudents = await getStudents(school.id);
  const grades = await getGrades();

  // Separate active and dropout students
  const activeStudents = allStudents.filter((s) => s.status !== "dropout");
  const dropoutStudents = allStudents.filter((s) => s.status === "dropout");

  // Check if user can edit students (not read-only)
  const canEdit = isPasscodeUser
    ? true // Passcode users can edit by default
    : await canEditStudents(session.user?.email || "");

  // Check if user has access to multiple schools (to show/hide back arrow)
  let hasMultipleSchools = false;
  if (!isPasscodeUser) {
    const accessibleSchools = await getAccessibleSchoolCodes(
      session.user?.email || "",
    );
    hasMultipleSchools =
      accessibleSchools === "all" || accessibleSchools.length > 1;
  }

  const subtitle = `${school.district}, ${school.state} | Code: ${school.code}${school.udise_code ? ` | UDISE: ${school.udise_code}` : ""}`;

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title={school.name}
        subtitle={subtitle}
        backHref={hasMultipleSchools ? "/dashboard" : undefined}
        userEmail={isPasscodeUser ? `School ${passcodeSchoolCode}` : session.user?.email || undefined}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
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
    </div>
  );
}
