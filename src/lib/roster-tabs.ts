/**
 * The School/Centre roster's outer tabs — client-safe, so the server tab list,
 * the client tab bar, and the Centre switcher agree on the ids and on which
 * tab a URL actually shows.
 */

/** Every outer roster tab id, in display order. */
export const ROSTER_TAB_IDS = [
  "enrollment",
  "curriculum",
  "performance",
  "quiz_sessions",
  "teacher_feedback",
  "mentorship",
  "holistic_mentorship",
  "visits",
] as const;

export type RosterTabId = (typeof ROSTER_TAB_IDS)[number];

/** The tab a roster page opens on when its URL names none. */
export const DEFAULT_ROSTER_TAB: RosterTabId = "enrollment";

/**
 * The tab a page shows for a raw `?tab=` value: the raw tab when it is
 * visible, otherwise the default tab when visible, otherwise the first visible
 * tab (empty when there are none). A hidden or unknown raw tab never wins.
 */
export function resolveVisibleTab(
  rawTab: string | null | undefined,
  visibleTabIds: readonly string[],
  defaultTab: string | null | undefined,
): string {
  const visible = (id: string | null | undefined) => (id && visibleTabIds.includes(id) ? id : null);
  return visible(rawTab) ?? visible(defaultTab) ?? visibleTabIds[0] ?? "";
}
