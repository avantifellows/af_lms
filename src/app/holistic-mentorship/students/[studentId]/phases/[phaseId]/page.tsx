import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import PageHeader from "@/components/PageHeader";
import StudentPhaseWorkspace from "@/components/holistic-mentorship/StudentPhaseWorkspace";
import { authOptions } from "@/lib/auth";
import { validateAcademicYear } from "@/lib/holistic-phase-plans";
import { getHolisticStudentPhase } from "@/lib/holistic-student-phase";
import { requireHolisticMentorshipAccess } from "@/lib/holistic-mentorship";

export default async function StudentPhasePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string; phaseId: string }>;
  searchParams: Promise<{ school_code?: string; academic_year?: string }>;
}) {
  const session = await getServerSession(authOptions);
  const [{ studentId: rawStudentId, phaseId: rawPhaseId }, queryParams] = await Promise.all([
    params,
    searchParams,
  ]);
  const studentId = Number(rawStudentId);
  const phaseId = Number(rawPhaseId);
  const schoolCode = queryParams.school_code ?? "";
  const academicYear = queryParams.academic_year ?? "";
  if (!Number.isInteger(studentId) || studentId < 1 || !Number.isInteger(phaseId) || phaseId < 1 ||
      !schoolCode || !validateAcademicYear(academicYear)) {
    notFound();
  }

  const access = await requireHolisticMentorshipAccess(session, "mapped_student_read", {
    schoolCode,
    studentId,
    academicYear,
  });
  if (!access.ok) {
    if (access.status === 404) notFound();
    redirect(access.status === 401 ? "/" : "/dashboard");
  }

  const detail = await getHolisticStudentPhase({
    studentId,
    phaseId,
    schoolId: access.school!.id,
    academicYear,
    actorUserId: access.actorUserId,
    role: access.permission.role,
    canEdit: access.canEdit,
  });
  if (!detail) notFound();

  const admin = access.permission.role === "admin" || access.permission.role === "holistic_mentorship_admin";
  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title="Holistic Mentorship"
        subtitle={access.school?.name}
        backHref={admin ? "/admin/holistic-mentorship" : `/school/${schoolCode}?tab=holistic-mentorship`}
        userEmail={session?.user?.email ?? undefined}
      />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <StudentPhaseWorkspace detail={detail} schoolCode={schoolCode} academicYear={academicYear} />
      </main>
    </div>
  );
}
