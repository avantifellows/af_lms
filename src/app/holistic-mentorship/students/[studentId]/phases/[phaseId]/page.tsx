import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import StudentPhaseWorkspace from "@/components/holistic-mentorship/StudentPhaseWorkspace";
import { authOptions } from "@/lib/auth";
import { isHolisticMentorshipProgramId, PROGRAM_IDS } from "@/lib/constants";
import { coverageReturnQuery, splitCoverageReturn } from "@/lib/holistic-coverage-filters";
import {
  getHolisticDictationRemainingSeconds,
  holisticDictationSettings,
} from "@/lib/holistic-dictation";
import { holisticStudentPhaseHref, type HolisticStudentPhaseSource } from "@/lib/holistic-links";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import {
  getHolisticStudentPhase,
  type HolisticStudentPhaseDetail,
} from "@/lib/holistic-student-phase";
import {
  requireHolisticMentorshipAccess,
  type HolisticMentorshipSession,
} from "@/lib/holistic-mentorship";

type StudentPhasePageProps = {
  params: Promise<{ studentId: string; phaseId: string }>;
  searchParams: Promise<{
    school_code?: string;
    academic_year?: string;
    program_id?: string;
    source?: string;
    // The coverage view to return to: `centre_id` and the `hm_` filters.
    [returnParam: string]: string | string[] | undefined;
  }>;
};

function positiveInteger(value: string) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function requiredPositiveInteger(value: string) {
  const parsed = positiveInteger(value);
  if (parsed === null) notFound();
  return parsed;
}

async function studentPhaseRequest({ params, searchParams }: StudentPhasePageProps) {
  const [{ studentId: rawStudentId, phaseId: rawPhaseId }, queryParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const studentId = requiredPositiveInteger(rawStudentId);
  const phaseId = requiredPositiveInteger(rawPhaseId);
  const schoolCode = queryParams.school_code ?? "";
  const academicYear = queryParams.academic_year ?? "";
  const programId = Number(queryParams.program_id ?? PROGRAM_IDS.COE);
  const source = queryParams.source === "school" || queryParams.source === "school-progress" || queryParams.source === "progress"
    ? queryParams.source as HolisticStudentPhaseSource
    : undefined;
  const valid = [
    Boolean(schoolCode),
    isHolisticMentorshipProgramId(programId),
    validateAcademicYear(academicYear),
  ].every(Boolean);
  if (!valid) notFound();
  const returnQuery = source === "school" || source === "school-progress"
    ? coverageReturnQuery({ get: (name) => singleParam(queryParams[name]) })
    : "";
  return { studentId, phaseId, schoolCode, academicYear, programId, source, returnQuery };
}

function singleParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : null;
}

async function studentPhaseAccess(
  session: HolisticMentorshipSession,
  request: Awaited<ReturnType<typeof studentPhaseRequest>>
) {
  const access = await requireHolisticMentorshipAccess(session, "mapped_student_read", {
    schoolCode: request.schoolCode,
    studentId: request.studentId,
    academicYear: request.academicYear,
    programId: request.programId,
  });
  if (access.ok) return access;
  if (access.status === 404) notFound();
  redirect(access.status === 401 ? "/" : "/dashboard");
}

// Assignment Coverage opened on a Centre page returns to that Centre; otherwise
// to the School (keeping the Students & Progress origin). Both keep the filters.
function coverageBackHref(
  schoolCode: string,
  programId: number,
  source: "school" | "school-progress",
  returnQuery: string,
) {
  const { centreId, filterQuery } = splitCoverageReturn(returnQuery);
  const filters = filterQuery ? `&${filterQuery}` : "";
  if (centreId && source === "school") return `/centre/${centreId}?tab=holistic_mentorship${filters}`;
  const origin = source === "school-progress" ? "&source=progress" : "";
  return `/school/${schoolCode}?tab=holistic_mentorship&program_id=${programId}${filters}${origin}`;
}

function studentPhaseBackHref(
  role: string,
  schoolCode: string,
  programId: number,
  source?: HolisticStudentPhaseSource,
  returnQuery = "",
) {
  if (source === "progress") return `/admin/holistic-mentorship?program_id=${programId}`;
  if (source === "school" || source === "school-progress") {
    return coverageBackHref(schoolCode, programId, source, returnQuery);
  }
  const admin = role === "admin" || role === "holistic_mentorship_admin";
  return admin
    ? `/admin/holistic-mentorship?program_id=${programId}`
    : `/school/${schoolCode}?tab=holistic_mentorship`;
}

type PhaseNavigationItem = HolisticStudentPhaseDetail["phases"][number];

// Dictation (#500) is on only for the editing Mentor (a workspace that isn't
// read-only) while the server-side switch is on. The client never sees the settings.
async function studentPhaseDictation(detail: HolisticStudentPhaseDetail, actorUserId: number | undefined) {
  if (detail.readOnly || !actorUserId || !holisticDictationSettings().enabled) {
    return { enabled: false, remainingSeconds: 0 };
  }
  return {
    enabled: true,
    remainingSeconds: await getHolisticDictationRemainingSeconds(actorUserId, new Date()),
  };
}

function unlockedPhase(phase: PhaseNavigationItem) {
  return phase.phaseId !== null && "locked" in phase && !phase.locked;
}

function phaseInAcademicYear(phase: PhaseNavigationItem, academicYear: string) {
  return "academicYear" in phase && phase.academicYear === academicYear;
}

function preferredPhase(phases: PhaseNavigationItem[]) {
  return phases.find((phase) => "active" in phase && phase.active) ?? phases[0] ?? null;
}

function fallbackPhaseId(detail: HolisticStudentPhaseDetail, academicYear: string) {
  const available = detail.phases.filter(unlockedPhase);
  const currentYear = available.filter((phase) => phaseInAcademicYear(phase, academicYear));
  return preferredPhase(currentYear)?.phaseId ?? preferredPhase(available)?.phaseId ?? null;
}

function redirectFromLockedPhase(detail: HolisticStudentPhaseDetail, request: {
  studentId: number;
  schoolCode: string;
  academicYear: string;
  programId: number;
  source?: HolisticStudentPhaseSource;
  returnQuery: string;
}, role: string) {
  if (!("locked" in detail.selectedPhase) || !detail.selectedPhase.locked) return;
  const source = request.source;
  const phaseId = fallbackPhaseId(detail, request.academicYear);
  if (phaseId) {
    redirect(holisticStudentPhaseHref({
      studentId: request.studentId,
      phaseId,
      schoolCode: request.schoolCode,
      academicYear: request.academicYear,
      programId: request.programId,
      source,
      returnQuery: request.returnQuery,
    }));
  }
  redirect(studentPhaseBackHref(role, request.schoolCode, request.programId, source, request.returnQuery));
}

export default async function StudentPhasePage(props: StudentPhasePageProps) {
  const [session, request] = await Promise.all([
    getServerSession(authOptions),
    studentPhaseRequest(props),
  ]);
  const access = await studentPhaseAccess(session, request);

  const detail = await getHolisticStudentPhase({
    studentId: request.studentId,
    phaseId: request.phaseId,
    schoolId: access.school!.id,
    programId: request.programId,
    academicYear: request.academicYear,
    actorUserId: access.actorUserId,
    role: access.permission.role,
    canEdit: access.canEdit,
  });
  if (!detail) notFound();
  redirectFromLockedPhase(detail, request, access.permission.role);

  const source = request.source;
  const backHref = studentPhaseBackHref(
    access.permission.role,
    request.schoolCode,
    request.programId,
    source,
    request.returnQuery,
  );
  const dictation = await studentPhaseDictation(detail, access.actorUserId);
  const canRegenerateProfile = access.canEdit && (
    access.permission.role === "admin" ||
    access.permission.role === "holistic_mentorship_admin"
  );
  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Holistic Mentorship"
        subtitle={detail.readOnly ? undefined : access.school?.name}
        backHref={detail.readOnly ? undefined : backHref}
        userEmail={session?.user?.email ?? undefined}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <StudentPhaseWorkspace key={detail.student.id} detail={detail}
          schoolCode={request.schoolCode} academicYear={request.academicYear}
          programId={request.programId}
          source={source} returnQuery={request.returnQuery} backHref={backHref}
          canRegenerateProfile={canRegenerateProfile}
          viewerRole={access.permission.role} dictation={dictation} />
      </main>
    </div>
  );
}
