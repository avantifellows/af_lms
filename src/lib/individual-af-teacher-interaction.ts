export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface QuestionConfig {
  key: string;
  label: string;
}

export interface SectionConfig {
  title: string;
  questions: QuestionConfig[];
}

export interface IndividualAFTeacherInteractionConfig {
  sections: SectionConfig[];
  allQuestionKeys: string[];
}

export const ATTENDANCE_OPTIONS = ["present", "on_leave", "absent"] as const;
export type Attendance = (typeof ATTENDANCE_OPTIONS)[number];

export interface IndividualTeacherEntry {
  id: number;
  name: string;
  attendance: Attendance;
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}

export interface IndividualAFTeacherInteractionData {
  teachers: IndividualTeacherEntry[];
}

const sections: SectionConfig[] = [
  {
    title: "Operational Health",
    questions: [
      { key: "oh_class_duration", label: "Does the teacher get the required duration of classes?" },
    ],
  },
  {
    title: "Syllabus Track",
    questions: [
      { key: "st_grade11_syllabus", label: "Is grade 11 syllabus on track?" },
      { key: "st_grade11_testing", label: "Is grade 11 testing on track?" },
      { key: "st_grade12_syllabus", label: "Is grade 12 syllabus on track?" },
      { key: "st_grade12_testing", label: "Is grade 12 testing on track?" },
    ],
  },
  {
    title: "Student Performance on Monthly Tests",
    questions: [
      { key: "sp_student_performance", label: "Are there concerns related to student performance in their subject?" },
      { key: "sp_girls_performance", label: "Are there concerns related to girl student performance in their subject?" },
    ],
  },
  {
    title: "Support Needed",
    questions: [
      { key: "sn_academics", label: "Does this teacher need assistance on academics?" },
      { key: "sn_school_operations", label: "Does the teacher need assistance in school operations?" },
      { key: "sn_co_curriculars", label: "Does the teacher need assistance on co-curriculars?" },
    ],
  },
  {
    title: "Monthly Planning",
    questions: [
      { key: "mp_monthly_plan", label: "Is the plan for upcoming month discussed with the teacher?" },
      { key: "mp_classroom_observations", label: "Have you discussed the observations from the classroom?" },
      { key: "mp_student_feedback", label: "Have you discussed the student feedback with the teacher?" },
    ],
  },
];

export const INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG: IndividualAFTeacherInteractionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};

const ALLOWED_TOP_LEVEL_KEYS = new Set(["teachers"]);

const questionKeyToLabel = new Map<string, string>(
  INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys.map((key) => {
    const question = sections
      .flatMap((s) => s.questions)
      .find((q) => q.key === key)!;
    return [key, question.label];
  })
);

const knownQuestionKeys = new Set(INDIVIDUAL_AF_TEACHER_INTERACTION_CONFIG.allQuestionKeys);
const attendanceSet = new Set<string>(ATTENDANCE_OPTIONS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTeacherEntries(teachers: unknown, strict: boolean): string[] {
  const errors: string[] = [];

  if (!Array.isArray(teachers)) {
    errors.push("teachers must be an array");
    return errors;
  }

  const seenIds = new Set<number>();

  for (let i = 0; i < teachers.length; i++) {
    const entry = teachers[i];

    if (!isPlainObject(entry)) {
      errors.push(`Teacher entry ${i}: must be an object`);
      continue;
    }

    const record = entry as Record<string, unknown>;

    // Validate id
    const id = record.id;
    if (
      typeof id !== "number" ||
      !Number.isFinite(id) ||
      id <= 0 ||
      !Number.isInteger(id)
    ) {
      errors.push(`Teacher entry ${i}: id must be a positive integer`);
    } else {
      if (seenIds.has(id)) {
        errors.push(`Duplicate teacher id: ${id}`);
      }
      seenIds.add(id);
    }

    // Validate name
    const name = record.name;
    if (typeof name !== "string" || name === "") {
      errors.push(`Teacher entry ${i}: name must be a non-empty string`);
    }

    const teacherName = typeof name === "string" && name !== "" ? name : `Entry ${i}`;

    // Validate attendance
    const attendance = record.attendance;
    if (attendance !== undefined) {
      if (typeof attendance !== "string" || !attendanceSet.has(attendance)) {
        errors.push(`Teacher entry ${i}: attendance must be present, on_leave, or absent`);
      }
    } else if (strict) {
      errors.push(`Teacher ${teacherName}: attendance is required`);
    }

    // Validate questions
    const questions = record.questions;
    if (questions !== undefined) {
      if (!isPlainObject(questions)) {
        errors.push(`Teacher entry ${i}: questions must be an object`);
      } else {
        const questionsRecord = questions as Record<string, unknown>;
        for (const key of knownQuestionKeys) {
          const label = questionKeyToLabel.get(key)!;
          const value = questionsRecord[key];

          if (value === undefined) {
            if (strict && attendance === "present") {
              errors.push(`Teacher ${teacherName}: ${label}: answer is required`);
            }
            continue;
          }

          if (!isPlainObject(value)) {
            errors.push(`Teacher ${teacherName}: ${label}: must be an object`);
            continue;
          }

          const qEntry = value as Record<string, unknown>;

          if ("answer" in qEntry) {
            const answer = qEntry.answer;
            if (answer !== null && typeof answer !== "boolean") {
              errors.push(`Teacher ${teacherName}: ${label}: answer must be true, false, or null`);
            } else if (strict && attendance === "present" && answer === null) {
              errors.push(`Teacher ${teacherName}: ${label}: answer is required`);
            }
          } else if (strict && attendance === "present") {
            errors.push(`Teacher ${teacherName}: ${label}: answer is required`);
          }

          if ("remark" in qEntry && qEntry.remark !== undefined && typeof qEntry.remark !== "string") {
            errors.push(`Teacher ${teacherName}: ${label}: remark must be a string`);
          }
        }

        // In strict mode for present teachers, questions must exist for all keys
        if (strict && attendance === "present") {
          for (const key of knownQuestionKeys) {
            if (!(key in questionsRecord)) {
              const label = questionKeyToLabel.get(key)!;
              // Only add if not already reported above
              const alreadyReported = errors.some(
                (e) => e.includes(label) && e.includes("answer is required")
              );
              if (!alreadyReported) {
                errors.push(`Teacher ${teacherName}: ${label}: answer is required`);
              }
            }
          }
        }
      }
    } else if (strict && attendance === "present") {
      errors.push(`Teacher ${teacherName}: all questions must be answered`);
    }
  }

  return errors;
}

export function validateIndividualTeacherSave(data: unknown): ValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, errors: ["Data must be an object"] };
  }

  const errors: string[] = [];
  const payload = data as Record<string, unknown>;

  const unknownKeys = Object.keys(payload)
    .filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key))
    .sort();
  for (const key of unknownKeys) {
    errors.push(`Unknown field: ${key}`);
  }

  if ("teachers" in payload) {
    errors.push(...validateTeacherEntries(payload.teachers, false));
  }

  return { valid: errors.length === 0, errors };
}

export function validateIndividualTeacherComplete(data: unknown): ValidationResult {
  if (!isPlainObject(data)) {
    return { valid: false, errors: ["Data must be an object"] };
  }

  const errors: string[] = [];
  const payload = data as Record<string, unknown>;

  const unknownKeys = Object.keys(payload)
    .filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key))
    .sort();
  for (const key of unknownKeys) {
    errors.push(`Unknown field: ${key}`);
  }

  if (!("teachers" in payload) || !Array.isArray(payload.teachers) || payload.teachers.length === 0) {
    errors.push("At least one teacher must be recorded");
  }

  if ("teachers" in payload) {
    errors.push(...validateTeacherEntries(payload.teachers, true));
  }

  return { valid: errors.length === 0, errors };
}
