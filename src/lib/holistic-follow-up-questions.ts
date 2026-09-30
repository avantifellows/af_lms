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
