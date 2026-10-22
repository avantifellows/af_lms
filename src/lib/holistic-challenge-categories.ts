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

export type HolisticChallengeCategoriesResult =
  | { ok: true; codes: HolisticChallengeCategoryCode[] }
  | { ok: false; error: string; emptyGroup?: HolisticChallengeCategoryGroup };

const HOLISTIC_CHALLENGE_CATEGORY_GROUPS = ["academic", "non_academic"] as const;

function isNoMajorIssue(code: string): boolean {
  return code.endsWith(".no_major_issue");
}

const CATEGORY_BY_CODE: ReadonlyMap<string, HolisticChallengeCategory> = new Map(
  HOLISTIC_CHALLENGE_CATEGORIES.map((category) => [category.code, category])
);

// The single source of the Challenge Category write rules. Drafts may hold any
// valid partial set; `final` (Submit / Edit notes) also needs both groups.
export function validateHolisticChallengeCategories(
  raw: unknown[],
  { final }: { final: boolean }
): HolisticChallengeCategoriesResult {
  const codes = raw.map((code) => (typeof code === "string" ? code.trim() : null));
  // Duplicates share the unknown-code message; the UI toggle never sends them.
  if (codes.some((code) => code === null || !CATEGORY_BY_CODE.has(code)) || new Set(codes).size !== codes.length) {
    return { ok: false, error: "Unknown Challenge Category" };
  }
  const categories = codes.map((code) => CATEGORY_BY_CODE.get(code as string)!);
  const mixesNoMajorIssue = HOLISTIC_CHALLENGE_CATEGORY_GROUPS.some((group) => {
    const inGroup = categories.filter((category) => category.group === group);
    return inGroup.length > 1 && inGroup.some(({ code }) => isNoMajorIssue(code));
  });
  if (mixesNoMajorIssue) {
    return { ok: false, error: "Choose either No major issue reported or other Challenge Categories" };
  }
  const emptyGroup = final
    ? HOLISTIC_CHALLENGE_CATEGORY_GROUPS.find((group) => !categories.some((category) => category.group === group))
    : undefined;
  if (emptyGroup) {
    return { ok: false, error: "Choose at least one Academic and one Non-academic Challenge Category", emptyGroup };
  }
  return { ok: true, codes: codes as HolisticChallengeCategoryCode[] };
}

export type HolisticChallengeCategoryGroups = {
  academic: HolisticChallengeCategory[];
  nonAcademic: HolisticChallengeCategory[];
};

// Catalogue order, regardless of the order codes were selected or stored in.
export function groupHolisticChallengeCategories(
  codes: Iterable<HolisticChallengeCategoryCode>
): HolisticChallengeCategoryGroups {
  const selected = new Set<string>(codes);
  const categories = HOLISTIC_CHALLENGE_CATEGORIES.filter(({ code }) => selected.has(code));
  return {
    academic: categories.filter(({ group }) => group === "academic"),
    nonAcademic: categories.filter(({ group }) => group === "non_academic"),
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
  const next = new Set<string>([...kept, code]);
  return HOLISTIC_CHALLENGE_CATEGORIES.filter((category) => next.has(category.code)).map((category) => category.code);
}

export type HolisticChallengeCategoryPlacement<Id> = {
  academicQuestionId: Id | null;
  nonAcademicQuestionId: Id | null;
};

// Case-insensitive Question-text match; a group with no matching Question has
// no placement. Only the hyphenated "non-academic" counts as Non-academic, and
// a Question mentioning both phrases is Non-academic only.
export function placeHolisticChallengeCategories<Id>(
  questions: ReadonlyArray<{ questionId: Id; text: string; position: number }>
): HolisticChallengeCategoryPlacement<Id> {
  const ordered = [...questions].sort((a, b) => a.position - b.position)
    .map((question) => ({ ...question, text: question.text.toLowerCase() }));
  const nonAcademic = ordered.find(({ text }) => text.includes("non-academic challenge"));
  const academic = ordered.find(({ text }) => text.includes("academic challenge") && !text.includes("non-academic"));
  return {
    academicQuestionId: academic ? academic.questionId : null,
    nonAcademicQuestionId: nonAcademic ? nonAcademic.questionId : null,
  };
}

// CSV cell text: labels in catalogue order, "" when there are none.
export function joinHolisticChallengeCategoryLabels(codes: Iterable<HolisticChallengeCategoryCode>): string {
  const selected = new Set<string>(codes);
  return HOLISTIC_CHALLENGE_CATEGORIES.filter(({ code }) => selected.has(code)).map(({ label }) => label).join("; ");
}

// Challenge Category Heatmap cell: count / n x 100, rounded half-up to one
// decimal in integer arithmetic so exact halves (1 / 16 = 6.25) never round down.
export function holisticChallengeCategoryPercent(count: number, studentCount: number): number {
  if (studentCount <= 0) return 0;
  return Math.floor((2000 * count + studentCount) / (2 * studentCount)) / 10;
}
