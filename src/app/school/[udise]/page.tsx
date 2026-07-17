import { query } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession, type Session } from "next-auth";
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
  type FeatureAccessResult,
  type ProgramPermissionContext,
  type UserPermission,
} from "@/lib/permissions";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { type Grade, type Student } from "@/components/StudentTable";
import { getSchoolRoster } from "@/lib/school-students";
import { type DataIssue } from "@/lib/school-student-list-data-issues";
import PageHeader from "@/components/PageHeader";
import SchoolTabs from "@/components/SchoolTabs";
import { Badge, Card } from "@/components/ui";
import CurriculumTab from "@/components/curriculum/CurriculumTab";
import PerformanceTab from "@/components/PerformanceTab";
import VisitsTab from "@/components/VisitsTab";
import { Batch } from "@/components/EditStudentModal";
import QuizSessionsTab from "@/components/quiz-sessions/QuizSessionsTab";
import { buildProgramStats } from "@/lib/enrollment-stats";
import EnrollmentTabContent from "@/components/enrollment/EnrollmentTabContent";
import HolisticMentorshipWorkspace from "@/components/holistic-mentorship/HolisticMentorshipWorkspace";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipSession,
} from "@/lib/holistic-mentorship";
import { type ReactNode } from "react";

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

function SchoolAccessMessage({
  title,
  message,
  href,
}: {
  title: string;
  message: string;
  href: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card elevation="xl" className="max-w-md p-8 text-center">
        <h1 className="mb-2 text-xl font-bold text-red-600">{title}</h1>
        <p className="mb-4 text-gray-600">{message}</p>
        <Link href={href} className="text-accent hover:text-accent-hover">
          {href === "/" ? "Return to login" : "Return to dashboard"}
        </Link>
      </Card>
    </div>
  );
}

async function resolveSchoolPermission(
  session: Session
): Promise<UserPermission | null> {
  if (session.isPasscodeUser || !session.user?.email) return null;
  return getResolvedPermission(session.user.email);
}

function getSchoolIdentityAccessMessage(
  session: Session,
  permission: UserPermission | null,
  school: School
): ReactNode | null {
  if (session.isPasscodeUser && session.schoolCode !== school.code) {
    return (
      <SchoolAccessMessage
        title="Access Denied"
        message="Your passcode only grants access to a different school."
        href="/"
      />
    );
  }
  if (
    !session.isPasscodeUser &&
    (!permission || !canAccessSchoolSync(permission, school.code, school.region || undefined))
  ) {
    return (
      <SchoolAccessMessage
        title="Access Denied"
        message="You don't have permission to view this school."
        href="/dashboard"
      />
    );
  }
  return null;
}

function getProgramAccessMessage(
  session: Session,
  programContext: ProgramPermissionContext
): ReactNode | null {
  if (session.isPasscodeUser || programContext.hasAccess) return null;
  return (
    <SchoolAccessMessage
      title="No Program Access"
      message="You are not assigned to any programs. Please contact an administrator."
      href="/dashboard"
    />
  );
}

function redirectHolisticMentorshipAdmin(permission: UserPermission | null): void {
  if (permission?.role === "holistic_mentorship_admin") {
    redirect("/admin/holistic-mentorship");
  }
}

function getSchoolNavigation(
  session: Session,
  permission: UserPermission | null
): { backHref?: string; userEmail?: string } {
  const multipleSchools = !session.isPasscodeUser && hasMultipleSchools(permission);
  return {
    backHref: multipleSchools ? "/dashboard" : undefined,
    userEmail: session.isPasscodeUser
      ? `School ${session.schoolCode}`
      : session.user?.email || undefined,
  };
}

function EnrollmentSchoolTab({
  students,
  dataIssues,
  studentsAccess,
  programContext,
  isPasscodeUser,
  isAdmin,
  grades,
  batches,
  nvsStreams,
  schoolCode,
}: {
  students: Student[];
  dataIssues: DataIssue[];
  studentsAccess: FeatureAccessResult;
  programContext: ProgramPermissionContext;
  isPasscodeUser: boolean;
  isAdmin: boolean;
  grades: Grade[];
  batches: Batch[];
  nvsStreams: string[];
  schoolCode: string;
}) {
  const activeStudents = students.filter((student) => student.status !== "dropout");
  const dropoutStudents = students.filter((student) => student.status === "dropout");
  const programsWithStudents = new Set<number>();
  for (const student of activeStudents) {
    if (student.program_id !== null) programsWithStudents.add(Number(student.program_id));
  }
  const candidatePrograms = isPasscodeUser || isAdmin
    ? PROGRAM_IDS_ORDERED
    : programContext.programIds;
  const programStatsList = candidatePrograms
    .filter((id) => programsWithStudents.has(id))
    .map((id) => buildProgramStats(activeStudents, id));

  return (
    <div>
      {dataIssues.length > 0 && (
        <div className="mb-4">
          <details className="rounded-lg border border-amber-200 bg-amber-50">
            <summary className="cursor-pointer rounded-lg px-4 py-3 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-100">
              {dataIssues.length} data {dataIssues.length === 1 ? "issue" : "issues"} found
            </summary>
            <div className="space-y-2 px-4 pb-3">
              {dataIssues.map((issue) => (
                <div key={issue.groupUserId} className="flex items-start gap-2 text-sm text-amber-700">
                  <span className="mt-0.5 h-4 w-4 shrink-0 text-amber-500">
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
      <EnrollmentTabContent
        programs={programStatsList}
        activeStudents={activeStudents}
        dropoutStudents={dropoutStudents}
        canEdit={studentsAccess.canEdit}
        userProgramIds={isPasscodeUser ? null : programContext.programIds}
        isPasscodeUser={isPasscodeUser}
        isAdmin={isAdmin}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
        schoolCode={schoolCode}
      />
    </div>
  );
}

function academicMentorshipManageHref(
  permission: UserPermission | null,
  schoolCode: string
): string | undefined {
  if (permission?.role !== "admin" && permission?.role !== "program_admin") return undefined;
  return `/admin/academic-mentorship?${new URLSearchParams({
    school_code: schoolCode,
    academic_year: CURRENT_ACADEMIC_YEAR,
  }).toString()}`;
}

async function loadAcademicTeacherMentees(
  permission: UserPermission | null,
  canView: boolean,
  schoolId: number
): Promise<AcademicMentorshipTeacherMentee[] | undefined> {
  if (!canView || permission?.role !== "teacher") return undefined;
  const mentorUserId = await getAcademicMentorshipActorUserId(permission.email, permission);
  if (mentorUserId === null) return undefined;
  return listAcademicMentorshipTeacherMentees({
    schoolId,
    academicYear: CURRENT_ACADEMIC_YEAR,
    mentorUserId,
  });
}

async function loadAcademicMentorshipGroups(
  permission: UserPermission | null,
  canView: boolean,
  schoolId: number
): Promise<AcademicMentorshipMappingGroup[] | undefined> {
  if (!canView || permission?.role === "teacher") return undefined;
  return listAcademicMentorshipMappings({
    schoolId,
    academicYear: CURRENT_ACADEMIC_YEAR,
    includeHistory: false,
  });
}

async function buildAcademicMentorshipContent({
  permission,
  canView,
  school,
}: {
  permission: UserPermission | null;
  canView: boolean;
  school: School;
}): Promise<ReactNode> {
  const schoolId = Number(school.id);
  const [mentees, groups] = await Promise.all([
    loadAcademicTeacherMentees(permission, canView, schoolId),
    loadAcademicMentorshipGroups(permission, canView, schoolId),
  ]);

  return (
    <AcademicMentorshipSchoolTab
      mode={permission?.role === "teacher" ? "teacher" : "overview"}
      mentees={mentees}
      groups={groups}
      manageHref={academicMentorshipManageHref(permission, school.code)}
    />
  );
}

type SchoolTab = { id: string; label: string; content: ReactNode };

async function buildHolisticMentorshipContent({
  session,
  permission,
  schoolCode,
  access,
}: {
  session: HolisticMentorshipSession;
  permission: UserPermission | null;
  schoolCode: string;
  access: FeatureAccessResult;
}): Promise<ReactNode | null> {
  if (!access.canView) return null;
  const isTeacher = permission?.role === "teacher";
  const holisticAccess = await requireHolisticMentorshipAccess(
    session,
    isTeacher ? "roster_view" : "program_read",
    { schoolCode }
  );
  if (!holisticAccess.ok) return null;
  if (isTeacher) {
    return (
      <HolisticMentorshipWorkspace
        mode="teacher"
        schoolCode={schoolCode}
        canEdit={holisticAccess.canEdit}
      />
    );
  }
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-bold uppercase tracking-wide text-text-primary">
        Holistic Mentorship
      </h2>
      <Link
        href="/admin/holistic-mentorship"
        className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-text-on-accent hover:bg-accent-hover"
      >
        Open Program workspace
      </Link>
    </section>
  );
}

async function buildSchoolTabs({
  session,
  permission,
  school,
  enrollmentContent,
  academicMentorshipContent,
  curriculumAccess,
  performanceAccess,
  mentorshipAccess,
  holisticMentorshipAccess,
  visitsAccess,
  quizSessionsAccess,
}: {
  session: HolisticMentorshipSession;
  permission: UserPermission | null;
  school: School;
  enrollmentContent: ReactNode;
  academicMentorshipContent: ReactNode;
  curriculumAccess: FeatureAccessResult;
  performanceAccess: FeatureAccessResult;
  mentorshipAccess: FeatureAccessResult;
  holisticMentorshipAccess: FeatureAccessResult;
  visitsAccess: FeatureAccessResult;
  quizSessionsAccess: FeatureAccessResult;
}): Promise<SchoolTab[]> {
  const holisticContent = await buildHolisticMentorshipContent({
    session,
    permission,
    schoolCode: school.code,
    access: holisticMentorshipAccess,
  });
  const tabs: SchoolTab[] = [
    { id: "enrollment", label: "Enrollment", content: enrollmentContent },
  ];
  if (curriculumAccess.canView) {
    tabs.push({
      id: "curriculum",
      label: "Curriculum",
      content: <CurriculumTab schoolCode={school.code} schoolName={school.name} canEdit={curriculumAccess.canEdit} />,
    });
  }
  if (performanceAccess.canView) {
    tabs.push({
      id: "performance",
      label: "Performance",
      content: <PerformanceTab schoolUdise={school.udise_code || school.code} />,
    });
  }
  if (quizSessionsAccess.canView) {
    tabs.push({
      id: "quiz_sessions",
      label: "Quiz Sessions",
      content: <QuizSessionsTab schoolId={school.id} canEdit={quizSessionsAccess.canEdit} />,
    });
  }
  if (mentorshipAccess.canView) {
    tabs.push({ id: "mentorship", label: "Academic Mentorship", content: academicMentorshipContent });
  }
  if (holisticContent) {
    tabs.push({ id: "holistic_mentorship", label: "Holistic Mentorship", content: holisticContent });
  }
  if (visitsAccess.canView) {
    tabs.push({
      id: "visits",
      label: "School Visits",
      content: <VisitsTab schoolCode={school.code} canEdit={visitsAccess.canEdit} />,
    });
  }
  return tabs;
}

function SchoolPageLayout({
  school,
  tabs,
  backHref,
  userEmail,
}: {
  school: School;
  tabs: SchoolTab[];
  backHref?: string;
  userEmail?: string;
}) {
  const subtitle = `${school.district}, ${school.state} | Code: ${school.code}${school.udise_code ? ` | UDISE: ${school.udise_code}` : ""}`;
  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={school.name}
        subtitle={subtitle}
        backHref={backHref}
        userEmail={userEmail}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <SchoolTabs tabs={tabs} defaultTab="enrollment" />
      </main>
    </div>
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

  const permission = await resolveSchoolPermission(session);
  const identityAccessMessage = getSchoolIdentityAccessMessage(session, permission, school);
  if (identityAccessMessage) return identityAccessMessage;
  redirectHolisticMentorshipAdmin(permission);

  const programContext = getProgramContextSync(permission);
  const programAccessMessage = getProgramAccessMessage(session, programContext);
  if (programAccessMessage) return programAccessMessage;

  // Derive feature access from the permission matrix
  const opts = { isPasscodeUser: session.isPasscodeUser };
  const studentsAccess = getFeatureAccess(permission, "students", opts);
  const curriculumAccess = getFeatureAccess(permission, "curriculum", opts);
  const performanceAccess = getFeatureAccess(permission, "performance", opts);
  const mentorshipAccess = getFeatureAccess(permission, "academic_mentorship", opts);
  const holisticMentorshipAccess = getFeatureAccess(permission, "holistic_mentorship", opts);
  const visitsAccess = getFeatureAccess(permission, "visits", opts);
  const quizSessionsAccess = getFeatureAccess(permission, "quiz_sessions", opts);

  // Fetch enrollment data in parallel (other tabs lazy-load their own data).
  // getSchoolRoster is the canonical student list (query + dedup + issues),
  // shared with the Performance deep-dive so both surfaces always agree.
  const [{ students: dedupedStudents, issues: dataIssues }, grades, batches] =
    await Promise.all([
      getSchoolRoster(school.id),
      getGrades(),
      getBatchesWithMetadata(),
    ]);

  const nvsStreams = getDistinctNVSStreams(batches);
  const isAdmin = permission?.role === "admin";
  const navigation = getSchoolNavigation(session, permission);
  const enrollmentContent = (
    <EnrollmentSchoolTab
      students={dedupedStudents}
      dataIssues={dataIssues}
      studentsAccess={studentsAccess}
      programContext={programContext}
      isPasscodeUser={Boolean(session.isPasscodeUser)}
      isAdmin={isAdmin}
      grades={grades}
      batches={batches}
      nvsStreams={nvsStreams}
      schoolCode={school.code}
    />
  );
  const academicMentorshipContent = await buildAcademicMentorshipContent({
    permission,
    canView: mentorshipAccess.canView,
    school,
  });
  const tabs = await buildSchoolTabs({
    session,
    permission,
    school,
    enrollmentContent,
    academicMentorshipContent,
    curriculumAccess,
    performanceAccess,
    mentorshipAccess,
    holisticMentorshipAccess,
    visitsAccess,
    quizSessionsAccess,
  });

  return (
    <SchoolPageLayout
      school={school}
      tabs={tabs}
      {...navigation}
    />
  );
}
