import type { RemarkEntry } from "./visit-summary";
import {
  ACTION_ADDITIONAL_NOTES_KEY,
  validateActionAdditionalNotes,
} from "./visit-form-utils";

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

export interface PrincipalInteractionConfig {
  sections: SectionConfig[];
  allQuestionKeys: string[];
}

export interface PrincipalInteractionData {
  questions: Record<string, { answer: boolean | null; remark?: string }>;
  additional_notes?: string;
}

const sections: SectionConfig[] = [
  {
    title: "Operational Health",
    questions: [
      {
        key: "oh_program_feedback",
        label:
          "Does the Principal have any feedback or concerns on the program implementation?",
      },
    ],
  },
  {
    title: "Implementation Progress",
    questions: [
      {
        key: "ip_curriculum_progress",
        label:
          "Were you able to provide an update of curriculum progress with the Principal?",
      },
      {
        key: "ip_key_events",
        label:
          "Were you able to provide an update of other key events with the Principal?",
      },
    ],
  },
  {
    title: "Student Performance on Monthly Tests",
    questions: [
      {
        key: "sp_student_performance",
        label: "Did you share and discuss the student performance?",
      },
    ],
  },
  {
    title: "Support Needed",
    questions: [
      {
        key: "sn_concerns_raised",
        label:
          "Were there any requests or concerns raised to the Principal?",
      },
    ],
  },
  {
    title: "Monthly Planning",
    questions: [
      {
        key: "mp_monthly_plan",
        label:
          "Is the plan for the upcoming month discussed with the Principal?",
      },
      {
        key: "mp_permissions_obtained",
        label:
          "Were the necessary permissions obtained for upcoming activities?",
      },
    ],
  },
];

export const PRINCIPAL_INTERACTION_CONFIG: PrincipalInteractionConfig = {
  sections,
  allQuestionKeys: sections.flatMap((s) => s.questions.map((q) => q.key)),
};

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "questions",
  ACTION_ADDITIONAL_NOTES_KEY,
]);

const questionKeyToLabel = new Map<string, string>(
  PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys.map((key) => {
    const question = sections
      .flatMap((s) => s.questions)
      .find((q) => q.key === key)!;
    return [key, question.label];
  })
);

const knownQuestionKeys = new Set(PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

export function validatePrincipalInteractionSave(data: unknown): ValidationResult {
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
  errors.push(...validateActionAdditionalNotes(payload));

  if ("questions" in payload) {
    errors.push(...validateQuestions(payload.questions, false));
  }

  return { valid: errors.length === 0, errors };
}

export function validatePrincipalInteractionComplete(data: unknown): ValidationResult {
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
  errors.push(...validateActionAdditionalNotes(payload));

  errors.push(...validateQuestions(payload.questions, true));

  return { valid: errors.length === 0, errors };
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function extractRemarks(data: unknown): RemarkEntry[] {
  if (!isPlainObject(data) || !isPlainObject(data.questions)) {
    return [];
  }

  const remarks: RemarkEntry[] = [];
  for (const section of PRINCIPAL_INTERACTION_CONFIG.sections) {
    for (const question of section.questions) {
      const answer = data.questions[question.key];
      if (!isPlainObject(answer)) {
        continue;
      }
      const text = nonEmptyString(answer.remark);
      if (text) {
        remarks.push({ label: question.label, text });
      }
    }
  }
  return remarks;
}

export function computeInlineStats(data: unknown): {
  answeredCount: number;
  totalQuestions: number;
} | null {
  if (!isPlainObject(data) || !isPlainObject(data.questions)) {
    return null;
  }

  let answeredCount = 0;
  for (const key of PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys) {
    const answer = data.questions[key];
    if (isPlainObject(answer) && typeof answer.answer === "boolean") {
      answeredCount += 1;
    }
  }

  return {
    answeredCount,
    totalQuestions: PRINCIPAL_INTERACTION_CONFIG.allQuestionKeys.length,
  };
}
