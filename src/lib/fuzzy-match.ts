/**
 * Token-based fuzzy matching: splits query into whitespace-separated tokens
 * and checks that every token appears as a substring in the candidate.
 *
 * Case-insensitive. Empty query matches everything.
 */
export function fuzzyMatch(query: string, candidate: string | null | undefined): boolean {
  if (!candidate) return false;
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const hay = candidate.toLowerCase();
  return q.split(/\s+/).every((token) => hay.includes(token));
}
