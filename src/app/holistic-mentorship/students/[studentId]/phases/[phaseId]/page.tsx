import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import StudentPhaseWorkspace from "@/components/holistic-mentorship/StudentPhaseWorkspace";
import { authOptions } from "@/lib/auth";
import { isHolisticMentorshipProgramId, PROGRAM_IDS } from "@/lib/constants";
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

async function studentPhaseRequest({ params, searchParams }: StudentPhasePageProps) {
  const [{ studentId: rawStudentId, phaseId: rawPhaseId }, queryParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const studentId = positiveInteger(rawStudentId);
  const phaseId = positiveInteger(rawPhaseId);
  const schoolCode = queryParams.school_code ?? "";
  const academicYear = queryParams.academic_year ?? "";
  const programId = queryParams.program_id === undefined
    ? PROGRAM_IDS.COE
    : Number(queryParams.program_id);
  const source = queryParams.source === "school" ? "school" as const : undefined;
  if (studentId === null || phaseId === null || !schoolCode ||
      !isHolisticMentorshipProgramId(programId) ||
      !validateAcademicYear(academicYear)) notFound();
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

function studentPhaseHref(
  studentId: number,
  phaseId: number,
  schoolCode: string,
  academicYear: string,
  programId: number,
  source?: "school",
) {
  const query = new URLSearchParams({
    school_code: schoolCode,
    academic_year: academicYear,
    program_id: String(programId),
  });
  if (source) query.set("source", source);
  return `/holistic-mentorship/students/${studentId}/phases/${phaseId}?${query}`;
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
    redirect(studentPhaseHref(
      request.studentId,
      phaseId,
      request.schoolCode,
      request.academicYear,
      request.programId,
      source,
    ));
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
          source={source} backHref={backHref} />
      </main>
    </div>
  );
}
