export interface UploadCsvRow {
  mentor_email?: unknown;
  student_id?: unknown;
}

export interface UploadMentor {
  id: number;
  email: string;
}

export interface UploadStudent {
  user_id: number;
  student_id: string;
  status?: string | null;
  selected_school_match_count: number | string;
  school_membership_count: number | string;
}

export interface UploadValidationError {
  row: number;
  field: "mentor_email" | "student_id";
  message: string;
}

export interface ValidatedUploadRow {
  row: number;
  mentor_id: number;
  mentee_id: number;
  mentor_email: string;
  student_id: string;
}

export interface UploadValidationResult {
  valid: boolean;
  errors: UploadValidationError[];
  validatedRows: ValidatedUploadRow[];
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeMentorEmail(value: unknown): string {
  return asTrimmedString(value).toLowerCase();
}

export function normalizeStudentId(value: unknown): string {
  return asTrimmedString(value);
}

export function validateUploadRows(
  rows: UploadCsvRow[],
  mentorMap: ReadonlyMap<string, UploadMentor>,
  studentMap: ReadonlyMap<string, UploadStudent[]>,
  existingMappings: ReadonlySet<number>
): UploadValidationResult {
  const errors: UploadValidationError[] = [];
  const validatedRows: ValidatedUploadRow[] = [];
  const seenStudentIds = new Set<string>();

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const mentorEmail = normalizeMentorEmail(row.mentor_email);
    const studentId = normalizeStudentId(row.student_id);
    const mentor = mentorEmail ? mentorMap.get(mentorEmail) : undefined;
    const students = studentId ? studentMap.get(studentId) ?? [] : [];
    let resolvedStudent: UploadStudent | null = null;

    if (!mentorEmail) {
      errors.push({ row: rowNumber, field: "mentor_email", message: "mentor_email is required" });
    } else if (!mentor) {
      errors.push({
        row: rowNumber,
        field: "mentor_email",
        message: "Mentor is not eligible at this school",
      });
    }

    if (!studentId) {
      errors.push({ row: rowNumber, field: "student_id", message: "student_id is required" });
    } else if (seenStudentIds.has(studentId)) {
      errors.push({ row: rowNumber, field: "student_id", message: "Duplicate student_id in upload" });
    } else if (students.length === 0) {
      errors.push({ row: rowNumber, field: "student_id", message: "Student not found" });
    } else if (students.length > 1) {
      errors.push({
        row: rowNumber,
        field: "student_id",
        message: "Multiple students found for student_id",
      });
    } else {
      resolvedStudent = students[0];
      if (resolvedStudent.status === "dropout") {
        errors.push({ row: rowNumber, field: "student_id", message: "Student is a dropout" });
      } else if (Number(resolvedStudent.selected_school_match_count) !== 1) {
        errors.push({
          row: rowNumber,
          field: "student_id",
          message: "Student is not enrolled at selected school",
        });
      } else if (Number(resolvedStudent.school_membership_count) !== 1) {
        errors.push({
          row: rowNumber,
          field: "student_id",
          message: "Student has multiple school memberships",
        });
      } else if (existingMappings.has(resolvedStudent.user_id)) {
        errors.push({
          row: rowNumber,
          field: "student_id",
          message: "Student already has an active mentor",
        });
      }
    }

    if (studentId) {
      seenStudentIds.add(studentId);
    }

    if (mentor && resolvedStudent) {
      validatedRows.push({
        row: rowNumber,
        mentor_id: mentor.id,
        mentee_id: resolvedStudent.user_id,
        mentor_email: mentorEmail,
        student_id: studentId,
      });
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    validatedRows,
  };
}
