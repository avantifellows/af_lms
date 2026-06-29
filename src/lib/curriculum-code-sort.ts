const CURRICULUM_CODE_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

/**
 * Compares two curriculum codes (chapter/topic codes) with natural numeric
 * ordering, so "2" sorts before "10". Null/empty codes sort last.
 */
export function compareCurriculumCodes(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return CURRICULUM_CODE_COLLATOR.compare(a, b);
}
