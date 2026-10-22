import type { FlagRecipient } from "@/lib/blended-learning-mentee-detail";

// Flag Recipient labels, in display order, for the history chips; the log
// form's switches use FLAG_SWITCH.
export const FLAG_RECIPIENT: Record<FlagRecipient, string> = {
  emotional_wellbeing: "Emotional Well-being",
  physics: "Physics Teacher",
  chemistry: "Chemistry Teacher",
  maths: "Maths Teacher",
};

// The well-being lead, named on the log form as in the PRD.
const WELLBEING_LEAD = "Shalini";

// The log form's Mentor Flag switches and comments, worded as in the mockup.
export const FLAG_SWITCH: Record<
  FlagRecipient,
  { label: string; hint?: string; commentFor: string; placeholder: string; help: string }
> = {
  emotional_wellbeing: {
    label: `Flag to ${WELLBEING_LEAD}`,
    hint: "(for emotional well-being)",
    commentFor: WELLBEING_LEAD,
    placeholder: "What should she look at?",
    help: `Use this when something about the student's emotional well-being needs her attention. ${WELLBEING_LEAD} is emailed when you save.`,
  },
  physics: {
    label: "Flag to Physics teacher",
    commentFor: "the Physics teacher",
    placeholder: "What should the teacher look at?",
    help: "Use this when the student needs the Physics teacher's attention.",
  },
  chemistry: {
    label: "Flag to Chemistry teacher",
    commentFor: "the Chemistry teacher",
    placeholder: "What should the teacher look at?",
    help: "Use this when the student needs the Chemistry teacher's attention.",
  },
  maths: {
    label: "Flag to Maths teacher",
    commentFor: "the Maths teacher",
    placeholder: "What should the teacher look at?",
    help: "Use this when the student needs the Maths teacher's attention.",
  },
};
