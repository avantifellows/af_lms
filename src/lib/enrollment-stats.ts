import { PROGRAM_ID_TO_LABEL } from "./constants";

export interface ProgramStats {
  id: number;
  label: string;
  total: number;
  byGrade: { grade: number; count: number }[];
  byGender: { value: string; count: number }[];
  byCategory: { value: string; count: number }[];
}

type StudentForStats = {
  program_id: number | null;
  student_program_ids?: Array<number | string> | null;
  dropout_program_ids?: Array<number | string> | null;
  status?: string | null;
  grade: number | null;
  gender: string | null;
  category: string | null;
};

export function studentHasCurrentProgram(
  student: Pick<StudentForStats, "program_id" | "student_program_ids">,
  programId: number,
): boolean {
  if (Array.isArray(student.student_program_ids)) {
    return student.student_program_ids.map(Number).includes(programId);
  }
  return Number(student.program_id) === programId;
}

export function studentDroppedFromProgram(
  student: Pick<
    StudentForStats,
    "dropout_program_ids" | "program_id" | "status"
  >,
  programId: number,
): boolean {
  return (
    (student.dropout_program_ids ?? []).map(Number).includes(programId) ||
    (student.status === "dropout" && Number(student.program_id) === programId)
  );
}

export function buildProgramStats(
  students: StudentForStats[],
  programId: number,
): ProgramStats {
  const scoped = students.filter((s) => studentHasCurrentProgram(s, programId));

  const gradeMap = new Map<number, number>();
  const genderMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();
  for (const s of scoped) {
    if (s.grade != null)
      gradeMap.set(s.grade, (gradeMap.get(s.grade) ?? 0) + 1);
    const g = s.gender?.trim() || "Unspecified";
    genderMap.set(g, (genderMap.get(g) ?? 0) + 1);
    const c = s.category?.trim() || "Unspecified";
    categoryMap.set(c, (categoryMap.get(c) ?? 0) + 1);
  }

  return {
    id: programId,
    label: PROGRAM_ID_TO_LABEL[programId] || `Program ${programId}`,
    total: scoped.length,
    byGrade: [...gradeMap.entries()]
      .map(([grade, count]) => ({ grade, count }))
      .sort((a, b) => a.grade - b.grade),
    byGender: [...genderMap.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
    byCategory: [...categoryMap.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count),
  };
}
