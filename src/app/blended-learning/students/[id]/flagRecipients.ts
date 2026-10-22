import type { FlagRecipient } from "@/lib/blended-learning-mentee-detail";

// Flag Recipient labels, in display order. Shared by the history chips and
// the log form's Mentor Flag switches.
export const FLAG_RECIPIENT: Record<FlagRecipient, string> = {
  emotional_wellbeing: "Emotional Well-being",
  physics: "Physics Teacher",
  chemistry: "Chemistry Teacher",
  maths: "Maths Teacher",
};
