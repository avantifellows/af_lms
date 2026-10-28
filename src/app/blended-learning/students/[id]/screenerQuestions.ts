import type { ScreenerFeedback } from "@/lib/blended-learning-mentee-detail";

// The two Screener Feedback questions, worded as Poojita confirmed, for the
// log form's rating scales and the history's read-only answers. Each is
// rated 1 (not at all) to 5 (a lot).
export const SCREENER_QUESTIONS: { key: keyof ScreenerFeedback; question: string }[] = [
  { key: "helpedUnderstand", question: "Did the screener help you understand this student better?" },
  { key: "moreComfortable", question: "Did the student seem more comfortable talking to you than before?" },
];

export const SCREENER_SCALE = [1, 2, 3, 4, 5] as const;

// The words at the scale's ends; 2 to 4 are numbers only.
export const SCREENER_END_LABEL: Partial<Record<number, string>> = { 1: "Not at all", 5: "A lot" };
