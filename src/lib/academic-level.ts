// Academic Level (AL) display vocabulary.
//
// Shared between the cumulative AL matrix (one column per major test) and the
// per-test AL column in Student Results, so the two can't disagree about
// ordering, ranking, short labels, or chip colours.
//
// M and B tiers are parallel stream-specific scales — M for engineering (JEE),
// B for medical (NEET) — not two rungs of one ladder.
//
// Two spellings of "not qualified" coexist: per-test rows in the fact table
// say "Not Qualified", while the per-student dim_student.academic_level (dbt's
// int_student_academic_level) writes it stream-specifically as M3 / B3. Same
// tier, same colour.

// Best (top tier) first. Used for legends and distribution charts.
export const AL_DISPLAY_ORDER = [
  "M1",
  "B1",
  "M2",
  "B2",
  "M3",
  "B3",
  "Not Qualified",
  "Not Eligible for Academic Level",
];

// Unified rank for sorting. M1/B1 tie at the top because they are the top of
// their respective scales.
export const AL_RANK: Record<string, number> = {
  M1: 3,
  B1: 3,
  M2: 2,
  B2: 2,
  M3: 1,
  B3: 1,
  "Not Qualified": 1,
  "Not Eligible for Academic Level": 0,
};

const AL_SHORT_LABEL: Record<string, string> = {
  "Not Qualified": "NQ",
  "Not Eligible for Academic Level": "NE",
};

// The two long AL values are unreadable in a table cell; M1/M2/B1/B2 pass
// through unchanged.
export function alShortLabel(al: string): string {
  return AL_SHORT_LABEL[al] || al;
}

export function alChipColor(al: string): string {
  switch (al) {
    case "M1":
    case "B1":
      return "bg-success-bg text-success border-success/30";
    case "M2":
    case "B2":
      return "bg-success-bg/50 text-success/80 border-success/20";
    case "M3":
    case "B3":
    case "Not Qualified":
      return "bg-warning-bg text-warning border-warning/30";
    case "Not Eligible for Academic Level":
      return "bg-bg-card-alt text-text-muted border-border";
    default:
      return "bg-bg-card-alt text-text-muted border-border";
  }
}
