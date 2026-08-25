import Link from "next/link";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { type ReactNode } from "react";
import { query } from "@/lib/db";
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
  canViewCentre,
  getCentreConfinement,
  hasMultipleSchools,
  PROGRAM_IDS,
} from "@/lib/permissions";
import {
  CURRENT_ACADEMIC_YEAR,
  HOLISTIC_MENTORSHIP_PROGRAM_IDS,
  isHolisticMentorshipProgramId,
  PROGRAM_ID_TO_LABEL,
} from "@/lib/constants";
import { getLmsSupportedProgramIds } from "@/lib/lms-programs";
import { type Grade } from "@/components/StudentTable";
import { getSchoolRoster, getCentreStudents } from "@/lib/school-students";
import PageHeader from "@/components/PageHeader";
import SchoolTabs from "@/components/SchoolTabs";
import { Badge, Card } from "@/components/ui";
import CurriculumTab from "@/components/curriculum/CurriculumTab";
import PerformanceTab from "@/components/PerformanceTab";
import VisitsTab from "@/components/VisitsTab";
import { Batch } from "@/components/EditStudentModal";
import QuizSessionsTab from "@/components/quiz-sessions/QuizSessionsTab";
import TeacherFeedbackTab from "@/components/teacher-feedback/TeacherFeedbackTab";
import {
  buildProgramStats,
  studentDroppedFromProgram,
  studentHasCurrentProgram,
  type ProgramStats,
} from "@/lib/enrollment-stats";
import EnrollmentTabContent from "@/components/enrollment/EnrollmentTabContent";
import { getStudentAdditionAccessFromPermission } from "@/lib/student-addition-access";
import HolisticMentorshipWorkspace from "@/components/holistic-mentorship/HolisticMentorshipWorkspace";
import AdminSchoolRoster from "@/components/holistic-mentorship/AdminSchoolRoster";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipSession,
} from "@/lib/holistic-mentorship";
import {
  getHolisticAssignmentCoverageSummary,
  listHolisticAssignmentRoster,
} from "@/lib/holistic-mappings";
import { listEligibleHolisticMentors } from "@/lib/holistic-mentor-eligibility";
import type { FeatureAccessResult, UserPermission } from "@/lib/permissions";

export interface RosterSchool {
  id: string;
  name: string;
  code: string;
  udise_code: string | null;
  district: string;
  state: string;
  region: string | null;
  // Optional because the centre page resolves its school via getCentreWithSchool,
  // which doesn't fetch these; centre scope never uses them (no student addition,
  // dropout programs come from the centre itself).
  af_school_category?: string | null;
  centre_program_ids?: Array<number | string> | null;
}

/**
 * The scope a {@link RosterPage} renders. Both variants carry a school (a centre
 * always sits inside one, and the school-keyed tabs — Visits/Performance/etc. —
 * use it). The ONLY behavioural fork is the roster DB call: getSchoolRoster vs
 * getCentreStudents. This is the page-level counterpart to the shared
 * STUDENT_COLUMNS projection in school-students.ts.
 */
export type RosterScope =
  | { kind: "school"; school: RosterSchool }
  | {
      kind: "centre";
      school: RosterSchool;
      centre: { id: string; name: string; program_id: number | null; program_name: string | null };
    };

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

// The holistic-mentorship admin has no roster scope at all — their whole
// surface is the admin console, so bounce them there off any roster page.
/**
 * Which Holistic Mentorship program a school page should show.
 *
 * A school can host more than one holistic program (JNV CoE + EMRS CoE), so the
 * school page picks via `?program_id=`: absent + one choice auto-selects, absent
 * + several renders {@link HolisticProgramChoice}, a non-holistic/garbage value
 * resolves to null (tab hidden, not a 500).
 *
 * A CENTRE page never chooses — the centre's own program is the answer, and
 * offering the school's other programs would leak exactly what centre scoping
 * exists to prevent. Centre callers pass no param and get [] choices.
 */
function requestedHolisticProgramId(rawValue: string | string[] | undefined) {
  if (rawValue === undefined) return undefined;
  if (typeof rawValue !== "string") return null;
  const programId = Number(rawValue);
  return isHolisticMentorshipProgramId(programId) ? programId : null;
}

function resolveHolisticProgramId(
  requestedProgramId: number | null | undefined,
  programChoices: number[],
): number | null | undefined {
  return requestedProgramId === null
    ? null
    : requestedProgramId ?? (programChoices.length === 1 ? programChoices[0] : undefined);
}

function holisticProgramChoices(
  school: RosterSchool,
  permission: UserPermission | null,
): number[] {
  const actorPrograms = permission?.role === "admin" ||
    permission?.role === "holistic_mentorship_admin"
    ? [...HOLISTIC_MENTORSHIP_PROGRAM_IDS]
    : getProgramContextSync(permission).programIds.filter(isHolisticMentorshipProgramId);
  const allowed = new Set(actorPrograms);
  return (school.centre_program_ids ?? [])
    .map(Number)
    .filter((programId, index, values) =>
      isHolisticMentorshipProgramId(programId) &&
      allowed.has(programId) &&
      values.indexOf(programId) === index,
    );
}

function shouldChooseHolisticProgram(
  programId: number | null | undefined,
  programChoices?: number[],
): boolean {
  return programId === undefined && (programChoices?.length ?? 0) > 1;
}

function holisticProgramHref(schoolCode: string, programId: number): string {
  return `/school/${schoolCode}?program_id=${programId}`;
}

function HolisticProgramChoice({ schoolCode, programIds }: {
  schoolCode: string;
  programIds: number[];
}) {
  return (
    <Card elevation="sm" className="border-accent/30 p-6">
      <h2 className="text-lg font-bold text-text-primary">Choose a Holistic Mentorship Program</h2>
      <p className="mt-1 text-sm text-text-muted">
        This School supports more than one Holistic Mentorship Program. Choose one to continue.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {programIds.map((programId) => (
          <Link
            key={programId}
            href={holisticProgramHref(schoolCode, programId)}
            className="rounded-lg border border-accent px-4 py-2 text-sm font-bold text-accent hover:bg-accent/10"
          >
            {PROGRAM_ID_TO_LABEL[programId] ?? `Program ${programId}`}
          </Link>
        ))}
      </div>
    </Card>
  );
}

/**
 * Holistic Mentorship tab content, or null when the tab shouldn't render.
 *
 * This tab MUST be reachable on centre pages: holistic's users are CoE subject
 * teachers, and those teachers hold centre seats — which this page confines
 * away from the school roster. School-page-only holistic would lock them out
 * of their own workspace.
 *
 * It stays scoped to holistic's own programs though: a centre page shows only
 * its own program's surfaces, so a Nodal centre at a school that *also* has a
 * CoE centre must not surface CoE holistic data. The allowed set is
 * HOLISTIC_MENTORSHIP_PROGRAM_IDS (JNV CoE + EMRS CoE), not a hardcoded CoE —
 * both active EMRS CoE centres are school-linked and must show the tab.
 */
async function buildHolisticMentorshipContent({
  session,
  permission,
  schoolCode,
  access,
  isCentre,
  centreProgramId,
  programId,
  programChoices,
}: {
  session: HolisticMentorshipSession;
  permission: UserPermission | null;
  schoolCode: string;
  access: FeatureAccessResult;
  isCentre: boolean;
  centreProgramId?: number;
  programId?: number | null;
  programChoices?: number[];
}): Promise<ReactNode | null> {
  if (!access.canView || programId === null) return null;
  if (isCentre && !isHolisticMentorshipProgramId(Number(centreProgramId))) return null;
  if (shouldChooseHolisticProgram(programId, programChoices)) {
    return <HolisticProgramChoice schoolCode={schoolCode} programIds={programChoices!} />;
  }
  const role = permission?.role;
  const isTeacher = role === "teacher";
  const holisticAccess = await requireHolisticMentorshipAccess(
    session,
    isTeacher ? "roster_view" : "assignment_coverage_read",
    { schoolCode, programId }
  );
  if (!holisticAccess.ok) return null;
  if (isTeacher) {
    return (
      <HolisticMentorshipWorkspace
        mode="teacher"
        schoolCode={schoolCode}
        programId={holisticAccess.school!.programId}
        canEdit={holisticAccess.canEdit}
      />
    );
  }
  const [students, summary, mentors] = await Promise.all([
    listHolisticAssignmentRoster({
      permission: holisticAccess.permission,
      schoolId: holisticAccess.school!.id,
      programId: holisticAccess.school!.programId,
      academicYear: CURRENT_ACADEMIC_YEAR,
    }),
    getHolisticAssignmentCoverageSummary({
      permission: holisticAccess.permission,
      schoolId: holisticAccess.school!.id,
      programId: holisticAccess.school!.programId,
      academicYear: CURRENT_ACADEMIC_YEAR,
    }),
    holisticAccess.canEdit
      ? listEligibleHolisticMentors({
          schoolId: holisticAccess.school!.id,
          programId: holisticAccess.school!.programId,
        })
      : Promise.resolve([]),
  ]);
  return (
    <AdminSchoolRoster
      schoolCode={schoolCode}
      programId={holisticAccess.school!.programId}
      academicYear={CURRENT_ACADEMIC_YEAR}
      role={role}
      canEdit={holisticAccess.canEdit}
      students={students}
      summary={summary}
      mentors={mentors}
    />
  );
}

// A centre row with no program_id (currently only 16 Nagaland Foundation) can
// still be browsed, because it is active, physical and school-linked. Its
// program-scoped tabs have nothing legitimate to show: with no program to filter
// by they would fall back to the school's own data, which on a multi-centre
// school is a sibling centre's curriculum, batches and performance under this
// centre's name. Say so instead.
function NoCentreProgram({ centreName }: { centreName: string }) {
  return (
    <Card elevation="sm" className="border-dashed p-8 text-center text-sm text-text-muted">
      <div className="font-semibold text-text-primary">
        No Program is assigned to this Centre.
      </div>
      <p className="mt-1">
        {centreName} needs a Program before its Curriculum, Performance and Quiz
        Sessions can be shown. Ask the team to set one on the Centre record.
      </p>
    </Card>
  );
}

function AccessDenied({
  message,
  link,
}: {
  message: string;
  // Optional primary link shown in place of the default dashboard link (e.g.
  // point a centre-seated user at their own centre).
  link?: { href: string; label: string };
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Card elevation="xl" className="p-8 max-w-md text-center">
        <h1 className="text-xl font-bold text-red-600 mb-2">Access Denied</h1>
        <p className="text-gray-600 mb-4">{message}</p>
        <Link
          href={link?.href ?? "/dashboard"}
          className="text-accent hover:text-accent-hover"
        >
          {link?.label ?? "Return to dashboard"}
        </Link>
      </Card>
    </div>
  );
}

/**
 * The page chrome (header + tabs). Shared by the full roster page and the
 * holistic-admin single-tab view, so both keep the same header and back link.
 */
function RosterShell({
  title,
  subtitle,
  backHref,
  userEmail,
  actions,
  tabs,
}: {
  title: string;
  subtitle: string;
  backHref?: string;
  userEmail?: string;
  actions?: ReactNode;
  tabs: Array<{ id: string; label: string; content: ReactNode }>;
}) {
  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={title}
        subtitle={subtitle}
        backHref={backHref}
        userEmail={userEmail}
        actions={actions}
      />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* defaultTab follows the first VISIBLE tab: the holistic-admin view has
            no Enrollment tab, so a hardcoded "enrollment" would select nothing. */}
        <SchoolTabs tabs={tabs} defaultTab={tabs[0]?.id} />
      </main>
    </div>
  );
}

/**
 * Shared roster page for a school OR a centre. The two callers
 * (school/[udise] and centre/[id]) resolve their entity and hand us a
 * {@link RosterScope}; everything below — auth, permissions, tabs, header,
 * Start Visit — is identical, and the only fork is the roster DB call.
 */
export default async function RosterPage({
  scope,
  session,
  holisticProgramParam,
}: {
  scope: RosterScope;
  session: Session;
  // Raw `?program_id=` from the school page — which Holistic Mentorship program
  // to show when a school hosts more than one. Centre callers omit it: the
  // centre's own program is the answer (see holisticProgramChoices).
  holisticProgramParam?: string | string[];
}) {
  const school = scope.school;
  const isCentre = scope.kind === "centre";

  // Check permissions
  const isPasscodeUser = session.isPasscodeUser;
  const passcodeSchoolCode = session.schoolCode;

  // For passcode users, only allow access to their (parent) school. Point them
  // back to login, not the dashboard (a passcode user has no dashboard).
  if (isPasscodeUser && passcodeSchoolCode !== school.code) {
    return (
      <AccessDenied
        message="Your passcode only grants access to a different school."
        link={{ href: "/", label: "Return to login" }}
      />
    );
  }

  // Single DB call for permission — reuse everywhere
  const permission = !isPasscodeUser && session.user?.email
    ? await getResolvedPermission(session.user.email)
    : null;

  // Which Holistic Mentorship program this page shows. A centre answers it
  // itself — its own program, no choice offered, so a Nodal centre at a
  // CoE+Nodal school can never reach the CoE holistic roster. A school may host
  // several holistic programs and picks via ?program_id=.
  //
  // Deferred, not computed here: every access-denied path below must return
  // before this runs (it reads the program context, which a denied user has no
  // business resolving).
  const resolveHolisticProgram = () => {
    const choices = isCentre ? [] : holisticProgramChoices(school, permission);
    return {
      choices,
      programId: isCentre
        ? scope.centre.program_id ?? undefined
        : resolveHolisticProgramId(
            requestedHolisticProgramId(holisticProgramParam),
            choices,
          ),
    };
  };

  // For Google users, check school access (a centre inherits its school's access)
  if (!isPasscodeUser) {
    if (!permission) {
      return <AccessDenied message="You don't have permission to view this page." />;
    }
    if (!canAccessSchoolSync(permission, school.code, school.region || undefined)) {
      return <AccessDenied message="You don't have permission to view this page." />;
    }

    // The holistic-mentorship admin sees that school's holistic roster in place
    // — and only that tab; they have no scope for anything else on the page.
    // Their console links to /school/<code>?program_id=N, which is why school
    // scope renders while centre scope still bounces to the console: a centre
    // page is reached from the dashboard Centres tab, which this role never
    // sees.
    if (permission.role === "holistic_mentorship_admin") {
      if (isCentre) redirect("/admin/holistic-mentorship");
      const { programId, choices } = resolveHolisticProgram();
      const holisticContent = await buildHolisticMentorshipContent({
        session,
        permission,
        schoolCode: school.code,
        access: getFeatureAccess(permission, "holistic_mentorship"),
        isCentre,
        programId,
        programChoices: choices,
      });
      if (!holisticContent) redirect("/admin/holistic-mentorship");
      return (
        <RosterShell
          title={school.name}
          subtitle={`${school.district}, ${school.state} | Code: ${school.code}`}
          backHref="/admin/holistic-mentorship"
          userEmail={session.user?.email ?? undefined}
          tabs={[{
            id: "holistic_mentorship",
            label: "Holistic Mentorship",
            content: holisticContent,
          }]}
        />
      );
    }

    // Centre-seated staff are confined to their centre(s): the whole-school
    // roster page isn't theirs to open (their seat grants school access only so
    // school-linked actions like visits work). Point them at their centre — the
    // single seat directly, otherwise the Centres tab to pick one.
    const confinement = getCentreConfinement(permission);
    if (!isCentre && confinement.confined) {
      const seatIds = confinement.centreIds;
      const centreLink =
        seatIds.length === 1
          ? { href: `/centre/${seatIds[0]}`, label: "Go to your centre" }
          : { href: "/dashboard?view=centres", label: "Go to your centres" };
      return (
        <AccessDenied
          message="This school page isn't available for your access. View your assigned centre instead."
          link={centreLink}
        />
      );
    }

    // Centre pages are seat-scoped: a user with centre seats may only open the
    // centres they hold a seat at (not every centre at the school). Rule lives
    // in permissions.canViewCentre; a seatless manager falls back to school access.
    if (
      isCentre &&
      !canViewCentre(permission, {
        centreId: Number(scope.centre.id),
        schoolCode: school.code,
        schoolRegion: school.region || undefined,
      })
    ) {
      return <AccessDenied message="You don't have permission to view this centre." />;
    }
  }

  // Derive everything from the single permission object — no extra DB calls
  const programContext = getProgramContextSync(permission);

  if (!isPasscodeUser && !programContext.hasAccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Card elevation="xl" className="p-8 max-w-md text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">No Program Access</h1>
          <p className="text-gray-600 mb-4">
            You are not assigned to any programs. Please contact an administrator.
          </p>
          <Link href="/dashboard" className="text-accent hover:text-accent-hover">
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
  const holisticMentorshipAccess = getFeatureAccess(permission, "holistic_mentorship", opts);
  const visitsAccess = getFeatureAccess(permission, "visits", opts);
  const quizSessionsAccess = getFeatureAccess(permission, "quiz_sessions", opts);
  const teacherFeedbackAccess = getFeatureAccess(permission, "teacher_feedback", opts);
  // Student addition is an NVS school-page feature; a centre roster is scoped
  // to the centre's own program, so it never offers Add Student.
  const canAddStudent =
    !isCentre &&
    getStudentAdditionAccessFromPermission(
      session,
      { ...school, af_school_category: school.af_school_category ?? null },
      permission,
    ).ok;

  // Fetch enrollment data in parallel. THE fork: a centre pulls its own roster
  // from the centre_students view; a school pulls the full school roster.
  const [
    { students: dedupedStudents, issues: dataIssues },
    grades,
    batches,
    supportedProgramIds,
  ] = await Promise.all([
    isCentre ? getCentreStudents(scope.centre.id) : getSchoolRoster(school.id),
    getGrades(),
    getBatchesWithMetadata(),
    // centres-derived ∪ PROGRAM_IDS (D22c) — a newly onboarded centre program
    // shows students without a code edit. Additive, so it can never hide one.
    getLmsSupportedProgramIds(),
  ]);

  // Separate active and dropout students (all students visible; editability is per-row)
  const activeStudents = dedupedStudents.filter(
    (s) =>
      s.status !== "dropout" &&
      supportedProgramIds.some((programId) =>
        studentHasCurrentProgram(s, programId),
      ),
  );
  const dropoutStudents = dedupedStudents.filter(
    (s) => s.status === "dropout" || (s.dropout_program_ids?.length ?? 0) > 0,
  );

  // Extract distinct streams from NVS batches
  const nvsStreams = getDistinctNVSStreams(batches);

  // On a centre page, scope the program-filtered tabs to the centre's single
  // program (Performance filters by program name; Curriculum/Quiz by id).
  const centreProgramId = isCentre ? scope.centre.program_id ?? undefined : undefined;
  const centreProgramName = isCentre ? scope.centre.program_name ?? undefined : undefined;
  // Distinguishes "school page" (no centre program by definition) from "centre
  // page whose centre has no program" — both leave centreProgramId undefined,
  // but only the second must refuse to fall back to the school's data.
  const hasNoCentreProgram = isCentre && scope.centre.program_id == null;
  const noCentreProgramContent = (
    <NoCentreProgram centreName={isCentre ? scope.centre.name : school.name} />
  );

  // Programs that have at least one student (active or dropped) in scope
  const programsWithStudents = new Set(
    supportedProgramIds.filter((programId) =>
      dedupedStudents.some(
        (student) =>
          studentHasCurrentProgram(student, programId) ||
          studentDroppedFromProgram(student, programId),
      ),
    ),
  );

  // Programs shown as enrollment cards. Admins + passcode users see every
  // program present; everyone else sees the intersection of their effective
  // programs with what's here.
  const isAdmin = permission?.role === "admin";
  const visibleProgramSet = new Set(
    (isPasscodeUser || isAdmin
      ? supportedProgramIds
      : programContext.programIds
    ).filter((id) => programsWithStudents.has(id)),
  );

  if (canAddStudent) visibleProgramSet.add(PROGRAM_IDS.NVS);

  // A centre page shows only its own program's card. programsWithStudents counts
  // a program when any student in scope merely *dropped* from it, and
  // studentDroppedFromProgram reads the student's own audit history — so a CoE
  // centre whose members carry an old "dropped from Nodal" audit would surface a
  // Nodal card for students this page never lists.
  const visibleProgramIds = supportedProgramIds.filter(
    (id) =>
      visibleProgramSet.has(id) && (!isCentre || id === centreProgramId),
  );

  const programStatsList: ProgramStats[] = visibleProgramIds.map((id) =>
    buildProgramStats(activeStudents, id)
  );

  // Back link: to the dashboard when the user can see more than one school, or
  // always for a centre (it's reached from the dashboard's Centres tab). A bare
  // /dashboard is a loop for a single-seat user — the landing shortcut sends them
  // straight back here — so centre pages point at the Centres tab explicitly,
  // which is where the card they came from lives anyway.
  const multipleSchools = !isPasscodeUser && hasMultipleSchools(permission);
  const backHref = isCentre
    ? "/dashboard?view=centres"
    : multipleSchools
      ? "/dashboard"
      : undefined;

  const title = isCentre ? scope.centre.name : school.name;
  const subtitle = isCentre
    ? `${scope.centre.program_name ? `${scope.centre.program_name} | ` : ""}${school.name}${school.udise_code ? ` | UDISE: ${school.udise_code}` : ""}`
    : `${school.district}, ${school.state} | Code: ${school.code}${school.udise_code ? ` | UDISE: ${school.udise_code}` : ""}`;

  // Build tabs
  const enrollmentContent = (
    <div>
      {/* Data Issues Banner */}
      {dataIssues.length > 0 && (
        <div className="mb-4">
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
        canEditStudent={studentsAccess.canEdit}
        canDropoutStudent={
          studentsAccess.canEdit &&
          !isPasscodeUser &&
          ["admin", "program_manager", "program_admin"].includes(
            permission?.role ?? "",
          )
        }
        dropoutProgramIds={[
          ...new Set([
            // Dropout is offered for centre programs: on a centre page just the
            // centre's own; on a school page every active centre at the school.
            ...(isCentre
              ? scope.centre.program_id != null
                ? [Number(scope.centre.program_id)]
                : []
              : (school.centre_program_ids ?? []).map(Number)),
            ...(canAddStudent ? [PROGRAM_IDS.NVS] : []),
          ]),
        ]}
        canAddStudent={canAddStudent}
        userProgramIds={isPasscodeUser ? null : programContext.programIds}
        isPasscodeUser={isPasscodeUser ?? false}
        isAdmin={isAdmin}
        grades={grades}
        batches={batches}
        nvsStreams={nvsStreams}
        schoolUdise={school.udise_code || school.code}
        schoolCode={school.code}
      />
    </div>
  );

  const performanceContent = (
    <PerformanceTab
      schoolUdise={school.udise_code || school.code}
      lockedProgram={centreProgramName}
    />
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
  // Centre pages scope the manager overview to the centre's program — the
  // school-wide mapping list (all programs, all centres) is school-page data.
  // A program-less centre gets an empty overview rather than the school's.
  const mentorshipGroups =
    mentorshipAccess.canView && permission?.role !== "teacher"
      ? hasNoCentreProgram
        ? []
        : await listAcademicMentorshipMappings({
            schoolId,
            academicYear: CURRENT_ACADEMIC_YEAR,
            includeHistory: false,
            programId: centreProgramId ?? null,
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
    <QuizSessionsTab
      schoolId={school.id}
      canEdit={quizSessionsAccess.canEdit}
      programId={centreProgramId}
    />
  );

  const curriculumContent = (
    <CurriculumTab
      schoolCode={school.code}
      schoolName={school.name}
      canEdit={curriculumAccess.canEdit}
      programId={centreProgramId}
    />
  );

  // Teacher Feedback is centre-keyed data (a round belongs to a centre, and
  // teachers map to a centre, not the school), so a centre page passes its own
  // id: the rounds list and the setup picker both narrow to it, and the picker
  // collapses to the single centre. Without this a centre page would list a
  // sibling centre's rounds — the leak class fixed in the 07-22 review.
  const teacherFeedbackContent = (
    <TeacherFeedbackTab
      schoolCode={school.code}
      canEdit={teacherFeedbackAccess.canEdit}
      centreId={isCentre ? Number(scope.centre.id) : undefined}
    />
  );

  const holistic = resolveHolisticProgram();
  const holisticContent = await buildHolisticMentorshipContent({
    session,
    permission,
    schoolCode: school.code,
    access: holisticMentorshipAccess,
    isCentre,
    centreProgramId,
    programId: holistic.programId,
    programChoices: holistic.choices,
  });

  // Tab visibility driven by feature permission matrix. Visits are school-linked
  // (a PM visits all of a school's centres in one trip), so the label stays
  // "School Visits" even on a centre page.
  const candidates: Array<{ id: string; label: string; content: ReactNode; show: boolean }> = [
    { id: "enrollment", label: "Enrollment", content: enrollmentContent, show: true },
    {
      id: "curriculum",
      label: "Curriculum",
      content: hasNoCentreProgram ? noCentreProgramContent : curriculumContent,
      show: curriculumAccess.canView,
    },
    {
      id: "performance",
      label: "Performance",
      content: hasNoCentreProgram ? noCentreProgramContent : performanceContent,
      show: performanceAccess.canView,
    },
    {
      id: "quiz_sessions",
      label: "Quiz Sessions",
      content: hasNoCentreProgram ? noCentreProgramContent : quizSessionsContent,
      show: quizSessionsAccess.canView,
    },
    {
      id: "teacher_feedback",
      label: "Teacher Feedback",
      content: teacherFeedbackContent,
      show: teacherFeedbackAccess.canView,
    },
    { id: "mentorship", label: "Academic Mentorship", content: mentorshipContent, show: mentorshipAccess.canView },
    {
      id: "holistic_mentorship",
      label: "Holistic Mentorship",
      content: holisticContent,
      show: Boolean(holisticContent),
    },
    { id: "visits", label: "School Visits", content: visitsContent, show: visitsAccess.canView },
  ];
  const tabs = candidates
    .filter((tab) => tab.show)
    .map(({ id, label, content }) => ({ id, label, content }));

  return (
    <RosterShell
      title={title}
      subtitle={subtitle}
      backHref={backHref}
      userEmail={isPasscodeUser ? `School ${passcodeSchoolCode}` : session.user?.email || undefined}
      tabs={tabs}
      actions={
        visitsAccess.canEdit ? (
          <Link
            href={`/school/${school.code}/visit/new`}
            className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-bold text-text-on-accent bg-accent shadow-sm hover:bg-accent-hover active:bg-accent-hover/90 transition-colors"
          >
            Start Visit
          </Link>
        ) : undefined
      }
    />
  );
}
