/**
 * Teacher Feedback — student-facing feedback form (V2).
 *
 * This is the canonical, code-owned definition of the "Proposed Student Feedback
 * Form - Final_V2" used for per-teacher student feedback. It is the single source
 * of truth for three things:
 *   1. building the quiz-backend `/quiz` POST body (one quiz per teacher), and
 *   2. scoring the responses the quiz ETL writes to BigQuery
 *      (`avantifellows.assessments.all_responses_form_level`), where each row's
 *      `user_response` is the selected option INDEX as a string.
 *
 * Ported from scripts/create_teacher_feedback_pilot.py (build_quiz/make_question)
 * and scripts/generate_teacher_feedback_report.py (scoring), kept in lockstep with
 * "Proposed Student Feedback Form - Final_V2.csv".
 *
 * Scoring contract (single-choice): option 0 → 2, option 1 → 1, option 2 → 0.
 * Each scored question is worth max 2. Open-ended questions are not scored.
 */

export const FEEDBACK_FORM_VERSION = "v2";

/** Per-option score for single-choice questions, by option index. */
export const OPTION_SCORES = [2, 1, 0] as const;
export const MAX_QUESTION_SCORE = 2;

/** A single selectable option on a scored question. */
export interface FeedbackOption {
  text: string;
  score: number;
}

/** A scored, single-choice feedback question. */
export interface FeedbackScoredQuestion {
  kind: "scored";
  /** Parameter category, e.g. "Planning" (the CSV "Internal Tagging"). */
  parameter: string;
  /** Short tag, e.g. "Class Punctuality" (the CSV "Question Tag"). */
  questionTag: string;
  text: string;
  options: FeedbackOption[];
}

/** An open-ended (subjective) feedback question. */
export interface FeedbackOpenQuestion {
  kind: "open";
  /** Stable role for the report: what the student liked / what to improve. */
  role: "liked" | "improve";
  text: string;
}

export type FeedbackQuestion = FeedbackScoredQuestion | FeedbackOpenQuestion;

function scored(
  parameter: string,
  questionTag: string,
  text: string,
  optionTexts: [string, string, string]
): FeedbackScoredQuestion {
  return {
    kind: "scored",
    parameter,
    questionTag,
    text,
    options: optionTexts.map((t, i) => ({ text: t, score: OPTION_SCORES[i] })),
  };
}

function open(role: "liked" | "improve", text: string): FeedbackOpenQuestion {
  return { kind: "open", role, text };
}

/**
 * The form, in exact CSV/quiz order. The index of each entry is the
 * `question_position_index` the ETL stamps onto BigQuery rows — keep this order
 * stable, since the report joins answers to questions by position.
 */
export const FEEDBACK_QUESTIONS: readonly FeedbackQuestion[] = [
  // 0
  scored("Planning", "Class Punctuality", "Does the teacher start and end the class on time?", [
    "The teacher always starts and ends the class on time.",
    "The teacher is sometimes late or ends class early.",
    "The teacher is often late or ends class noticeably early.",
  ]),
  // 1
  scored(
    "Planning",
    "Class Preparation",
    "Does it feel like the teacher has planned the class before coming in?",
    [
      "The teacher comes in with clear topics, notes, examples, and practice problems ready.",
      "The teacher is sometimes well-prepared and able to manage the class effectively, but not consistently.",
      "The class feels unstructured; the teacher seems unprepared.",
    ]
  ),
  // 2
  scored(
    "Concept",
    "Subject Mastery and Problem Solving",
    "How well does the teacher explain concepts, solve problems or PYQ?",
    [
      "The teacher explains concepts clearly, solves problems or PYQ step by step.",
      "The teacher explains some concepts clearly and solves problems sometimes.",
      "The teacher gives unclear explanations, rarely focuses on problem solving.",
    ]
  ),
  // 3
  scored(
    "Concept",
    "Doubt Resolution",
    "When students raise doubts, how does the teacher handle them?",
    [
      "The teacher addresses most doubts, explains concepts until students understand, and follows up later during or after class if needed.",
      "The teacher answers doubts, but sometimes the explanations are brief or lack patience",
      "The teacher discourages doubts, dismisses questions, or makes students feel uncomfortable.",
    ]
  ),
  // 4
  scored(
    "Concept",
    "Clarity and Concept Building",
    "How clearly does the teacher explain concepts and build from basics to advanced topics?",
    [
      "The teacher explains concepts clearly, checks our basic understanding, and builds step by step.",
      "The teacher explains some concepts clearly but sometimes moves ahead assuming we already know the basics.",
      "The teacher moves too quickly to advanced topics, making concepts hard to understand.",
    ]
  ),
  // 5
  scored(
    "Curiosity",
    "Real life Examples and Analogies",
    "Does the teacher use real-world examples, analogies, or diagrams to make concepts stick?",
    [
      "The teacher regularly uses real life examples and visuals that make concepts memorable.",
      "The teacher sometimes uses real life examples .",
      "The teacher rarely uses real-life examples and mostly teaches concepts strictly as per the module.",
    ]
  ),
  // 6
  scored(
    "Class Structure",
    "Pace and Coverage",
    "Is the teaching pace appropriate to actually learn, while still covering the syllabus?",
    [
      "The pace is right - fast enough to cover syllabus, slow enough to understand.",
      "The pace is sometimes too fast or too slow.",
      "The pace makes it hard to follow - too rushed, or too slow and disengaging.",
    ]
  ),
  // 7
  scored(
    "Communication",
    "Audibility",
    "Is the teacher’s voice clear, understandable, and easy to hear throughout the class?",
    [
      "The teacher’s voice is always clearly audible and easy to understand throughout the class.",
      "The teacher’s voice is sometimes difficult to hear and understand.",
      "It is often difficult to hear and understand what the teacher is saying.",
    ]
  ),
  // 8
  scored(
    "Communication",
    "Board and Visual Clarity",
    "Is the teacher's board work (or screen / handwriting) clear and well-organized?",
    [
      "The board work is clear, legible, and organized so notes are useful later.",
      "The board work is sometimes messy or hard to read.",
      "The board work is often hard to read or follow.",
    ]
  ),
  // 9
  scored(
    "Communication",
    "Participation and Understanding Check",
    "Does the teacher encourage participation and check whether students have understood the class?",
    [
      "The teacher regularly asks questions, encourages participation, and checks our understanding before moving ahead.",
      "The teacher sometimes encourages participation and checks understanding.",
      "The class is mostly one-way, and the teacher rarely checks whether students have understood.",
    ]
  ),
  // 10
  scored(
    "Inclusive and Equitable Classroom",
    "Mentorship and Motivation",
    "Does the teacher help you stay motivated and give useful exam/career guidance?",
    [
      "The teacher gives useful exam strategy and encouragement that pushes me to work harder.",
      "The teacher sometimes shares exam guidance and motivation.",
      "The teacher rarely motivates students, and they have limited clarity about their goals.",
    ]
  ),
  // 11
  scored(
    "Inclusive and Equitable Classroom",
    "Fair Attention",
    "Does the teacher treat all students fairly - regardless of gender, background, or how strong they currently are in the subject?",
    [
      "The teacher treats everyone equally and pays attention to weaker students too.",
      "The teacher slightly favors some students (top performers, one gender, certain groups).",
      "The teacher clearly favors certain students or ignores others.",
    ]
  ),
  // 12
  scored(
    "Inclusive and Equitable Classroom",
    "Respect and Safety",
    "Does the teacher treat students with respect?",
    [
      "The teacher is always respectful, even when students make mistakes.",
      "The teacher is generally respectful but occasionally makes critical remarks.",
      "The teacher demeans students and consistently uses fear-based methods to control the class.",
    ]
  ),
  // 13
  scored(
    "Learning Outcome",
    "Self-Perceived Learning",
    "How much do you feel you are actually learning from this teacher for JEE/NEET?",
    [
      "I am learning a lot and feel more confident about this subject.",
      "I am learning some, but less than I had hoped.",
      "I do not feel I am learning enough; a different approach would help more.",
    ]
  ),
  // 14
  open("liked", "What did you like most about the class or teacher?"),
  // 15
  open("improve", "What can be improved about the class or teacher?"),
] as const;

/** Scored questions only, in form order. */
export const SCORED_QUESTIONS: FeedbackScoredQuestion[] = FEEDBACK_QUESTIONS.filter(
  (q): q is FeedbackScoredQuestion => q.kind === "scored"
);

/** Open-ended questions only, in form order. */
export const OPEN_QUESTIONS: FeedbackOpenQuestion[] = FEEDBACK_QUESTIONS.filter(
  (q): q is FeedbackOpenQuestion => q.kind === "open"
);

/** Maximum total score across all scored questions (14 × 2 = 28). */
export const MAX_TOTAL_SCORE = SCORED_QUESTIONS.length * MAX_QUESTION_SCORE;

/** Parameter categories, in first-appearance order. */
export const PARAMETERS: string[] = (() => {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const q of SCORED_QUESTIONS) {
    if (!seen.has(q.parameter)) {
      seen.add(q.parameter);
      order.push(q.parameter);
    }
  }
  return order;
})();

/** Max possible score for a given parameter (count of its questions × 2). */
export function maxScoreForParameter(parameter: string): number {
  return (
    SCORED_QUESTIONS.filter((q) => q.parameter === parameter).length *
    MAX_QUESTION_SCORE
  );
}

/**
 * Map a BigQuery `user_response` value to a score for the scored question at
 * `positionIndex`. `user_response` is the selected option index as a string
 * (e.g. "0"). Returns null when unanswered/invalid or when the position isn't a
 * scored question. Mirrors the prototype's score_answer().
 */
export function scoreUserResponse(
  positionIndex: number,
  userResponse: string | null | undefined
): number | null {
  const question = FEEDBACK_QUESTIONS[positionIndex];
  if (!question || question.kind !== "scored") {
    return null;
  }
  if (userResponse === null || userResponse === undefined || userResponse === "") {
    return null;
  }
  const idx = Number(userResponse);
  if (!Number.isInteger(idx) || idx < 0 || idx >= question.options.length) {
    return null;
  }
  return question.options[idx].score;
}

// --- quiz-backend /quiz body builder -----------------------------------------

export interface BuildFeedbackQuizParams {
  /** Human-readable quiz title, e.g. "Student Feedback - Jun 2026 - JNV Palghar - Manjit Kumar". */
  title: string;
  /** Grade as a string, e.g. "11" (matches the prototype's metadata.grade). */
  grade: string;
  /**
   * Stable identifier stamped as quiz `metadata.source_id`; the ETL writes this
   * to every BigQuery row as `cms_test_id`. Use e.g.
   * `teacher-feedback:v2:{schoolCode}:{YYYY-MM}`.
   */
  sourceId: string;
  /** Portal URL of the next teacher's session for chaining; "" for the last. */
  nextStepUrl?: string;
  /** CTA text for the chain link. */
  nextStepText?: string;
}

/** A single question in the quiz-backend payload. */
type QuizQuestionPayload = Record<string, unknown>;

function buildQuestionPayload(
  question: FeedbackQuestion,
  index: number,
  grade: string
): QuizQuestionPayload {
  const isOpen = question.kind === "open";
  const internalTag = isOpen ? "Open-Ended" : question.parameter.trim();
  const questionTag = isOpen ? "" : question.questionTag;

  const base: QuizQuestionPayload = {
    text: question.text,
    graded: false,
    force_correct: false,
    marking_scheme: { correct: 0, wrong: 0, skipped: 0 },
    solution: [],
    metadata: {
      grade,
      subject: "Student Teacher Feedback",
      chapter: internalTag,
      chapter_id: "",
      topic: questionTag,
      topic_id: "",
      difficulty: "",
      skill: "",
      skill_id: "",
      concept: "",
      concept_id: "",
      priority: isOpen ? "high" : "low",
    },
    source: "teacher-feedback",
    source_id: `teacher-feedback-form:${FEEDBACK_FORM_VERSION}:${index + 1}`,
  };

  if (isOpen) {
    return { ...base, type: "subjective", options: [], max_char_limit: 700 };
  }

  return {
    ...base,
    type: "single-choice",
    options: question.options.map((o) => ({
      text: o.text,
      metadata: { score: o.score },
    })),
    correct_answer: [],
  };
}

/**
 * Build the quiz-backend `/quiz` POST body for one teacher's feedback form.
 * Ported from create_teacher_feedback_pilot.py build_quiz(). The questions are
 * identical across teachers; only the title and chaining differ.
 */
export function buildFeedbackQuizBody(
  params: BuildFeedbackQuizParams
): Record<string, unknown> {
  const { title, grade, sourceId, nextStepUrl = "", nextStepText = "" } = params;

  const questions = FEEDBACK_QUESTIONS.map((q, i) =>
    buildQuestionPayload(q, i, grade)
  );

  const questionSet = {
    title: "Questions",
    description: "",
    questions,
    max_questions_allowed_to_attempt: questions.length,
    marking_scheme: { correct: 0, wrong: 0, skipped: 0 },
  };

  return {
    title,
    question_sets: [questionSet],
    max_marks: 0,
    num_graded_questions: 0,
    shuffle: false,
    num_attempts_allowed: 1,
    time_limit: null,
    review_immediate: true,
    display_solution: false,
    show_scores: false,
    navigation_mode: "non-linear",
    instructions: "",
    language: "en",
    metadata: {
      quiz_type: "form",
      test_format: "questionnaire",
      grade,
      subject: "Teacher Feedback",
      source: "teacher-feedback",
      source_id: sourceId,
      next_step_url: nextStepUrl,
      next_step_text: nextStepText,
      next_step_autostart: false,
      single_page_header_text: "Please fill the answers carefully.",
    },
  };
}
