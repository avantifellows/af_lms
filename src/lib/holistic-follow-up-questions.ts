// Client-safe: the fixed Follow-up Note questions shared by every Program,
// Grade, and Phase. Each key maps one-to-one to a `<key>_answer` column of
// holistic_mentorship_follow_up_notes. Keys are stable; text may change.
export const HOLISTIC_FOLLOW_UP_QUESTIONS = [
  { key: "challenges", text: "What challenges did the student talk about?" },
  { key: "solutions", text: "What solutions did you suggest?" },
  { key: "action_plan", text: "Was the student able to follow the action plan shared previously?" },
] as const;

export type HolisticFollowUpQuestionKey = (typeof HOLISTIC_FOLLOW_UP_QUESTIONS)[number]["key"];

export type HolisticFollowUpNote = {
  id: number;
  submittedAt: string;
  authorName: string;
  answers: Array<{ key: HolisticFollowUpQuestionKey; answer: string }>;
};

export type HolisticFollowUpAnswers = Record<HolisticFollowUpQuestionKey, string | null>;

const HOLISTIC_FOLLOW_UP_ANSWER_MAX_LENGTH = 10_000;

export type HolisticFollowUpAnswersResult =
  | { ok: true; answers: HolisticFollowUpAnswers }
  | { ok: false; error: string };

const FOLLOW_UP_KEYS: ReadonlySet<string> = new Set(HOLISTIC_FOLLOW_UP_QUESTIONS.map(({ key }) => key));

// Trims each answer, stores blanks as null, and rejects a note with no answer.
export function normalizeHolisticFollowUpAnswers(
  raw: Record<string, unknown>
): HolisticFollowUpAnswersResult {
  if (Object.keys(raw).some((key) => !FOLLOW_UP_KEYS.has(key))) {
    return { ok: false, error: "Unknown Follow-up question" };
  }
  const values = Object.values(raw);
  if (values.some((value) => value !== undefined && typeof value !== "string")) {
    return { ok: false, error: "Follow-up answers must be text" };
  }
  if ((values as Array<string | undefined>).some((value) => (value?.length ?? 0) > HOLISTIC_FOLLOW_UP_ANSWER_MAX_LENGTH)) {
    return { ok: false, error: "Follow-up answers must be 10,000 characters or fewer" };
  }
  const answers = Object.fromEntries(HOLISTIC_FOLLOW_UP_QUESTIONS.map(({ key }) => {
    const answer = typeof raw[key] === "string" ? raw[key].trim() : "";
    return [key, answer || null];
  })) as HolisticFollowUpAnswers;
  return Object.values(answers).some((answer) => answer !== null)
    ? { ok: true, answers }
    : { ok: false, error: "Answer at least one question" };
}
