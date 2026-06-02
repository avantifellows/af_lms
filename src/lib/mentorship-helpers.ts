import { query } from "@/lib/db";

export interface TeacherMentorRow {
  id: number;
  email: string;
  full_name: string | null;
}

export function getMentorDisplayName(mentor: Pick<TeacherMentorRow, "email" | "full_name">): string {
  const name = mentor.full_name?.trim();
  return name || mentor.email;
}

export async function getTeacherIdsAtSchool(schoolCode: string): Promise<TeacherMentorRow[]> {
  return query<TeacherMentorRow>(
    `SELECT id, email, full_name
     FROM user_permission
     WHERE role = 'teacher'
       AND school_codes @> ARRAY[$1]::text[]
     ORDER BY COALESCE(NULLIF(TRIM(full_name), ''), email)`,
    [schoolCode]
  );
}
