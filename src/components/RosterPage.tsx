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
  isPmuRole,
  PMU_GOVT_SCHOOL_USER_ROLE,
  PMU_PROGRAM_ID,
  PROGRAM_ID_TO_LABEL,
} from "@/lib/constants";
import { getLmsSupportedProgramIds } from "@/lib/lms-programs";
import { type Grade } from "@/components/StudentTable";
import {
  getSchoolRoster,
  getCentreStudents,
  type SchoolRoster,
} from "@/lib/school-students";
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
  studentInProgram,
  type ProgramStats,
} from "@/lib/enrollment-stats";
import EnrollmentTabContent from "@/components/enrollment/EnrollmentTabContent";
import {
  ALLOWED_STUDENT_ADDITION_ROLES,
  getStudentAdditionAccessFromPermission,
  getStudentExportAccessFromPermission,
} from "@/lib/student-addition-access";
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
  const schoolPrograms = new Set((school.centre_program_ids ?? []).map(Number));
  // The centre query's row order is not a UI contract. Follow the shared
  // allowlist order so a multi-Program School is presented consistently in
  // the School page and Admin workspace.
  return HOLISTIC_MENTORSHIP_PROGRAM_IDS.filter((programId) =>
    isHolisticMentorshipProgramId(programId) &&
    allowed.has(programId) &&
    schoolPrograms.has(programId),
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
  fromHolisticProgress = false,
}: {
  session: HolisticMentorshipSession;
  permission: UserPermission | null;
  schoolCode: string;
  access: FeatureAccessResult;
  isCentre: boolean;
  centreProgramId?: number;
  programId?: number | null;
  programChoices?: number[];
  fromHolisticProgress?: boolean;
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
      fromHolisticProgress={!isCentre && fromHolisticProgress}
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

function NoProgramAccess() {
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

const NO_PAGE_PERMISSION = "You don't have permission to view this page.";

type RosterStudent = SchoolRoster["students"][number];
type RosterDataIssue = SchoolRoster["issues"][number];

/**
 * Which Holistic Mentorship program this page shows. A centre answers it
 * itself — its own program, no choice offered, so a Nodal centre at a
 * CoE+Nodal school can never reach the CoE holistic roster. A school may host
 * several holistic programs and picks via ?program_id=.
 *
 * Call it only after every access-denied check: it reads the program context,
 * which a denied user has no business resolving.
 */
function resolveHolisticProgram(
  scope: RosterScope,
  permission: UserPermission,
  holisticProgramParam: string | string[] | undefined,
) {
  if (scope.kind === "centre") {
    return { choices: [], programId: scope.centre.program_id ?? undefined };
  }
  const choices = holisticProgramChoices(scope.school, permission);
  return {
    choices,
    programId: resolveHolisticProgramId(
      requestedHolisticProgramId(holisticProgramParam),
      choices,
    ),
  };
}

// School access checks (a centre inherits its school's access).
function schoolAccessDenial(permission: UserPermission, scope: RosterScope): ReactNode | null {
  const { school } = scope;
  if (!canAccessSchoolSync(permission, school.code, school.region || undefined)) {
    return <AccessDenied message={NO_PAGE_PERMISSION} />;
  }
  // PMU roles are pinned to JNV NVS (ADR 0007): level 3 "all" must not open
  // a centre-program (non-JNV) School. Centre pages are refused by
  // canViewCentre in centreScopeDenial.
  if (scope.kind === "school" && isPmuRole(permission.role) && school.af_school_category !== "JNV") {
    return <AccessDenied message={NO_PAGE_PERMISSION} />;
  }
  return null;
}

function centreConfinementLink(seatIds: number[] | string[]) {
  return seatIds.length === 1
    ? { href: `/centre/${seatIds[0]}`, label: "Go to your centre" }
    : { href: "/dashboard?view=centres", label: "Go to your centres" };
}

function centreScopeDenial(permission: UserPermission, scope: RosterScope): ReactNode | null {
  const confinement = getCentreConfinement(permission);
  // Centre-seated staff are confined to their centre(s): the whole-school
  // roster page isn't theirs to open (their seat grants school access only so
  // school-linked actions like visits work). Point them at their centre — the
  // single seat directly, otherwise the Centres tab to pick one.
  if (scope.kind === "school") {
    if (!confinement.confined) return null;
    return (
      <AccessDenied
        message="This school page isn't available for your access. View your assigned centre instead."
        link={centreConfinementLink(confinement.centreIds)}
      />
    );
  }
  // Centre pages are seat-scoped: a user with centre seats may only open the
  // centres they hold a seat at (not every centre at the school). Rule lives
  // in permissions.canViewCentre; a seatless manager falls back to school access.
  const canView = canViewCentre(permission, {
    centreId: Number(scope.centre.id),
    schoolCode: scope.school.code,
    schoolRegion: scope.school.region || undefined,
  });
  return canView ? null : <AccessDenied message="You don't have permission to view this centre." />;
}

/**
 * The holistic-mentorship admin sees that school's holistic roster in place
 * — and only that tab; they have no scope for anything else on the page.
 * Their console links to /school/<code>?program_id=N, which is why school
 * scope renders while centre scope still bounces to the console: a centre
 * page is reached from the dashboard Centres tab, which this role never
 * sees.
 */
async function renderHolisticAdminRoster({
  scope,
  session,
  permission,
  holisticProgramParam,
  fromHolisticProgress,
}: {
  scope: RosterScope;
  session: Session;
  permission: UserPermission;
  holisticProgramParam?: string | string[];
  fromHolisticProgress: boolean;
}) {
  const { school } = scope;
  const isCentre = scope.kind === "centre";
  if (isCentre) redirect("/admin/holistic-mentorship");
  const { programId, choices } = resolveHolisticProgram(scope, permission, holisticProgramParam);
  const holisticContent = await buildHolisticMentorshipContent({
    session,
    permission,
    schoolCode: school.code,
    access: getFeatureAccess(permission, "holistic_mentorship"),
    isCentre,
    programId,
    programChoices: choices,
    fromHolisticProgress,
  });
  if (!holisticContent) redirect("/admin/holistic-mentorship");
  return (
    <RosterShell
      title={school.name}
      subtitle={`${school.district}, ${school.state} | Code: ${school.code}`}
      backHref={programId === undefined
        ? "/admin/holistic-mentorship"
        : `/admin/holistic-mentorship?program_id=${programId}`}
      userEmail={session.user?.email ?? undefined}
      tabs={[{
        id: "holistic_mentorship",
        label: "Holistic Mentorship",
        content: holisticContent,
      }]}
    />
  );
}

// Derive feature access from the permission matrix
function rosterFeatureAccess(permission: UserPermission) {
  return {
    students: getFeatureAccess(permission, "students"),
    curriculum: getFeatureAccess(permission, "curriculum"),
    performance: getFeatureAccess(permission, "performance"),
    mentorship: getFeatureAccess(permission, "academic_mentorship"),
    holisticMentorship: getFeatureAccess(permission, "holistic_mentorship"),
    visits: getFeatureAccess(permission, "visits"),
    quizSessions: getFeatureAccess(permission, "quiz_sessions"),
    teacherFeedback: getFeatureAccess(permission, "teacher_feedback"),
  };
}

function studentActionAccess(
  session: Session,
  scope: RosterScope,
  permission: UserPermission,
  canEditStudents: boolean,
) {
  const isCentre = scope.kind === "centre";
  // Student addition is an NVS school-page feature; a centre roster is scoped
  // to the centre's own program, so it never offers Add Student.
  const rosterSchool = { ...scope.school, af_school_category: scope.school.af_school_category ?? null };
  return {
    canAddStudent:
      !isCentre && getStudentAdditionAccessFromPermission(session, rosterSchool, permission).ok,
    // Download List is a view action: same as canAddStudent for existing roles,
    // but a read_only PMU user keeps it (NVS-only export).
    canDownloadList:
      !isCentre && getStudentExportAccessFromPermission(session, rosterSchool, permission).ok,
    canDropoutStudent: canEditStudents && ALLOWED_STUDENT_ADDITION_ROLES.has(permission.role),
  };
}

// Fetch enrollment data in parallel. THE fork: a centre pulls its own roster
// from the centre_students view; a school pulls the full school roster.
async function fetchRosterData(scope: RosterScope) {
  const [roster, grades, batches, supportedProgramIds] = await Promise.all([
    scope.kind === "centre" ? getCentreStudents(scope.centre.id) : getSchoolRoster(scope.school.id),
    getGrades(),
    getBatchesWithMetadata(),
    // centres-derived ∪ PROGRAM_IDS (D22c) — a newly onboarded centre program
    // shows students without a code edit. Additive, so it can never hide one.
    getLmsSupportedProgramIds(),
  ]);
  return { roster, grades, batches, supportedProgramIds };
}

function isNvsStudent(s: RosterStudent): boolean {
  return studentInProgram(s, PMU_PROGRAM_ID);
}

/**
 * PMU roles are pinned to JNV NVS (ADR 0007): narrow the roster on the
 * server, before any props are built, so a mixed School's CoE, Nodal and
 * unassigned Students never reach the browser (the client only filters by
 * the selected card). An NVS Student has a current NVS batch or an NVS
 * dropout that hasn't been undone — the same sets the NVS export lists — so
 * NVS dropouts stay undoable. Data issues follow their Student.
 */
function scopeRosterToRole(
  students: RosterStudent[],
  issues: RosterDataIssue[],
  isPmu: boolean,
): { students: RosterStudent[]; dataIssues: RosterDataIssue[] } {
  if (!isPmu) return { students, dataIssues: issues };
  const nvsStudents = students.filter(isNvsStudent);
  const nvsGroupUserIds = new Set(nvsStudents.map((s) => String(s.group_user_id)));
  return {
    students: nvsStudents,
    dataIssues: issues.filter((issue) => nvsGroupUserIds.has(String(issue.groupUserId))),
  };
}

// Separate active and dropout students (all students visible; editability is per-row).
// A PMU user's lists hold only what the NVS card shows: active = a current
// NVS batch, dropout = dropped from NVS.
function isActiveStudent(s: RosterStudent, isPmu: boolean, supportedProgramIds: number[]): boolean {
  if (s.status === "dropout") return false;
  return isPmu
    ? studentHasCurrentProgram(s, PMU_PROGRAM_ID)
    : supportedProgramIds.some((programId) => studentHasCurrentProgram(s, programId));
}

function isDropoutStudent(s: RosterStudent, isPmu: boolean): boolean {
  if (isPmu) return studentDroppedFromProgram(s, PMU_PROGRAM_ID);
  return s.status === "dropout" || (s.dropout_program_ids?.length ?? 0) > 0;
}

function splitActiveAndDropout(
  students: RosterStudent[],
  isPmu: boolean,
  supportedProgramIds: number[],
) {
  return {
    activeStudents: students.filter((s) => isActiveStudent(s, isPmu, supportedProgramIds)),
    dropoutStudents: students.filter((s) => isDropoutStudent(s, isPmu)),
  };
}

/**
 * On a centre page, scope the program-filtered tabs to the centre's single
 * program (Performance filters by program name; Curriculum/Quiz by id).
 * `hasNoProgram` distinguishes "school page" (no centre program by definition)
 * from "centre page whose centre has no program" — both leave `programId`
 * undefined, but only the second must refuse to fall back to the school's data.
 */
function centreProgramScope(scope: RosterScope) {
  if (scope.kind === "school") {
    return { centreId: undefined, programId: undefined, programName: undefined, hasNoProgram: false };
  }
  return {
    centreId: Number(scope.centre.id),
    programId: scope.centre.program_id ?? undefined,
    programName: scope.centre.program_name ?? undefined,
    hasNoProgram: scope.centre.program_id == null,
  };
}

function visibleEnrollmentProgramIds({
  students,
  supportedProgramIds,
  permission,
  userProgramIds,
  canAddStudent,
  isCentre,
  centreProgramId,
}: {
  students: RosterStudent[];
  supportedProgramIds: number[];
  permission: UserPermission;
  userProgramIds: number[];
  canAddStudent: boolean;
  isCentre: boolean;
  centreProgramId: number | undefined;
}): number[] {
  // Programs that have at least one student (active or dropped) in scope
  const programsWithStudents = new Set(
    supportedProgramIds.filter((programId) =>
      students.some(
        (student) =>
          studentHasCurrentProgram(student, programId) ||
          studentDroppedFromProgram(student, programId),
      ),
    ),
  );

  // Programs shown as enrollment cards. Admins see every program present;
  // everyone else sees the intersection of their effective
  // programs with what's here.
  const visibleProgramSet = new Set(
    (permission.role === "admin" ? supportedProgramIds : userProgramIds).filter((id) =>
      programsWithStudents.has(id),
    ),
  );

  if (canAddStudent) visibleProgramSet.add(PROGRAM_IDS.NVS);

  // A centre page shows only its own program's card. programsWithStudents counts
  // a program when any student in scope merely *dropped* from it, and
  // studentDroppedFromProgram reads the student's own audit history — so a CoE
  // centre whose members carry an old "dropped from Nodal" audit would surface a
  // Nodal card for students this page never lists.
  return supportedProgramIds.filter(
    (id) => visibleProgramSet.has(id) && (!isCentre || id === centreProgramId),
  );
}

// Dropout is offered for centre programs: on a centre page just the centre's
// own; on a school page every active centre at the school.
function centreDropoutProgramIds(scope: RosterScope): number[] {
  if (scope.kind === "centre") {
    return scope.centre.program_id != null ? [Number(scope.centre.program_id)] : [];
  }
  return (scope.school.centre_program_ids ?? []).map(Number);
}

function dropoutProgramIds(scope: RosterScope, canAddStudent: boolean): number[] {
  return [
    ...new Set([
      ...centreDropoutProgramIds(scope),
      ...(canAddStudent ? [PROGRAM_IDS.NVS] : []),
    ]),
  ];
}

function udiseSuffix(school: RosterSchool): string {
  return school.udise_code ? ` | UDISE: ${school.udise_code}` : "";
}

function rosterHeading(scope: RosterScope): { title: string; subtitle: string } {
  const { school } = scope;
  if (scope.kind === "centre") {
    const programPrefix = scope.centre.program_name ? `${scope.centre.program_name} | ` : "";
    return {
      title: scope.centre.name,
      subtitle: `${programPrefix}${school.name}${udiseSuffix(school)}`,
    };
  }
  return {
    title: school.name,
    subtitle: `${school.district}, ${school.state} | Code: ${school.code}${udiseSuffix(school)}`,
  };
}

/**
 * Back link: to the dashboard when the user can see more than one school, or
 * always for a centre (it's reached from the dashboard's Centres tab). A bare
 * /dashboard is a loop for a single-seat user — the landing shortcut sends them
 * straight back here — so centre pages point at the Centres tab explicitly,
 * which is where the card they came from lives anyway.
 */
function defaultRosterBackHref(isCentre: boolean, permission: UserPermission): string | undefined {
  if (isCentre) return "/dashboard?view=centres";
  // A PMU Govt School User has exactly one School, so never a back link.
  return hasMultipleSchools(permission) && permission.role !== PMU_GOVT_SCHOOL_USER_ROLE
    ? "/dashboard"
    : undefined;
}

// A School page opened from the Holistic Progress console returns there.
function holisticProgressBackHref({
  isCentre,
  fromHolisticProgress,
  holisticContent,
  holisticProgramId,
}: {
  isCentre: boolean;
  fromHolisticProgress: boolean;
  holisticContent: ReactNode | null;
  holisticProgramId: number | null | undefined;
}): string | undefined {
  return !isCentre && fromHolisticProgress && holisticContent && holisticProgramId !== undefined
    ? `/admin/holistic-mentorship?program_id=${holisticProgramId}`
    : undefined;
}

function DataIssuesBanner({ issues }: { issues: RosterDataIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="mb-4">
      <details className="bg-amber-50 border border-amber-200 rounded-lg">
        <summary className="px-4 py-3 cursor-pointer text-sm font-medium text-amber-800 hover:bg-amber-100 rounded-lg transition-colors">
          {issues.length} data {issues.length === 1 ? "issue" : "issues"} found
        </summary>
        <div className="px-4 pb-3 space-y-2">
          {issues.map((issue) => (
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
  );
}

function academicMentorshipManageHref(
  permission: UserPermission,
  schoolCode: string,
): string | undefined {
  const isManager = permission.role === "admin" || permission.role === "program_admin";
  return isManager
    ? `/admin/academic-mentorship?${new URLSearchParams({
        school_code: schoolCode,
        academic_year: CURRENT_ACADEMIC_YEAR,
      }).toString()}`
    : undefined;
}

async function listTeacherMentees(permission: UserPermission, schoolId: number) {
  const mentorUserId = await getAcademicMentorshipActorUserId(permission.email, permission);
  return mentorUserId !== null
    ? await listAcademicMentorshipTeacherMentees({
        schoolId,
        academicYear: CURRENT_ACADEMIC_YEAR,
        mentorUserId,
      })
    : null;
}

// Centre pages scope the manager overview to the centre's program — the
// school-wide mapping list (all programs, all centres) is school-page data.
// A program-less centre gets an empty overview rather than the school's.
async function listManagerMentorshipGroups(
  schoolId: number,
  centre: { programId: number | undefined; hasNoProgram: boolean },
) {
  return centre.hasNoProgram
    ? []
    : await listAcademicMentorshipMappings({
        schoolId,
        academicYear: CURRENT_ACADEMIC_YEAR,
        includeHistory: false,
        programId: centre.programId ?? null,
      });
}

async function buildAcademicMentorshipContent({
  permission,
  school,
  canView,
  centre,
}: {
  permission: UserPermission;
  school: RosterSchool;
  canView: boolean;
  centre: { programId: number | undefined; hasNoProgram: boolean };
}): Promise<ReactNode> {
  const schoolId = Number(school.id);
  const isTeacher = permission.role === "teacher";
  const teacherMentees =
    canView && isTeacher ? await listTeacherMentees(permission, schoolId) : null;
  const mentorshipGroups =
    canView && !isTeacher ? await listManagerMentorshipGroups(schoolId, centre) : null;
  return (
    <AcademicMentorshipSchoolTab
      mode={isTeacher ? "teacher" : "overview"}
      mentees={teacherMentees ?? undefined}
      groups={mentorshipGroups ?? undefined}
      manageHref={academicMentorshipManageHref(permission, school.code)}
    />
  );
}

/**
 * Tab visibility driven by feature permission matrix. Visits are school-linked
 * (a PM visits all of a school's centres in one trip), so the label stays
 * "School Visits" even on a centre page. Program-scoped tabs on a program-less
 * centre show {@link NoCentreProgram} instead of the school's data.
 */
function visibleRosterTabs({
  access,
  hasNoCentreProgram,
  noCentreProgramContent,
  content,
}: {
  access: ReturnType<typeof rosterFeatureAccess>;
  hasNoCentreProgram: boolean;
  noCentreProgramContent: ReactNode;
  content: Record<
    | "enrollment"
    | "curriculum"
    | "performance"
    | "quizSessions"
    | "teacherFeedback"
    | "mentorship"
    | "holisticMentorship"
    | "visits",
    ReactNode
  >;
}): Array<{ id: string; label: string; content: ReactNode }> {
  const programScoped = (tabContent: ReactNode) =>
    hasNoCentreProgram ? noCentreProgramContent : tabContent;
  const candidates: Array<{ id: string; label: string; content: ReactNode; show: boolean }> = [
    { id: "enrollment", label: "Enrollment", content: content.enrollment, show: true },
    {
      id: "curriculum",
      label: "Curriculum",
      content: programScoped(content.curriculum),
      show: access.curriculum.canView,
    },
    {
      id: "performance",
      label: "Performance",
      content: programScoped(content.performance),
      show: access.performance.canView,
    },
    {
      id: "quiz_sessions",
      label: "Quiz Sessions",
      content: programScoped(content.quizSessions),
      show: access.quizSessions.canView,
    },
    {
      id: "teacher_feedback",
      label: "Teacher Feedback",
      content: content.teacherFeedback,
      show: access.teacherFeedback.canView,
    },
    { id: "mentorship", label: "Academic Mentorship", content: content.mentorship, show: access.mentorship.canView },
    {
      id: "holistic_mentorship",
      label: "Holistic Mentorship",
      content: content.holisticMentorship,
      show: Boolean(content.holisticMentorship),
    },
    { id: "visits", label: "School Visits", content: content.visits, show: access.visits.canView },
  ];
  return candidates
    .filter((tab) => tab.show)
    .map(({ id, label, content: tabContent }) => ({ id, label, content: tabContent }));
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
  fromHolisticProgress = false,
}: {
  scope: RosterScope;
  session: Session;
  // Raw `?program_id=` from the school page — which Holistic Mentorship program
  // to show when a school hosts more than one. Centre callers omit it: the
  // centre's own program is the answer (see holisticProgramChoices).
  holisticProgramParam?: string | string[];
  // Set only by the School route for the fixed `source=progress` marker. The
  // marker chooses a return destination; Holistic authorization still decides
  // whether the tab and its Program context exist.
  fromHolisticProgress?: boolean;
}) {
  const school = scope.school;
  const isCentre = scope.kind === "centre";

  // Single DB call for permission — reuse everywhere
  const permission = session.user?.email
    ? await getResolvedPermission(session.user.email)
    : null;

  if (!permission) {
    return <AccessDenied message={NO_PAGE_PERMISSION} />;
  }
  const schoolDenial = schoolAccessDenial(permission, scope);
  if (schoolDenial) return schoolDenial;

  if (permission.role === "holistic_mentorship_admin") {
    return renderHolisticAdminRoster({
      scope,
      session,
      permission,
      holisticProgramParam,
      fromHolisticProgress,
    });
  }

  const scopeDenial = centreScopeDenial(permission, scope);
  if (scopeDenial) return scopeDenial;

  // Derive everything from the single permission object — no extra DB calls
  const programContext = getProgramContextSync(permission);
  if (!programContext.hasAccess) return <NoProgramAccess />;

  const access = rosterFeatureAccess(permission);
  const { canAddStudent, canDownloadList, canDropoutStudent } = studentActionAccess(
    session,
    scope,
    permission,
    access.students.canEdit,
  );

  const { roster, grades, batches, supportedProgramIds } = await fetchRosterData(scope);
  const isPmu = isPmuRole(permission.role);
  const { students, dataIssues } = scopeRosterToRole(roster.students, roster.issues, isPmu);
  const { activeStudents, dropoutStudents } = splitActiveAndDropout(
    students,
    isPmu,
    supportedProgramIds,
  );

  const centre = centreProgramScope(scope);
  const { title, subtitle } = rosterHeading(scope);
  const programStatsList: ProgramStats[] = visibleEnrollmentProgramIds({
    students,
    supportedProgramIds,
    permission,
    userProgramIds: programContext.programIds,
    canAddStudent,
    isCentre,
    centreProgramId: centre.programId,
  }).map((id) => buildProgramStats(activeStudents, id));
  const defaultBackHref = defaultRosterBackHref(isCentre, permission);
  const schoolUdise = school.udise_code || school.code;

  const enrollmentContent = (
    <div>
      <DataIssuesBanner issues={dataIssues} />

      {/* Per-program enrollment stats + student table (both filtered by selected program) */}
      <EnrollmentTabContent
        programs={programStatsList}
        activeStudents={activeStudents}
        dropoutStudents={dropoutStudents}
        canEdit={access.students.canEdit}
        canEditStudent={access.students.canEdit}
        canDropoutStudent={canDropoutStudent}
        dropoutProgramIds={dropoutProgramIds(scope, canAddStudent)}
        canAddStudent={canAddStudent}
        canDownloadList={canDownloadList}
        userProgramIds={programContext.programIds}
        isAdmin={permission.role === "admin"}
        grades={grades}
        batches={batches}
        nvsStreams={getDistinctNVSStreams(batches)}
        schoolUdise={schoolUdise}
        schoolCode={school.code}
      />
    </div>
  );

  const mentorshipContent = await buildAcademicMentorshipContent({
    permission,
    school,
    canView: access.mentorship.canView,
    centre,
  });

  const holistic = resolveHolisticProgram(scope, permission, holisticProgramParam);
  const holisticContent = await buildHolisticMentorshipContent({
    session,
    permission,
    schoolCode: school.code,
    access: access.holisticMentorship,
    isCentre,
    centreProgramId: centre.programId,
    programId: holistic.programId,
    programChoices: holistic.choices,
    fromHolisticProgress,
  });
  const backHref =
    holisticProgressBackHref({
      isCentre,
      fromHolisticProgress,
      holisticContent,
      holisticProgramId: holistic.programId,
    }) ?? defaultBackHref;

  const tabs = visibleRosterTabs({
    access,
    hasNoCentreProgram: centre.hasNoProgram,
    noCentreProgramContent: <NoCentreProgram centreName={title} />,
    content: {
      enrollment: enrollmentContent,
      curriculum: (
        <CurriculumTab
          schoolCode={school.code}
          schoolName={school.name}
          canEdit={access.curriculum.canEdit}
          programId={centre.programId}
        />
      ),
      performance: (
        <PerformanceTab
          schoolUdise={schoolUdise}
          // PMU roles see only JNV NVS — the same lock a centre page uses.
          lockedProgram={isPmu ? PROGRAM_ID_TO_LABEL[PMU_PROGRAM_ID] : centre.programName}
        />
      ),
      quizSessions: (
        <QuizSessionsTab
          schoolId={school.id}
          canEdit={access.quizSessions.canEdit}
          programId={centre.programId}
        />
      ),
      // Teacher Feedback is centre-keyed data (a round belongs to a centre, and
      // teachers map to a centre, not the school), so a centre page passes its own
      // id: the rounds list and the setup picker both narrow to it, and the picker
      // collapses to the single centre. Without this a centre page would list a
      // sibling centre's rounds — the leak class fixed in the 07-22 review.
      teacherFeedback: (
        <TeacherFeedbackTab
          schoolCode={school.code}
          canEdit={access.teacherFeedback.canEdit}
          centreId={centre.centreId}
        />
      ),
      mentorship: mentorshipContent,
      holisticMentorship: holisticContent,
      visits: <VisitsTab schoolCode={school.code} canEdit={access.visits.canEdit} />,
    },
  });

  return (
    <RosterShell
      title={title}
      subtitle={subtitle}
      backHref={backHref}
      userEmail={session.user?.email || undefined}
      tabs={tabs}
      actions={
        access.visits.canEdit ? (
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
