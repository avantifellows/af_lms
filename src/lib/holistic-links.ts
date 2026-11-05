import { coverageReturnQuery } from "@/lib/holistic-coverage-filters";

export type HolisticStudentPhaseSource = "school" | "school-progress" | "progress";

export function holisticStudentPhaseHref(params: {
  studentId: number;
  phaseId: number;
  schoolCode: string;
  academicYear: string;
  programId: number;
  source?: HolisticStudentPhaseSource;
  /** The coverage view to return to (see `coverageReturnQuery`). */
  returnQuery?: string;
}) {
  const query = new URLSearchParams({
    school_code: params.schoolCode,
    academic_year: params.academicYear,
    program_id: String(params.programId),
  });
  if (params.source) query.set("source", params.source);
  const returnTo = new URLSearchParams(coverageReturnQuery(new URLSearchParams(params.returnQuery)));
  for (const [name, value] of returnTo) query.set(name, value);
  return `/holistic-mentorship/students/${params.studentId}/phases/${params.phaseId}?${query}`;
}
