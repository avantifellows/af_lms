export interface RubricOption {
  label: string;
  score: number;
}

export interface RubricParameter {
  key: string;
  label: string;
  description?: string;
  maxScore: number;
  options: RubricOption[];
}

export interface SessionField {
  key: string;
  label: string;
  placeholder: string;
}

export interface RubricConfig {
  version: string;
  maxScore: number;
  parameters: RubricParameter[];
  sessionFields: SessionField[];
}

export interface ParamData {
  score: number;
  remarks?: string;
}

export interface ClassroomObservationData {
  rubric_version: string;
  params: Record<string, ParamData>;
  observer_summary_strengths?: string;
  observer_summary_improvements?: string;
  teacher_id?: number;
  teacher_name?: string;
  grade?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export const CURRENT_RUBRIC_VERSION = "1.0";

export const CLASSROOM_OBSERVATION_RUBRIC: RubricConfig = {
  version: CURRENT_RUBRIC_VERSION,
  maxScore: 45,
  parameters: [
    {
      key: "teacher_on_time",
      label: "Teacher started the class on time",
      maxScore: 1,
      options: [
        { label: "No", score: 0 },
        { label: "Yes", score: 1 },
      ],
    },
    {
      key: "teacher_grooming",
      label: "Teacher Grooming",
      description: "The teacher is formally dressed with proper grooming.",
      maxScore: 1,
      options: [
        { label: "No", score: 0 },
        { label: "Yes", score: 1 },
      ],
    },
    {
      key: "start_note",
      label: "Start Note of the Class",
      description:
        "Greetings to students and general discussion to gather the attention of all students.",
      maxScore: 1,
      options: [
        { label: "No", score: 0 },
        { label: "Yes", score: 1 },
      ],
    },
    {
      key: "pre_task_hw",
      label: "Class structure - Pre-task / Check for HW",
      description: "The teacher is discussing any previous task assigned.",
      maxScore: 1,
      options: [
        { label: "No", score: 0 },
        { label: "Yes", score: 1 },
      ],
    },
    {
      key: "recall_test",
      label: "Class structure - Recall / Recall test",
      description:
        "Recall should include two-way communication with simple questions where possible.",
      maxScore: 2,
      options: [
        { label: "Recall is not done", score: 0 },
        { label: "Recall done without questions or taking more than allotted time", score: 1 },
        { label: "Recall done with student interaction within time", score: 2 },
      ],
    },
    {
      key: "learning_objective",
      label: "Learning Objective Setting - Agenda of the class",
      description: "Teacher sets the learning outcome or index for the present class.",
      maxScore: 1,
      options: [
        { label: "Agenda not given or not clear", score: 0 },
        { label: "Agenda clearly given", score: 1 },
      ],
    },
    {
      key: "curiosity_introduction",
      label: "Curiosity - Introduction",
      description: "Introduction includes practical examples.",
      maxScore: 1,
      options: [
        { label: "No", score: 0 },
        { label: "Yes", score: 1 },
      ],
    },
    {
      key: "concept_teaching_competence",
      label: "Concept - Teaching competence",
      description:
        "Checks concept clarity, understanding checks, physical teaching tools, and teacher preparedness.",
      maxScore: 4,
      options: [
        { label: "None", score: 0 },
        { label: "Any 1", score: 1 },
        { label: "Any 2", score: 2 },
        { label: "Any 3", score: 3 },
        { label: "All 4", score: 4 },
      ],
    },
    {
      key: "concept_notes_taking",
      label: "Concept - Notes Taking",
      description:
        "Teacher provides notes and checks writing; may include handouts or memory aids.",
      maxScore: 3,
      options: [
        { label: "Notes were not given", score: 0 },
        { label: "Notes given but not checked with students", score: 1 },
        { label: "Notes given and checked that all students are writing", score: 2 },
        { label: "Notes checked and aided with maps, tricks, mnemonics, or similar", score: 3 },
      ],
    },
    {
      key: "concept_problem_solving",
      label: "Concept - Problem solving",
      maxScore: 4,
      options: [
        { label: "No problems solved or solved with mistakes", score: 0 },
        { label: "Problem solved without mistakes", score: 1 },
        { label: "Problem solved step by step with student interaction", score: 2 },
        { label: "Students were given opportunity to solve", score: 3 },
        { label: "PYQ were given and solved", score: 4 },
      ],
    },
    {
      key: "concept_doubt_solving",
      label: "Concept - Doubt solving",
      maxScore: 2,
      options: [
        {
          label:
            "No doubt asked, students not encouraged to ask, or doubts solved incorrectly",
          score: 0,
        },
        {
          label:
            "Doubts solved correctly but time management was poor (too long or too fast)",
          score: 1,
        },
        { label: "Doubts solved correctly with good time management", score: 2 },
      ],
    },
    {
      key: "communication_board",
      label: "Communication - Board Presentation",
      description:
        "Checks board usage (with or without PPT), writing clarity, and representation/highlighting.",
      maxScore: 3,
      options: [
        { label: "None", score: 0 },
        { label: "Any 1", score: 1 },
        { label: "Any 2", score: 2 },
        { label: "All 3", score: 3 },
      ],
    },
    {
      key: "communication_interaction",
      label: "Communication - Interaction",
      maxScore: 2,
      options: [
        { label: "One-way teaching or no engagement with students", score: 0 },
        { label: "Student engagement limited to a few students", score: 1 },
        { label: "Effort made to engage all students", score: 2 },
      ],
    },
    {
      key: "communication_body_language",
      label: "Communication - Body Language, Energy, Voice, Eye Contact",
      description:
        "Checks voice clarity/modulation, movement, eye contact, gestures, and adaptive language fluency.",
      maxScore: 6,
      options: [
        { label: "None", score: 0 },
        { label: "Any 1", score: 1 },
        { label: "Any 2", score: 2 },
        { label: "Any 3", score: 3 },
        { label: "Any 4", score: 4 },
        { label: "Any 5", score: 5 },
        { label: "All parameters", score: 6 },
      ],
    },
    {
      key: "class_conclusion",
      label: "Class structure - Conclusion",
      maxScore: 3,
      options: [
        { label: "No summary and no homework given", score: 0 },
        { label: "Either summary or homework given (not both)", score: 1 },
        { label: "Both class summary and homework given", score: 2 },
        { label: "Both given and idea for next class provided", score: 3 },
      ],
    },
    {
      key: "pace_of_teaching",
      label: "Class structure - Pace of teaching",
      maxScore: 2,
      options: [
        { label: "Pace of teaching is not good", score: 0 },
        { label: "Pace is good but not followed throughout class", score: 1 },
        { label: "Pace of teaching matches class level", score: 2 },
      ],
    },
    {
      key: "time_management",
      label: "Class structure - Time management",
      description: "Learning objectives completed in the stipulated time.",
      maxScore: 3,
      options: [
        { label: "Agenda could not be completed", score: 1 },
        { label: "Agenda completed but rushed toward the end", score: 2 },
        { label: "Agenda completed within time", score: 3 },
      ],
    },
    {
      key: "classroom_management",
      label: "Class structure - Classroom management",
      description: "Teacher set class rules and managed the class well.",
      maxScore: 2,
      options: [
        { label: "Teacher unable to manage class; class mostly chaotic", score: 0 },
        { label: "Teacher mostly managed class with some disruption", score: 1 },
        { label: "Teacher managed class well", score: 2 },
      ],
    },
    {
      key: "gender_sensitivity",
      label: "Gender Sensitivity Parameters",
      description:
        "Avoids bias, uses inclusive language, represents diversity, balances participation, and handles gender topics sensitively.",
      maxScore: 3,
      options: [
        { label: "Multiple parameters were violated", score: 0 },
        { label: "One parameter was violated more than once", score: 1 },
        { label: "One parameter was violated once but corrected", score: 2 },
        { label: "Gender inclusive classroom", score: 3 },
      ],
    },
  ],
  sessionFields: [
    {
      key: "observer_summary_strengths",
      label: "Observer Summary (Strengths)",
      placeholder: "Add strengths observed in this session",
    },
    {
      key: "observer_summary_improvements",
      label: "Observer Summary (Points of Improvement)",
      placeholder: "Add improvement points for this session",
    },
  ],
};

const RUBRICS_BY_VERSION: Record<string, RubricConfig> = {
  [CURRENT_RUBRIC_VERSION]: CLASSROOM_OBSERVATION_RUBRIC,
};

export const VALID_GRADES = ["10", "11", "12"] as const;

const ALLOWED_TOP_LEVEL_KEYS = new Set([
  "rubric_version",
  "params",
  "observer_summary_strengths",
  "observer_summary_improvements",
  "teacher_id",
  "teacher_name",
  "grade",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getAllowedScoresLabel(parameter: RubricParameter): string {
  return parameter.options.map((option) => option.score).join(", ");
}

function validateTopLevelShape(data: unknown): {
  errors: string[];
  payload: Record<string, unknown> | null;
} {
  if (!isPlainObject(data)) {
    return { errors: ["Classroom observation data must be an object"], payload: null };
  }

  const errors: string[] = [];
  const payload = data as Record<string, unknown>;

  const unknownTopLevel = Object.keys(payload)
    .filter((key) => !ALLOWED_TOP_LEVEL_KEYS.has(key))
    .sort();

  for (const key of unknownTopLevel) {
    errors.push(`Unknown top-level field: ${key}`);
  }

  if (
    "observer_summary_strengths" in payload &&
    payload.observer_summary_strengths !== undefined &&
    typeof payload.observer_summary_strengths !== "string"
  ) {
    errors.push("observer_summary_strengths must be a string");
  }

  if (
    "observer_summary_improvements" in payload &&
    payload.observer_summary_improvements !== undefined &&
    typeof payload.observer_summary_improvements !== "string"
  ) {
    errors.push("observer_summary_improvements must be a string");
  }

  if ("teacher_id" in payload && payload.teacher_id !== undefined) {
    if (
      typeof payload.teacher_id !== "number" ||
      !Number.isFinite(payload.teacher_id) ||
      payload.teacher_id <= 0 ||
      !Number.isInteger(payload.teacher_id)
    ) {
      errors.push("teacher_id must be a positive integer");
    }
  }

  if ("teacher_name" in payload && payload.teacher_name !== undefined) {
    if (typeof payload.teacher_name !== "string") {
      errors.push("teacher_name must be a string");
    }
  }

  if ("grade" in payload && payload.grade !== undefined) {
    if (
      typeof payload.grade !== "string" ||
      !(VALID_GRADES as readonly string[]).includes(payload.grade)
    ) {
      errors.push("grade must be one of: 10, 11, 12");
    }
  }

  return { errors, payload };
}

function validateParams(
  paramsValue: unknown,
  rubric: RubricConfig,
  strict: boolean
): string[] {
  const errors: string[] = [];

  if (paramsValue === undefined) {
    if (strict) {
      for (const parameter of rubric.parameters) {
        errors.push(`Missing score for ${parameter.label}`);
      }
    }
    return errors;
  }

  if (!isPlainObject(paramsValue)) {
    errors.push("params must be an object");
    return errors;
  }

  const params = paramsValue as Record<string, unknown>;
  const allowedParamKeys = new Set(rubric.parameters.map((parameter) => parameter.key));
  const unknownParamKeys = Object.keys(params)
    .filter((key) => !allowedParamKeys.has(key))
    .sort();

  for (const key of unknownParamKeys) {
    errors.push(`Unknown rubric parameter: ${key}`);
  }

  for (const parameter of rubric.parameters) {
    const value = params[parameter.key];

    if (value === undefined) {
      if (strict) {
        errors.push(`Missing score for ${parameter.label}`);
      }
      continue;
    }

    if (!isPlainObject(value)) {
      errors.push(`${parameter.label} must be an object`);
      continue;
    }

    const valueRecord = value as Record<string, unknown>;
    const unknownParamFields = Object.keys(valueRecord)
      .filter((field) => field !== "score" && field !== "remarks")
      .sort();

    for (const field of unknownParamFields) {
      errors.push(`Unknown field for ${parameter.key}: ${field}`);
    }

    if (
      "remarks" in valueRecord &&
      valueRecord.remarks !== undefined &&
      typeof valueRecord.remarks !== "string"
    ) {
      errors.push(`remarks for ${parameter.label} must be a string`);
    }

    if (!("score" in valueRecord)) {
      if (strict) {
        errors.push(`Missing score for ${parameter.label}`);
      }
      continue;
    }

    if (typeof valueRecord.score !== "number" || Number.isNaN(valueRecord.score)) {
      errors.push(`score for ${parameter.label} must be a number`);
      continue;
    }

    const isValidScore = parameter.options.some((option) => option.score === valueRecord.score);
    if (!isValidScore) {
      errors.push(
        `Invalid score for ${parameter.label}. Allowed scores: ${getAllowedScoresLabel(parameter)}`
      );
    }
  }

  return errors;
}

export function getRubricConfig(version: string): RubricConfig | null {
  return RUBRICS_BY_VERSION[version] ?? null;
}

export function computeTotalScore(
  params: Record<string, ParamData | undefined> | undefined
): number {
  if (!params) {
    return 0;
  }

  let total = 0;

  for (const parameter of CLASSROOM_OBSERVATION_RUBRIC.parameters) {
    const score = params[parameter.key]?.score;
    if (typeof score !== "number" || Number.isNaN(score)) {
      continue;
    }

    const isValidScore = parameter.options.some((option) => option.score === score);
    if (isValidScore) {
      total += score;
    }
  }

  return total;
}

export function validateClassroomObservationSave(data: unknown): ValidationResult {
  const { errors, payload } = validateTopLevelShape(data);
  if (!payload) {
    return { valid: false, errors };
  }

  const rubricVersion = payload.rubric_version;
  let rubric = CLASSROOM_OBSERVATION_RUBRIC;

  if (rubricVersion !== undefined) {
    if (typeof rubricVersion !== "string") {
      errors.push("rubric_version must be a string");
    } else {
      const resolvedRubric = getRubricConfig(rubricVersion);
      if (!resolvedRubric) {
        errors.push(`Unsupported classroom observation rubric_version: ${rubricVersion}`);
      } else {
        rubric = resolvedRubric;
      }
    }
  }

  if (typeof rubricVersion === "string" && !getRubricConfig(rubricVersion)) {
    return { valid: false, errors };
  }

  errors.push(...validateParams(payload.params, rubric, false));

  return { valid: errors.length === 0, errors };
}

export function validateClassroomObservationComplete(data: unknown): ValidationResult {
  const { errors, payload } = validateTopLevelShape(data);
  if (!payload) {
    return { valid: false, errors };
  }

  const rubricVersion = payload.rubric_version;
  if (rubricVersion === undefined) {
    errors.push("rubric_version is required");
    return { valid: false, errors };
  }

  if (typeof rubricVersion !== "string") {
    errors.push("rubric_version must be a string");
    return { valid: false, errors };
  }

  const rubric = getRubricConfig(rubricVersion);
  if (!rubric) {
    errors.push(`Unsupported classroom observation rubric_version: ${rubricVersion}`);
    return { valid: false, errors };
  }

  if (payload.teacher_id === undefined) {
    errors.push("teacher_id is required");
  }

  if (payload.teacher_name === undefined || payload.teacher_name === "") {
    errors.push("teacher_name is required");
  }

  if (payload.grade === undefined) {
    errors.push("grade is required");
  }

  errors.push(...validateParams(payload.params, rubric, true));

  return { valid: errors.length === 0, errors };
}
