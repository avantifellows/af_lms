export function holisticStudentPhaseHref(params: {
  studentId: number;
  phaseId: number;
  schoolCode: string;
  academicYear: string;
  programId: number;
  source?: "school" | "progress";
}) {
  const query = new URLSearchParams({
    school_code: params.schoolCode,
    academic_year: params.academicYear,
    program_id: String(params.programId),
  });
  if (params.source) query.set("source", params.source);
  return `/holistic-mentorship/students/${params.studentId}/phases/${params.phaseId}?${query}`;
}
