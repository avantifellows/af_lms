export interface Student {
  id: number;
  full_name: string | null;
  student_id: string | null;
  grade: number | null;
}

// Chip colours for a student's social category. Shared so the Enrollment
// roster and the Performance student-results table can't drift apart.
export function getCategoryColor(category: string | null): string {
  switch (category) {
    case "Gen":
      return "bg-green-100 text-green-800";
    case "OBC":
      return "bg-hover-bg text-accent-hover";
    case "SC":
      return "bg-purple-100 text-purple-800";
    case "ST":
      return "bg-orange-100 text-orange-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
}

export function getStudentDisplayName(student: Student): string {
  const trimmed = student.full_name?.trim();
  if (trimmed) return trimmed;
  if (student.student_id) return student.student_id;
  return `Student #${student.id}`;
}
