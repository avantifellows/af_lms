export interface Student {
  id: number;
  full_name: string | null;
  student_id: string | null;
  grade: number | null;
}

export function getStudentDisplayName(student: Student): string {
  const trimmed = student.full_name?.trim();
  if (trimmed) return trimmed;
  if (student.student_id) return student.student_id;
  return `Student #${student.id}`;
}
