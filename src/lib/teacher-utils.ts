export interface Teacher {
  id: number;
  email: string;
  full_name: string | null;
}

export function getTeacherDisplayName(teacher: Teacher): string {
  return teacher.full_name || teacher.email;
}
