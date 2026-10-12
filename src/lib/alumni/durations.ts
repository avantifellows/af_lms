// How long each degree normally takes, in years from start year to graduation
// year (both as calendar years, e.g. 2021 → 2025 = 4).
//
// - typical: no question asked.
// - min..max: possible but unusual → the person is asked to confirm.
// - outside min..max: impossible → the save is blocked.
//
// Based on the standard Indian course lengths (AICTE / UGC / NMC / DCI / PCI /
// COA / BCI norms). The upper limits allow for regulators' maximum time to
// finish (usually twice the course length), so a slow but real graduation can
// still be saved after confirming. Integrated / internship-inclusive courses
// (MBBS 5.5 years, etc.) show as one of two calendar-year spans.

export interface DurationRule {
  typical: number[];
  min: number;
  max: number;
  /** Why an unusual length can still be right — shown in the confirmation. */
  note?: string;
}

const rule = (typical: number[], min: number, max: number, note?: string): DurationRule => ({ typical, min, max, note });

export const UG_DURATIONS: Record<string, DurationRule> = {
  "BTech/BE": rule([4], 3, 8, "3 years is normal for lateral entry after a diploma; longer usually means backlogs or a break."),
  "BTech/MTech": rule([5], 4, 10, "Dual degree is 5 years."),
  BSc: rule([3, 4], 3, 6, "3 years, or 4 for a 4-year honours / research degree."),
  "BSc/MSc": rule([5], 4, 10, "Integrated BSc-MSc is 5 years."),
  BS: rule([4], 3, 8, "BS (e.g. IISER / IISc) is 4 years."),
  "BS/MS": rule([5], 4, 10, "Integrated BS-MS is 5 years."),
  BStat: rule([3], 3, 6),
  MBBS: rule([5, 6], 5, 10, "4.5 years + 1-year internship."),
  BDS: rule([5], 4, 10, "4 years + 1-year internship."),
  BAMS: rule([5, 6], 5, 10, "4.5 years + 1-year internship."),
  BHMS: rule([5, 6], 5, 10, "4.5 years + 1-year internship."),
  BNYS: rule([5, 6], 5, 10, "4.5 years + 1-year internship."),
  BPT: rule([4, 5], 4, 9, "4 years + 6-month internship."),
  BPharm: rule([4], 3, 8, "3 years is normal for lateral entry after DPharm."),
  "Pharm D": rule([6], 5, 12, "5 years + 1-year internship."),
  DPharm: rule([2], 2, 4),
  BVSc: rule([5, 6], 5, 10, "4.5 years + 1-year internship."),
  BHM: rule([3, 4], 3, 8),
  BArch: rule([5], 5, 10),
  BDes: rule([4], 3, 8),
  BCA: rule([3, 4], 3, 6, "3 years, or 4 under the new 4-year (NEP) programme."),
  BBA: rule([3, 4], 3, 6, "3 years, or 4 under the new 4-year (NEP) programme."),
  BCom: rule([3, 4], 3, 6, "3 years, or 4 under the new 4-year (NEP) programme."),
  BA: rule([3, 4], 3, 6, "3 years, or 4 under the new 4-year (NEP) programme."),
  "BA LLB": rule([5], 5, 10, "Integrated law degree is 5 years."),
  "BA/BEd": rule([4], 4, 8, "Integrated teacher education is 4 years."),
  "BSc/BEd": rule([4], 4, 8, "Integrated teacher education is 4 years."),
  "Diploma - Engg": rule([3], 2, 6, "2 years is normal for lateral entry."),
  "Diploma - Medical": rule([2, 3], 1, 5),
};

export const PG_DURATIONS: Record<string, DurationRule> = {
  MTech: rule([2], 1, 4),
  MS: rule([2, 3], 1, 5, "MS by research can take 2–3 years."),
  MSc: rule([2], 1, 4),
  MCA: rule([2, 3], 2, 6, "MCA was 3 years before 2020, 2 years since."),
  MBA: rule([2], 1, 4, "1 year for an executive / one-year MBA."),
  MA: rule([2], 1, 4),
  MCom: rule([2], 1, 4),
  BEd: rule([2], 1, 4, "1 year under the older BEd rules."),
  MD: rule([3], 3, 6),
  "MS (Surgery)": rule([3], 3, 6),
  MDS: rule([3], 3, 6),
  MPharm: rule([2], 2, 4),
  MDes: rule([2], 1, 4),
  LLB: rule([3], 3, 6, "3-year LLB after a first degree."),
  MLLM: rule([1, 2], 1, 4, "LLM is 1 year (new) or 2 years (old)."),
  MPhil: rule([1, 2], 1, 3),
  PhD: rule([3, 4, 5], 2, 8, "PhDs usually take 3–5 years."),
};

export function durationRule(level: "ug" | "pg", degree: string): DurationRule | undefined {
  return (level === "ug" ? UG_DURATIONS : PG_DURATIONS)[degree];
}

/** "4 years" / "3 or 4 years" / "3–5 years". */
export function describeTypical(r: DurationRule): string {
  const t = r.typical;
  if (t.length === 1) return `${t[0]} year${t[0] === 1 ? "" : "s"}`;
  const consecutive = t.every((v, i) => i === 0 || v === t[i - 1] + 1);
  return consecutive && t.length > 2 ? `${t[0]}–${t[t.length - 1]} years` : `${t.slice(0, -1).join(", ")} or ${t[t.length - 1]} years`;
}
