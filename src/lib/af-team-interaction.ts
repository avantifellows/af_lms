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

export interface AFTeamInteractionConfig {
  sections: SectionConfig[];
  allQuestionKeys: string[];
}

export interface AFTeamInteractionData {
  teachers: Array<{ id: number; name: string }>;
  questions: Record<string, { answer: boolean | null; remark?: string }>;
}

const sections: SectionConfig[] = [
  {
    title: "Operational Health",
    questions: [
      { key: "op_class_duration", label: "Does the teacher get the required duration of classes?" },
      { key: "op_centre_resources", label: "Is the centre capacitated with all required resources?" },
      { key: "op_other_disruptions", label: "Any other disruptions caused in the implementation?" },
    ],
  },
  {
    title: "Student Performance on Monthly Tests",
    questions: [
      { key: "sp_student_performance", label: "Are there concerns related to student performance?" },
      { key: "sp_girls_performance", label: "Are there concerns related to girls student performance?" },
    ],
  },
  {
    title: "Support Needed",
    questions: [
      { key: "sn_academics", label: "Does the teacher need assistance on academics?" },
      { key: "sn_school_operations", label: "Does the teacher need assistance in school operations?" },
      { key: "sn_co_curriculars", label: "Does the teacher need assistance on co-curriculars?" },
    ],
  },
  {
    title: "Monthly Planning",
    questions: [
      { key: "mp_monthly_plan", label: "Is the plan for upcoming month discussed with teachers?" },
    ],
  },
];

export const AF_TEAM_INTERACTION_CONFIG: AFTeamInteractionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};

const ALLOWED_TOP_LEVEL_KEYS = new Set(["teachers", "questions"]);

const questionKeyToLabel = new Map<string, string>(
  AF_TEAM_INTERACTION_CONFIG.allQuestionKeys.map((key) => {
    const question = sections
      .flatMap((s) => s.questions)
      .find((q) => q.key === key)!;
    return [key, question.label];
  })
);

const knownQuestionKeys = new Set(AF_TEAM_INTERACTION_CONFIG.allQuestionKeys);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTeachers(teachers: unknown): string[] {
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
    const id = (entry as Record<string, unknown>).id;
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
    const name = (entry as Record<string, unknown>).name;
    if (typeof name !== "string" || name === "") {
      errors.push(`Teacher entry ${i}: name must be a non-empty string`);
    }
  }
  return errors;
}

function validateQuestions(questions: unknown, strict: boolean): string[] {
  const errors: string[] = [];

  if (questions === undefined) {
    if (strict) {
      errors.push("All questions must be answered");
    }
    return errors;
  }

  if (!isPlainObject(questions)) {
    errors.push("questions must be an object");
    return errors;
  }

  const questionsRecord = questions as Record<string, unknown>;

  for (const key of knownQuestionKeys) {
    const label = questionKeyToLabel.get(key)!;
    const value = questionsRecord[key];

    if (value === undefined) {
      if (strict) {
        errors.push(`${label}: answer is required`);
      }
      continue;
    }

    if (!isPlainObject(value)) {
      errors.push(`${label}: must be an object`);
      continue;
    }

    const entry = value as Record<string, unknown>;

    if ("answer" in entry) {
      const answer = entry.answer;
      if (answer !== null && typeof answer !== "boolean") {
        errors.push(`${label}: answer must be true, false, or null`);
      } else if (strict && answer === null) {
        errors.push(`${label}: answer is required`);
      }
    } else if (strict) {
      errors.push(`${label}: answer is required`);
    }

    if ("remark" in entry && entry.remark !== undefined && typeof entry.remark !== "string") {
      errors.push(`${label}: remark must be a string`);
    }
  }

  return errors;
}

export function validateAFTeamInteractionSave(data: unknown): ValidationResult {
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
    errors.push(...validateTeachers(payload.teachers));
  }

  if ("questions" in payload) {
    errors.push(...validateQuestions(payload.questions, false));
  }

  return { valid: errors.length === 0, errors };
}

export function validateAFTeamInteractionComplete(data: unknown): ValidationResult {
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
    errors.push("At least one teacher must be selected");
  }

  if ("teachers" in payload) {
    errors.push(...validateTeachers(payload.teachers));
  }

  errors.push(...validateQuestions(payload.questions, true));

  return { valid: errors.length === 0, errors };
}
