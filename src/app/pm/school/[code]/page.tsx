import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canAccessSchool, canEditStudents, getUserPermission } from "@/lib/permissions";
import { query } from "@/lib/db";
import Link from "next/link";
import StudentTable, { Grade } from "@/components/StudentTable";
import SchoolHeader from "@/components/SchoolHeader";
import { Batch } from "@/components/EditStudentModal";
import { JNV_NVS_PROGRAM_ID } from "@/lib/constants";

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
  program_id: number | null;
  grade: number | null;
  grade_id: string | null;
  status: string | null;
  updated_at: string | null;
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
  return query<Grade>(
    `SELECT gr.id, gr.number, g.id as group_id
     FROM grade gr
     JOIN "group" g ON g.child_id = gr.id AND g.type = 'grade'
     ORDER BY gr.number`,
    []
  );
}

// Fetch NVS program batches with metadata and group_ids for stream change functionality
async function getBatchesWithMetadata(): Promise<Batch[]> {
  const batches = await query<{
    id: number;
    name: string;
    batch_id: string;
    program_id: number;
    metadata: { stream?: string; grade?: number } | null;
    group_id: string;
  }>(
    `SELECT b.id, b.name, b.batch_id, b.program_id, b.metadata, g.id as group_id
     FROM batch b
     JOIN "group" g ON g.child_id = b.id AND g.type = 'batch'
     WHERE b.metadata IS NOT NULL AND b.program_id = $1
     ORDER BY b.name`,
    [JNV_NVS_PROGRAM_ID]
  );
  return batches;
}

// Extract distinct streams from NVS program batches
function getDistinctNVSStreams(batches: Batch[]): string[] {
  const streams = new Set<string>();
  batches.forEach((b) => {
    if (b.metadata?.stream) {
      streams.add(b.metadata.stream);
    }
  });
  return Array.from(streams).sort();
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
      er_grade.group_id as grade_id,
      gr.number as grade,
      p.program_name,
      p.program_id,
      GREATEST(s.updated_at, u.updated_at) as updated_at
    FROM group_user gu
    JOIN "group" g ON gu.group_id = g.id
    JOIN "user" u ON gu.user_id = u.id
    LEFT JOIN student s ON s.user_id = u.id
    LEFT JOIN enrollment_record er_grade ON er_grade.user_id = u.id
      AND er_grade.group_type = 'grade'
      AND er_grade.is_current = true
    LEFT JOIN grade gr ON er_grade.group_id = gr.id
    LEFT JOIN LATERAL (
      SELECT p.name as program_name, p.id as program_id
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

  const [allStudents, grades, visits, batches] = await Promise.all([
    getStudents(school.id),
    getGrades(),
    getSchoolVisits(code, session.user.email),
    getBatchesWithMetadata(),
  ]);

  // Separate active and dropout students
  const activeStudents = allStudents.filter((s) => s.status !== "dropout");
  const dropoutStudents = allStudents.filter((s) => s.status === "dropout");

  // Extract distinct streams from NVS batches
  const nvsStreams = getDistinctNVSStreams(batches);

  // Check if user can edit students
  const canEdit = await canEditStudents(session.user.email);

  const stats = [
    { label: "Active Students", value: activeStudents.length },
    { label: "Dropout", value: dropoutStudents.length },
    { label: "Visits", value: visits.length },
    {
      label: "Last Visit",
      value: visits.length > 0
        ? new Date(visits[0].visit_date).toLocaleDateString()
        : "Never",
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <SchoolHeader
        school={school}
        stats={stats}
        backHref="/pm"
        actions={
          <Link
            href={`/pm/school/${code}/visit/new`}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700"
          >
            Start New Visit
          </Link>
        }
      />

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

      {/* Students */}
      <StudentTable
        students={activeStudents}
        dropoutStudents={dropoutStudents}
        canEdit={canEdit}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
      />
    </main>
  );
}
