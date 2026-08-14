import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import StudentPhaseWorkspace from "@/components/holistic-mentorship/StudentPhaseWorkspace";
import { authOptions } from "@/lib/auth";
import { isHolisticMentorshipProgramId, PROGRAM_IDS } from "@/lib/constants";
import { holisticStudentPhaseHref } from "@/lib/holistic-links";
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
  const source = queryParams.source === "school" ? "school" as const : undefined;
  const valid = [
    Boolean(schoolCode),
    isHolisticMentorshipProgramId(programId),
    validateAcademicYear(academicYear),
  ].every(Boolean);
  if (!valid) notFound();
  return { studentId, phaseId, schoolCode, academicYear, programId, source };
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

function studentPhaseBackHref(
  role: string,
  schoolCode: string,
  programId: number,
  source?: "school",
) {
  if (role === "admin" && source === "school") {
    return `/school/${schoolCode}?tab=holistic_mentorship`;
  }
  const admin = role === "admin" || role === "holistic_mentorship_admin";
  return admin
    ? `/admin/holistic-mentorship?program_id=${programId}`
    : `/school/${schoolCode}?tab=holistic_mentorship`;
}

type PhaseNavigationItem = HolisticStudentPhaseDetail["phases"][number];

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
  source?: "school";
}, role: string) {
  if (!("locked" in detail.selectedPhase) || !detail.selectedPhase.locked) return;
  const source = role === "admin" ? request.source : undefined;
  const phaseId = fallbackPhaseId(detail, request.academicYear);
  if (phaseId) {
    redirect(holisticStudentPhaseHref({
      studentId: request.studentId,
      phaseId,
      schoolCode: request.schoolCode,
      academicYear: request.academicYear,
      programId: request.programId,
      source,
    }));
  }
  redirect(studentPhaseBackHref(role, request.schoolCode, request.programId, source));
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

  const source = access.permission.role === "admin" ? request.source : undefined;
  const backHref = studentPhaseBackHref(
    access.permission.role,
    request.schoolCode,
    request.programId,
    source,
  );
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
          source={source} backHref={backHref}
          canRegenerateProfile={canRegenerateProfile}
          viewerRole={access.permission.role} />
      </main>
    </div>
  );
}
