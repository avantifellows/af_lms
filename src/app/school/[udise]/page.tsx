import { query } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getUserPermission,
  getProgramContextSync,
} from "@/lib/permissions";
import StudentTable, { Grade } from "@/components/StudentTable";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import SchoolTabs from "@/components/SchoolTabs";
import CurriculumTab from "@/components/curriculum/CurriculumTab";
import PerformanceTab from "@/components/PerformanceTab";
import VisitsTab from "@/components/VisitsTab";
import { Batch } from "@/components/EditStudentModal";
import { JNV_NVS_PROGRAM_ID } from "@/lib/constants";

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
  }

  // Single DB call for permission — reuse everywhere
  const permission = !isPasscodeUser && session.user?.email
    ? await getUserPermission(session.user.email)
    : null;

  // For Google users, check school access
  if (!isPasscodeUser) {
    if (!permission) {
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

    // Check school access using permission object directly
    let hasAccess = false;
    switch (permission.level) {
      case 4:
      case 3:
        hasAccess = true;
        break;
      case 2:
        hasAccess = permission.regions?.includes(school.region || "") || false;
        break;
      case 1:
        hasAccess = permission.school_codes?.includes(school.code) || false;
        break;
    }

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

  // Derive everything from the single permission object — no extra DB calls
  const programContext = getProgramContextSync(permission);

  if (!isPasscodeUser && !programContext.hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-8 rounded-lg shadow-lg max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">
            No Program Access
          </h1>
          <p className="text-gray-600 mb-4">
            You are not assigned to any programs. Please contact an administrator.
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

  const isPM = permission?.role === "program_manager" || permission?.role === "admin";
  const userIsAdmin = permission?.level === 4;
  const canEdit = isPasscodeUser ? true : (permission !== null && !permission.read_only);
  const canEditCurriculumFlag = isPasscodeUser ? true : (
    permission?.role === "admin" ||
    (permission?.role === "teacher" && !permission.read_only && programContext.hasCoEOrNodal)
  );

  // Fetch enrollment data in parallel (other tabs lazy-load their own data)
  const [allStudents, grades, batches] = await Promise.all([
    getStudents(school.id),
    getGrades(),
    getBatchesWithMetadata(),
  ]);

  // Separate active and dropout students
  let activeStudents = allStudents.filter((s) => s.status !== "dropout");
  let dropoutStudents = allStudents.filter((s) => s.status === "dropout");

  // Filter students by program if needed (NVS-only users see only NVS students)
  const studentProgramFilter = programContext.isNVSOnly ? programContext.programIds : null;
  if (studentProgramFilter !== null && studentProgramFilter.length > 0) {
    activeStudents = activeStudents.filter(
      (s) => s.program_id && studentProgramFilter!.includes(Number(s.program_id))
    );
    dropoutStudents = dropoutStudents.filter(
      (s) => s.program_id && studentProgramFilter!.includes(Number(s.program_id))
    );
  }

  // Extract distinct streams from NVS batches
  const nvsStreams = getDistinctNVSStreams(batches);

  // Calculate NVS student counts by grade
  const nvsStudents = activeStudents.filter(
    (s) => Number(s.program_id) === JNV_NVS_PROGRAM_ID
  );
  const totalNVSCount = nvsStudents.length;

  // Group by grade
  const gradeCounts = nvsStudents.reduce((acc, student) => {
    const grade = student.grade;
    if (grade !== null) {
      acc[grade] = (acc[grade] || 0) + 1;
    }
    return acc;
  }, {} as Record<number, number>);

  // Sort grades and create array
  const gradeCountsArray = Object.entries(gradeCounts)
    .map(([grade, count]) => ({ grade: parseInt(grade), count }))
    .sort((a, b) => a.grade - b.grade);

  // Check if user has access to multiple schools (to show/hide back arrow)
  let hasMultipleSchools = false;
  if (!isPasscodeUser && permission) {
    hasMultipleSchools = permission.level >= 2 ||
      (permission.school_codes !== null && (permission.school_codes?.length ?? 0) > 1);
  }

  const subtitle = `${school.district}, ${school.state} | Code: ${school.code}${school.udise_code ? ` | UDISE: ${school.udise_code}` : ""}`;

  // Determine back link based on role
  const backHref = hasMultipleSchools ? "/dashboard" : undefined;

  // Build tabs
  const enrollmentContent = (
    <div>
      {/* NVS Student Stats */}
      <div className="bg-white shadow rounded-lg p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">NVS Program Students</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <StatCard label="Total NVS" value={totalNVSCount} />
          {gradeCountsArray.map((gc) => (
            <StatCard key={gc.grade} label={`Grade ${gc.grade}`} value={gc.count} size="sm" />
          ))}
        </div>
      </div>

      <StudentTable
        students={activeStudents}
        dropoutStudents={dropoutStudents}
        canEdit={canEdit}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
      />
    </div>
  );

  const performanceContent = (
    <PerformanceTab schoolUdise={school.udise_code || school.code} />
  );

  const mentorshipContent = (
    <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
      <p className="text-gray-500">Mentorship data coming soon.</p>
    </div>
  );

  const visitsContent = (
    <VisitsTab schoolCode={school.code} />
  );

  const curriculumContent = (
    <CurriculumTab
      schoolCode={school.code}
      schoolName={school.name}
      canEdit={canEditCurriculumFlag}
    />
  );

  // Only admins can see tabs other than Enrollment (rolling out slowly)
  const tabs = [
    { id: "enrollment", label: "Enrollment", content: enrollmentContent },
    ...(userIsAdmin ? [{ id: "curriculum", label: "Curriculum", content: curriculumContent }] : []),
    ...(userIsAdmin ? [{ id: "performance", label: "Performance", content: performanceContent }] : []),
    ...(userIsAdmin ? [{ id: "mentorship", label: "Mentorship", content: mentorshipContent }] : []),
    ...(userIsAdmin && isPM ? [{ id: "visits", label: "School Visits", content: visitsContent }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <PageHeader
        title={school.name}
        subtitle={subtitle}
        backHref={backHref}
        userEmail={isPasscodeUser ? `School ${passcodeSchoolCode}` : session.user?.email || undefined}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SchoolTabs tabs={tabs} defaultTab="enrollment" />
      </main>
    </div>
  );
}
