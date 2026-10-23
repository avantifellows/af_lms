// Client-safe: the fixed Challenge Categories a Holistic Mentor selects in
// Post-Session Notes, shared by every Program, Grade, and Phase. Codes are
// stable and stored; labels may change (ADR-0004). No DB CHECK, no admin edit.
export const HOLISTIC_CHALLENGE_CATEGORIES = [
  { code: "academic.subject_concept", group: "academic", label: "Subject/concept issues", shortLabel: "Subject" },
  { code: "academic.backlogs_workload", group: "academic", label: "Backlogs, revision & workload", shortLabel: "Backlogs" },
  { code: "academic.exam_related", group: "academic", label: "Exam/Test related issues", shortLabel: "Exams" },
  { code: "academic.test_preparation", group: "academic", label: "Test performance & preparation", shortLabel: "Test prep" },
  { code: "academic.other", group: "academic", label: "Other", shortLabel: "Other" },
  { code: "academic.no_major_issue", group: "academic", label: "No major issue reported", shortLabel: "No issue" },
  { code: "non_academic.time_management", group: "non_academic", label: "Time management & distractions", shortLabel: "Time" },
  { code: "non_academic.confidence_motivation", group: "non_academic", label: "Low confidence/motivation", shortLabel: "Confidence" },
  { code: "non_academic.adjustment", group: "non_academic", label: "Adjustment difficulties", shortLabel: "Adjustment" },
  { code: "non_academic.wellness", group: "non_academic", label: "Wellness (health, sleep etc.)", shortLabel: "Wellness" },
  { code: "non_academic.emotional_social", group: "non_academic", label: "Emotional & social stress", shortLabel: "Emotional" },
  { code: "non_academic.career_uncertainty", group: "non_academic", label: "Career uncertainty", shortLabel: "Career" },
  { code: "non_academic.financial", group: "non_academic", label: "Financial challenges", shortLabel: "Financial" },
  { code: "non_academic.communication_language", group: "non_academic", label: "Communication & language", shortLabel: "Language" },
  { code: "non_academic.other", group: "non_academic", label: "Other", shortLabel: "Other" },
  { code: "non_academic.no_major_issue", group: "non_academic", label: "No major issue reported", shortLabel: "No issue" },
] as const;

export type HolisticChallengeCategory = (typeof HOLISTIC_CHALLENGE_CATEGORIES)[number];
export type HolisticChallengeCategoryCode = HolisticChallengeCategory["code"];
export type HolisticChallengeCategoryGroup = HolisticChallengeCategory["group"];

// The two groups in display order, with the one copy of their labels.
export const HOLISTIC_CHALLENGE_CATEGORY_GROUPS = [
  { group: "academic", label: "Academic" },
  { group: "non_academic", label: "Non-academic" },
] as const satisfies ReadonlyArray<{ group: HolisticChallengeCategoryGroup; label: string }>;

export type HolisticChallengeCategoriesResult =
  | { ok: true; codes: HolisticChallengeCategoryCode[] }
  | { ok: false; error: string; emptyGroups?: HolisticChallengeCategoryGroup[] };

function isNoMajorIssue(code: string): boolean {
  return code.endsWith(".no_major_issue");
}

const CATEGORY_BY_CODE: ReadonlyMap<string, HolisticChallengeCategory> = new Map(
  HOLISTIC_CHALLENGE_CATEGORIES.map((category) => [category.code, category])
);

export function isHolisticChallengeCategoryCode(code: string): code is HolisticChallengeCategoryCode {
  return CATEGORY_BY_CODE.has(code);
}

// Catalogue order, regardless of the order codes were selected or stored in;
// a code the catalogue does not know is dropped.
export function knownHolisticChallengeCategories(codes: Iterable<string>): HolisticChallengeCategoryCode[] {
  const selected = new Set(codes);
  return HOLISTIC_CHALLENGE_CATEGORIES.filter(({ code }) => selected.has(code)).map(({ code }) => code);
}

// The Submit / Edit notes message naming the groups that are still empty.
export function holisticChallengeCategoryGroupsMessage(emptyGroups: readonly HolisticChallengeCategoryGroup[]): string {
  const labels = HOLISTIC_CHALLENGE_CATEGORY_GROUPS
    .filter(({ group }) => emptyGroups.includes(group)).map(({ label }) => label);
  return labels.length ? `Choose at least one ${labels.join(" and one ")} Challenge Category` : "";
}

const ALL_GROUPS_MESSAGE = holisticChallengeCategoryGroupsMessage(
  HOLISTIC_CHALLENGE_CATEGORY_GROUPS.map(({ group }) => group)
);

// The single source of the Challenge Category write rules. Drafts may hold any
// valid partial set; `final` (Submit / Edit notes) also needs both groups. The
// error always names both groups; `emptyGroups` says which are missing.
export function validateHolisticChallengeCategories(
  raw: unknown[],
  { final }: { final: boolean }
): HolisticChallengeCategoriesResult {
  const codes = raw.map((code) => (typeof code === "string" ? code.trim() : null));
  // Duplicates share the unknown-code message; the UI toggle never sends them.
  if (codes.some((code) => code === null || !isHolisticChallengeCategoryCode(code))
    || new Set(codes).size !== codes.length) {
    return { ok: false, error: "Unknown Challenge Category" };
  }
  const categories = codes.map((code) => CATEGORY_BY_CODE.get(code as string)!);
  const inGroup = (group: HolisticChallengeCategoryGroup) => categories.filter((category) => category.group === group);
  const mixesNoMajorIssue = HOLISTIC_CHALLENGE_CATEGORY_GROUPS.some(({ group }) => {
    const selected = inGroup(group);
    return selected.length > 1 && selected.some(({ code }) => isNoMajorIssue(code));
  });
  if (mixesNoMajorIssue) {
    return { ok: false, error: "Choose either No major issue reported or other Challenge Categories" };
  }
  const emptyGroups = final
    ? HOLISTIC_CHALLENGE_CATEGORY_GROUPS.map(({ group }) => group).filter((group) => inGroup(group).length === 0)
    : [];
  if (emptyGroups.length) return { ok: false, error: ALL_GROUPS_MESSAGE, emptyGroups };
  return { ok: true, codes: codes as HolisticChallengeCategoryCode[] };
}

// Catalogue order, regardless of the order codes were selected or stored in.
export function groupHolisticChallengeCategories(
  codes: Iterable<HolisticChallengeCategoryCode>
): Record<HolisticChallengeCategoryGroup, HolisticChallengeCategory[]> {
  const selected = new Set<string>(codes);
  const categories = HOLISTIC_CHALLENGE_CATEGORIES.filter(({ code }) => selected.has(code));
  return {
    academic: categories.filter(({ group }) => group === "academic"),
    non_academic: categories.filter(({ group }) => group === "non_academic"),
  };
}

// UI selection: No major issue reported is exclusive within its group.
export function toggleHolisticChallengeCategory(
  codes: readonly HolisticChallengeCategoryCode[],
  code: HolisticChallengeCategoryCode
): HolisticChallengeCategoryCode[] {
  if (codes.includes(code)) return codes.filter((selected) => selected !== code);
  const { group } = CATEGORY_BY_CODE.get(code)!;
  const kept = codes.filter((selected) => {
    if (CATEGORY_BY_CODE.get(selected)!.group !== group) return true;
    return isNoMajorIssue(code) ? false : !isNoMajorIssue(selected);
  });
  return knownHolisticChallengeCategories([...kept, code]);
}

// The Question each group is shown above, from Questions in position order:
// the first case-insensitive Question-text match; a group with no matching
// Question has no placement (null). Only the hyphenated "non-academic" counts as
// Non-academic, and a Question mentioning both phrases is Non-academic only.
export function placeHolisticChallengeCategories(
  questions: ReadonlyArray<{ questionId: number; text: string }>
): Record<HolisticChallengeCategoryGroup, number | null> {
  const lowered = questions.map((question) => ({ ...question, text: question.text.toLowerCase() }));
  const nonAcademic = lowered.find(({ text }) => text.includes("non-academic challenge"));
  const academic = lowered.find(({ text }) => text.includes("academic challenge") && !text.includes("non-academic"));
  return { academic: academic?.questionId ?? null, non_academic: nonAcademic?.questionId ?? null };
}

// Challenge Category Heatmap cell: count / n x 100, rounded half-up to one
// decimal in integer arithmetic so exact halves (1 / 16 = 6.25) never round down.
export function holisticChallengeCategoryPercent(count: number, studentCount: number): number {
  if (studentCount <= 0) return 0;
  return Math.floor((2000 * count + studentCount) / (2 * studentCount)) / 10;
}
