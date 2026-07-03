import { query } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  getAcademicMentorshipActorUserId,
  listAcademicMentorshipMappings,
  listAcademicMentorshipTeacherMentees,
  type AcademicMentorshipMappingGroup,
  type AcademicMentorshipTeacherMentee,
} from "@/lib/academic-mentorship";
import {
  getResolvedPermission,
  getProgramContextSync,
  getFeatureAccess,
  canAccessSchoolSync,
  hasMultipleSchools,
  PROGRAM_IDS,
  PROGRAM_IDS_ORDERED,
} from "@/lib/permissions";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { type Grade } from "@/components/StudentTable";
import { getSchoolRoster } from "@/lib/school-students";
import PageHeader from "@/components/PageHeader";
import SchoolTabs from "@/components/SchoolTabs";
import { Badge, Card } from "@/components/ui";
import CurriculumTab from "@/components/curriculum/CurriculumTab";
import PerformanceTab from "@/components/PerformanceTab";
import VisitsTab from "@/components/VisitsTab";
import { Batch } from "@/components/EditStudentModal";
import QuizSessionsTab from "@/components/quiz-sessions/QuizSessionsTab";
import TeacherFeedbackTab from "@/components/teacher-feedback/TeacherFeedbackTab";
import { buildProgramStats, type ProgramStats } from "@/lib/enrollment-stats";
import EnrollmentTabContent from "@/components/enrollment/EnrollmentTabContent";

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
  // Visible schools = the historical JNV set PLUS any school linked to an active
  // centre (the non-JNV centre rollout: Punjab CoE meritorious / EMRS). Mirrors
  // the dashboard `schoolScope` predicate so a school listed there also opens.
  const schools = await query<School>(
    `SELECT id, name, code, udise_code, district, state, region
     FROM school s
     WHERE (
         s.af_school_category = 'JNV'
         OR EXISTS (SELECT 1 FROM centres c WHERE c.school_id = s.id AND c.is_active)
       )
       AND (s.udise_code = $1 OR s.code = $1)`,
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
    [PROGRAM_IDS.NVS]
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

interface PageProps {
  params: Promise<{ udise: string }>;
}

function menteeMeta(grade: number | null, studentId: string | null): string {
  return [
    grade === null ? null : `Grade ${grade}`,
    studentId ? `ID ${studentId}` : null,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

function AcademicMentorshipFlatList({
  mentees,
}: {
  mentees: AcademicMentorshipTeacherMentee[];
}) {
  if (mentees.length === 0) {
    return (
      <Card elevation="sm" className="border-dashed p-8 text-center text-sm text-text-muted">
        <div className="font-semibold text-text-primary">
          No mentees assigned for this academic year.
        </div>
        <p className="mt-1">Assigned Students will appear here once mappings are active.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {mentees.map((mentee) => (
        <Card key={mentee.studentPkId} elevation="sm" className="p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-text-primary">{mentee.name}</div>
              <div className="mt-1 text-sm text-text-muted">
                {menteeMeta(mentee.grade, mentee.studentId) || "Student details unavailable"}
              </div>
            </div>
            {mentee.grade !== null ? (
              <Badge variant="default" className="shrink-0 font-mono">
                G{mentee.grade}
              </Badge>
            ) : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

function AcademicMentorshipGroupedOverview({
  groups,
}: {
  groups: AcademicMentorshipMappingGroup[];
}) {
  const activeGroups = groups
    .map((group) => ({
      ...group,
      mappings: group.mappings.filter((mapping) => mapping.status === "active"),
    }))
    .filter((group) => group.mappings.length > 0);

  if (activeGroups.length === 0) {
    return (
      <Card elevation="sm" className="border-dashed p-8 text-center text-sm text-text-muted">
        <div className="font-semibold text-text-primary">
          No active Academic Mentor-Mentee Mappings for this academic year.
        </div>
        <p className="mt-1">Use the admin page to add mappings for the selected School.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {activeGroups.map((group) => (
        <Card key={group.mentor.userId} elevation="sm" className="overflow-hidden p-0">
          <div className="flex flex-col gap-3 border-b border-border bg-bg-card-alt px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-text-primary">{group.mentor.name}</h3>
              {group.mentor.email && (
                <p className="text-sm text-text-muted">{group.mentor.email}</p>
              )}
            </div>
            <Badge variant="accent" className="w-fit font-mono">
              {group.mappings.length} {group.mappings.length === 1 ? "Mentee" : "Mentees"}
            </Badge>
          </div>
          <div className="divide-y divide-border">
            {group.mappings.map((mapping) => (
              <div
                key={mapping.id}
                className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <div>
                  <div className="font-medium text-text-primary">{mapping.mentee.name}</div>
                  <div className="mt-1 text-sm text-text-muted">
                    {mapping.mentee.grade === null
                      ? "Grade unavailable"
                      : `Grade ${mapping.mentee.grade}`}
                  </div>
                </div>
                {mapping.mentee.studentId ? (
                  <span className="font-mono text-xs text-text-muted">
                    {mapping.mentee.studentId}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function AcademicMentorshipSchoolTab({
  mode,
  mentees,
  groups,
  manageHref,
}: {
  mode: "teacher" | "overview";
  mentees?: AcademicMentorshipTeacherMentee[];
  groups?: AcademicMentorshipMappingGroup[];
  manageHref?: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
            Academic Mentorship
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
            <span>Current academic year: {CURRENT_ACADEMIC_YEAR}</span>
            <Badge variant={mode === "teacher" ? "info" : "default"}>
              {mode === "teacher" ? "My mentees" : "School overview"}
            </Badge>
          </div>
        </div>
        {manageHref && (
          <Link
            href={manageHref}
            className="inline-flex min-h-10 w-fit items-center justify-center rounded-lg bg-accent px-4 py-2 text-sm font-bold text-white hover:bg-accent-hover"
          >
            Manage mappings
          </Link>
        )}
      </div>
      {mode === "teacher" ? (
        <AcademicMentorshipFlatList mentees={mentees ?? []} />
      ) : (
        <AcademicMentorshipGroupedOverview groups={groups ?? []} />
      )}
    </section>
  );
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
          <Card elevation="xl" className="p-8 max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">
              Access Denied
            </h1>
            <p className="text-gray-600 mb-4">
              Your passcode only grants access to a different school.
            </p>
            <Link href="/" className="text-accent hover:text-accent-hover">
              Return to login
            </Link>
          </Card>
        </div>
      );
    }
  }

  // Single DB call for permission — reuse everywhere
  const permission = !isPasscodeUser && session.user?.email
    ? await getResolvedPermission(session.user.email)
    : null;

  // For Google users, check school access
  if (!isPasscodeUser) {
    if (!permission) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Card elevation="xl" className="p-8 max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">
              Access Denied
            </h1>
            <p className="text-gray-600 mb-4">
              You don&apos;t have permission to view this school.
            </p>
            <Link
              href="/dashboard"
              className="text-accent hover:text-accent-hover"
            >
              Return to dashboard
            </Link>
          </Card>
        </div>
      );
    }

    if (!canAccessSchoolSync(permission, school.code, school.region || undefined)) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <Card elevation="xl" className="p-8 max-w-md text-center">
            <h1 className="text-xl font-bold text-red-600 mb-2">
              Access Denied
            </h1>
            <p className="text-gray-600 mb-4">
              You don&apos;t have permission to view this school.
            </p>
            <Link
              href="/dashboard"
              className="text-accent hover:text-accent-hover"
            >
              Return to dashboard
            </Link>
          </Card>
        </div>
      );
    }
  }

  // Derive everything from the single permission object — no extra DB calls
  const programContext = getProgramContextSync(permission);

  if (!isPasscodeUser && !programContext.hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card elevation="xl" className="p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">
            No Program Access
          </h1>
          <p className="text-gray-600 mb-4">
            You are not assigned to any programs. Please contact an administrator.
          </p>
          <Link
            href="/dashboard"
            className="text-accent hover:text-accent-hover"
          >
            Return to dashboard
          </Link>
        </Card>
      </div>
    );
  }

  // Derive feature access from the permission matrix
  const opts = { isPasscodeUser };
  const studentsAccess = getFeatureAccess(permission, "students", opts);
  const curriculumAccess = getFeatureAccess(permission, "curriculum", opts);
  const performanceAccess = getFeatureAccess(permission, "performance", opts);
  const mentorshipAccess = getFeatureAccess(permission, "academic_mentorship", opts);
  const visitsAccess = getFeatureAccess(permission, "visits", opts);
  const quizSessionsAccess = getFeatureAccess(permission, "quiz_sessions", opts);
  const teacherFeedbackAccess = getFeatureAccess(permission, "teacher_feedback", opts);

  // Fetch enrollment data in parallel (other tabs lazy-load their own data).
  // getSchoolRoster is the canonical student list (query + dedup + issues),
  // shared with the Performance deep-dive so both surfaces always agree.
  const [{ students: dedupedStudents, issues: dataIssues }, grades, batches] =
    await Promise.all([
      getSchoolRoster(school.id),
      getGrades(),
      getBatchesWithMetadata(),
    ]);

  // Separate active and dropout students (all students visible; editability is per-row)
  const activeStudents = dedupedStudents.filter((s) => s.status !== "dropout");
  const dropoutStudents = dedupedStudents.filter((s) => s.status === "dropout");

  // Extract distinct streams from NVS batches
  const nvsStreams = getDistinctNVSStreams(batches);

  // Programs that have at least one active student at this school
  const programsWithStudents = new Set(
    activeStudents
      .map((s) => (s.program_id != null ? Number(s.program_id) : null))
      .filter((v): v is number => v != null)
  );

  // Programs the user is allowed to see for the enrollment cards.
  // Admins + passcode users see every program present at the school; everyone
  // else sees the intersection of their effective programs with what's here.
  // Effective = explicit program_ids ∪ seat-derived (programContext.programIds),
  // so a teacher seated at a centre sees that centre's program even when their
  // explicit program_ids is empty.
  const isAdmin = permission?.role === "admin";
  const visibleProgramIds = (isPasscodeUser || isAdmin
    ? PROGRAM_IDS_ORDERED
    : programContext.programIds
  ).filter((id) => programsWithStudents.has(id));

  const programStatsList: ProgramStats[] = visibleProgramIds.map((id) =>
    buildProgramStats(activeStudents, id)
  );

  // Check if user has access to multiple schools (to show/hide back arrow)
  const multipleSchools = !isPasscodeUser && hasMultipleSchools(permission);

  const subtitle = `${school.district}, ${school.state} | Code: ${school.code}${school.udise_code ? ` | UDISE: ${school.udise_code}` : ""}`;

  // Determine back link based on role
  const backHref = multipleSchools ? "/dashboard" : undefined;

  // Build tabs
  const enrollmentContent = (
    <div>
      {/* Data Issues Banner */}
      {dataIssues.length > 0 && (
        <div className="max-w-3xl mx-auto mb-4">
          <details className="bg-amber-50 border border-amber-200 rounded-lg">
            <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-amber-800 hover:bg-amber-100 rounded-lg transition-colors">
              {dataIssues.length} data {dataIssues.length === 1 ? "issue" : "issues"} found
            </summary>
            <div className="px-4 pb-3 space-y-2">
              {dataIssues.map((issue) => (
                <div key={issue.groupUserId} className="flex items-start gap-2 text-sm text-amber-700">
                  <span className="shrink-0 mt-0.5 w-4 h-4 text-amber-500">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                  </span>
                  <span><strong>{issue.studentName}</strong>: {issue.details}</span>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      {/* Per-program enrollment stats + student table (both filtered by selected program) */}
      <EnrollmentTabContent
        programs={programStatsList}
        activeStudents={activeStudents}
        dropoutStudents={dropoutStudents}
        canEdit={studentsAccess.canEdit}
        userProgramIds={isPasscodeUser ? null : programContext.programIds}
        isPasscodeUser={isPasscodeUser ?? false}
        isAdmin={isAdmin}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
      />
    </div>
  );

  const performanceContent = (
    <PerformanceTab schoolUdise={school.udise_code || school.code} />
  );

  const schoolId = Number(school.id);
  const isAcademicMentorshipManager =
    permission?.role === "admin" || permission?.role === "program_admin";
  const mentorshipManageHref = isAcademicMentorshipManager
    ? `/admin/academic-mentorship?${new URLSearchParams({
        school_code: school.code,
        academic_year: CURRENT_ACADEMIC_YEAR,
      }).toString()}`
    : undefined;
  const teacherMentorUserId =
    mentorshipAccess.canView && permission?.role === "teacher"
      ? await getAcademicMentorshipActorUserId(permission.email, permission)
      : null;
  const teacherMentees =
    teacherMentorUserId !== null
      ? await listAcademicMentorshipTeacherMentees({
          schoolId,
          academicYear: CURRENT_ACADEMIC_YEAR,
          mentorUserId: teacherMentorUserId,
        })
      : null;
  const mentorshipGroups =
    mentorshipAccess.canView && permission?.role !== "teacher"
      ? await listAcademicMentorshipMappings({
          schoolId,
          academicYear: CURRENT_ACADEMIC_YEAR,
          includeHistory: false,
        })
      : null;
  const mentorshipContent = (
    <AcademicMentorshipSchoolTab
      mode={permission?.role === "teacher" ? "teacher" : "overview"}
      mentees={teacherMentees ?? undefined}
      groups={mentorshipGroups ?? undefined}
      manageHref={mentorshipManageHref}
    />
  );

  const visitsContent = (
    <VisitsTab schoolCode={school.code} canEdit={visitsAccess.canEdit} />
  );

  const quizSessionsContent = (
    <QuizSessionsTab schoolId={school.id} canEdit={quizSessionsAccess.canEdit} />
  );

  const teacherFeedbackContent = (
    <TeacherFeedbackTab
      schoolId={school.id}
      schoolCode={school.code}
      canEdit={teacherFeedbackAccess.canEdit}
    />
  );

  const curriculumContent = (
    <CurriculumTab
      schoolCode={school.code}
      schoolName={school.name}
      canEdit={curriculumAccess.canEdit}
    />
  );

  // Tab visibility driven by feature permission matrix
  const tabs = [
    { id: "enrollment", label: "Enrollment", content: enrollmentContent },
    ...(curriculumAccess.canView ? [{ id: "curriculum", label: "Curriculum", content: curriculumContent }] : []),
    ...(performanceAccess.canView ? [{ id: "performance", label: "Performance", content: performanceContent }] : []),
    ...(quizSessionsAccess.canView ? [{ id: "quiz_sessions", label: "Quiz Sessions", content: quizSessionsContent }] : []),
    ...(teacherFeedbackAccess.canView ? [{ id: "teacher_feedback", label: "Teacher Feedback", content: teacherFeedbackContent }] : []),
    ...(mentorshipAccess.canView ? [{ id: "mentorship", label: "Mentorship", content: mentorshipContent }] : []),
    ...(visitsAccess.canView ? [{ id: "visits", label: "School Visits", content: visitsContent }] : []),
  ];

  return (
    <div className="min-h-screen bg-bg">
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
