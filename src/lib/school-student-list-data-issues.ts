import { query } from "./db";

export interface DataIssue {
  type: "duplicate_grade" | "multiple_schools";
  studentName: string;
  groupUserId: string;
  details: string;
}

// Minimal fields needed by issue checks — any student object with these fields works
interface StudentRow {
  group_user_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  grade: number | null;
}

/**
 * Deduplicate students and detect all data issues.
 * The school page calls this once and gets back clean students + issues.
 */
export async function processStudents<T extends StudentRow>(
  students: T[],
): Promise<{ students: T[]; issues: DataIssue[] }> {
  // Step 1: Deduplicate (detects duplicate grade enrollments)
  const { students: deduped, issues } = deduplicateRows(students);

  // Step 2: Check for students in multiple schools
  const multiSchoolIssues = await checkMultipleSchools(deduped);
  issues.push(...multiSchoolIssues);

  return { students: deduped, issues };
}

// --- Private check functions ---

function deduplicateRows<T extends StudentRow>(students: T[]): { students: T[]; issues: DataIssue[] } {
  const grouped = new Map<string, T[]>();
  for (const s of students) {
    const existing = grouped.get(s.group_user_id);
    if (existing) {
      existing.push(s);
    } else {
      grouped.set(s.group_user_id, [s]);
    }
  }

  const deduped: T[] = [];
  const issues: DataIssue[] = [];

  for (const [, rows] of grouped) {
    if (rows.length > 1) {
      const grades = [...new Set(rows.map((r) => r.grade).filter((g): g is number => g !== null))].sort((a, b) => b - a);
      const name = studentName(rows[0]);
      issues.push({
        type: "duplicate_grade",
        studentName: name,
        groupUserId: rows[0].group_user_id,
        details: `Multiple current grade enrollments: ${grades.map((g) => `Grade ${g}`).join(", ")}`,
      });
      // Keep the row with the highest grade (latest enrollment)
      rows.sort((a, b) => (b.grade ?? 0) - (a.grade ?? 0));
    }
    deduped.push(rows[0]);
  }

  return { students: deduped, issues };
}

async function checkMultipleSchools<T extends StudentRow>(students: T[]): Promise<DataIssue[]> {
  const userIds = [...new Set(students.map((s) => s.user_id))];
  if (userIds.length === 0) return [];

  const rows = await query<{ user_id: string; school_names: string[] }>(
    `SELECT gu.user_id, array_agg(DISTINCT s.name) as school_names
     FROM group_user gu
     JOIN "group" g ON gu.group_id = g.id AND g.type = 'school'
     JOIN school s ON g.child_id = s.id AND s.af_school_category = 'JNV'
     WHERE gu.user_id = ANY($1)
     GROUP BY gu.user_id
     HAVING COUNT(DISTINCT g.child_id) > 1`,
    [userIds]
  );

  if (rows.length === 0) return [];

  const userToStudent = new Map(students.map((s) => [s.user_id, s]));
  const issues: DataIssue[] = [];

  for (const row of rows) {
    const student = userToStudent.get(String(row.user_id));
    if (student) {
      issues.push({
        type: "multiple_schools",
        studentName: studentName(student),
        groupUserId: student.group_user_id,
        details: `Enrolled in ${row.school_names.length} schools: ${row.school_names.join(", ")}`,
      });
    }
  }

  return issues;
}

function studentName(s: StudentRow): string {
  return [s.first_name, s.last_name].filter(Boolean).join(" ") || "Unknown";
}
