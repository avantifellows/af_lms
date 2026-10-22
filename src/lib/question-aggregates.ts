// Pure aggregation over question-level stats. Client-safe, so both the chapter-test
// report and Teacher View v2 (#324) group the same numbers the same way.
import type {
  CohortStat,
  QuestionGroupStat,
  QuestionStat,
} from "@/types/question-analytics";

export const DIFFICULTY_ORDER = ["easy", "medium", "hard"] as const;

export function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

function emptyGroup(label: string): QuestionGroupStat {
  return {
    label,
    questions: 0,
    responses: 0,
    attempted: 0,
    correct: 0,
    incorrect: 0,
    skipped: 0,
    skip_pct: 0,
    accuracy_pct: null,
  };
}

function finish(group: QuestionGroupStat): QuestionGroupStat {
  return {
    ...group,
    skip_pct: pct(group.skipped, group.responses),
    accuracy_pct: group.attempted > 0 ? pct(group.correct, group.attempted) : null,
  };
}

/**
 * Sums question stats into groups. A question with several keys (topics) counts
 * once in each, so a topic breakdown matches a per-topic query over the bridge.
 * Questions with no key are left out.
 */
export function groupQuestions(
  questions: QuestionStat[],
  keysOf: (q: QuestionStat) => string[],
): QuestionGroupStat[] {
  const groups = new Map<string, QuestionGroupStat>();
  for (const q of questions) {
    for (const key of new Set(keysOf(q))) {
      const g = groups.get(key) ?? emptyGroup(key);
      g.questions += 1;
      g.responses += q.responses;
      g.attempted += q.attempted;
      g.correct += q.correct;
      g.incorrect += q.incorrect;
      g.skipped += q.skipped;
      groups.set(key, g);
    }
  }
  return Array.from(groups.values(), finish);
}

export const byTopic = (questions: QuestionStat[]) =>
  groupQuestions(questions, (q) => q.topics);

/** Difficulty groups in easy → medium → hard order; untagged questions are left out. */
export function byDifficulty(questions: QuestionStat[]): QuestionGroupStat[] {
  const groups = groupQuestions(questions, (q) => (q.difficulty ? [q.difficulty] : []));
  const rank = (label: string) => {
    const i = DIFFICULTY_ORDER.indexOf(label as (typeof DIFFICULTY_ORDER)[number]);
    return i === -1 ? DIFFICULTY_ORDER.length : i;
  };
  return groups.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
}

export type InsightKind = "skipped" | "incorrect" | "correct";

/**
 * Orders groups for an insight list:
 * - skipped: highest skip share first;
 * - incorrect: lowest accuracy among attempted first;
 * - correct: highest accuracy first.
 * Groups with nothing attempted are left out of the accuracy lists.
 */
export function rankGroups(groups: QuestionGroupStat[], kind: InsightKind): QuestionGroupStat[] {
  if (kind === "skipped") {
    return [...groups].sort((a, b) => b.skip_pct - a.skip_pct || a.label.localeCompare(b.label));
  }
  const attempted = groups.filter((g) => g.accuracy_pct != null);
  const dir = kind === "incorrect" ? 1 : -1;
  return attempted.sort(
    (a, b) => dir * (a.accuracy_pct! - b.accuracy_pct!) || a.label.localeCompare(b.label),
  );
}

/**
 * Orders questions for a ranking table, by count:
 * - skipped: most skipped;
 * - incorrect: most wrong;
 * - correct: most correct.
 * Ties go to test order.
 */
export function rankQuestions(questions: QuestionStat[], kind: InsightKind): QuestionStat[] {
  const value = (q: QuestionStat) =>
    kind === "skipped" ? q.skipped : kind === "incorrect" ? q.incorrect : q.correct;
  return [...questions].sort(
    (a, b) => value(b) - value(a) || (a.position ?? 0) - (b.position ?? 0),
  );
}

/** Combines slices (e.g. genders) into one cohort, weighting each by its students. */
export function combineCohorts(slices: CohortStat[]): CohortStat {
  const students = slices.reduce((n, s) => n + s.students, 0);
  const weighted = (pick: (s: CohortStat) => number) =>
    students > 0
      ? Math.round((slices.reduce((t, s) => t + pick(s) * s.students, 0) / students) * 10) / 10
      : 0;
  return {
    students,
    avg_attempt_rate: weighted((s) => s.avg_attempt_rate),
    avg_accuracy: weighted((s) => s.avg_accuracy),
    avg_score: weighted((s) => s.avg_score),
  };
}

/** "Q7": 1-based label from the 0-based position, else from the list index. */
export function questionLabel(q: QuestionStat, index: number): string {
  return `Q${(q.position ?? index) + 1}`;
}
