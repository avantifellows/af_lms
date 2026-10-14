/**
 * Centre switcher option shaping — client-safe (no `@/lib/db`), so the Centre
 * page's client switcher and the server loader share one place for option
 * logic: ordering, context labels, and the current-Centre merge.
 */

import { DEFAULT_ROSTER_TAB, ROSTER_TAB_IDS } from "@/lib/roster-tabs";

/** One browsable Centre the viewer may open, as the list query returns it. */
export interface CentreSwitcherEntry {
  id: string;
  name: string;
  programName: string | null;
  schoolName: string;
  schoolCode: string;
  // Configured option labels, used only to tell otherwise identical entries
  // apart. The page's own Centre takes them from its list row, if any.
  typeLabel?: string | null;
  categoryLabel?: string | null;
}

export interface CentreSwitcherOption {
  id: string;
  primary: string;
  context: string;
  // Separate source fields so search never parses the presentation labels.
  search: {
    centreName: string;
    programName: string | null;
    schoolName: string;
    schoolCode: string;
  };
  // Extra context for otherwise identical options (type/category, Centre ID).
  disambiguator?: string;
  isCurrent: boolean;
}

function toOption(entry: CentreSwitcherEntry, isCurrent: boolean): CentreSwitcherOption {
  return {
    id: entry.id,
    primary: entry.name,
    context: `${entry.programName ?? "No Program"} · ${entry.schoolName} (${entry.schoolCode})`,
    search: {
      centreName: entry.name,
      programName: entry.programName,
      schoolName: entry.schoolName,
      schoolCode: entry.schoolCode,
    },
    isCurrent,
  };
}

const compareText = (a: string, b: string) =>
  a.toLocaleLowerCase().localeCompare(b.toLocaleLowerCase());

function compareEntries(a: CentreSwitcherEntry, b: CentreSwitcherEntry): number {
  return (
    compareText(a.name, b.name) ||
    compareText(a.schoolName, b.schoolName) ||
    compareText(a.programName ?? "", b.programName ?? "") ||
    Number(a.id) - Number(b.id)
  );
}

/**
 * The switcher's ordered options: the page's own Centre first (even if the
 * list omitted it), then every other listed Centre by name → School → Program
 * → numeric id. A list row for the current Centre is merged, not repeated.
 */
export function buildCentreSwitcherOptions(
  entries: CentreSwitcherEntry[],
  current: CentreSwitcherEntry,
): CentreSwitcherOption[] {
  const listed = entries.find((entry) => String(entry.id) === String(current.id));
  const currentEntry: CentreSwitcherEntry = {
    ...current,
    typeLabel: current.typeLabel ?? listed?.typeLabel ?? null,
    categoryLabel: current.categoryLabel ?? listed?.categoryLabel ?? null,
  };
  const others = entries
    .filter((entry) => String(entry.id) !== String(current.id))
    .sort(compareEntries);
  const options = [toOption(currentEntry, true), ...others.map((entry) => toOption(entry, false))];
  const disambiguators = disambiguate([currentEntry, ...others]);
  return options.map((option) => {
    const disambiguator = disambiguators.get(option.id);
    return disambiguator ? { ...option, disambiguator } : option;
  });
}

/**
 * Extra context for entries that would otherwise look identical (same Centre
 * name, Program, School name and School code): their type/category labels
 * when those alone tell them apart within the group, else `Centre ID: <id>`.
 * A unique entry gets nothing. Keyed by Centre id.
 */
function disambiguate(entries: CentreSwitcherEntry[]): Map<string, string> {
  const groups = new Map<string, CentreSwitcherEntry[]>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.name, entry.programName, entry.schoolName, entry.schoolCode]);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const result = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const labels = group.map((entry) =>
      [entry.typeLabel, entry.categoryLabel].filter(Boolean).join(" · "),
    );
    group.forEach((entry, index) => {
      const own = labels[index];
      const sufficient = own !== "" && labels.filter((label) => label === own).length === 1;
      result.set(String(entry.id), sufficient ? own : `Centre ID: ${entry.id}`);
    });
  }
  return result;
}

/** Show the switcher only when there is somewhere else to go. */
export function shouldShowSwitcher(options: CentreSwitcherOption[]): boolean {
  return options.some((option) => !option.isCurrent);
}

/**
 * Whether an option matches the switcher search: a trimmed, case-insensitive
 * substring of the Centre, Program, School name, or School code. An empty
 * query matches everything.
 */
export function matchesCentreSearch(option: CentreSwitcherOption, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const { centreName, programName, schoolName, schoolCode } = option.search;
  return [centreName, programName, schoolName, schoolCode].some(
    (field) => field != null && field.toLocaleLowerCase().includes(needle),
  );
}

/**
 * Where switching to another Centre lands: its page on the outer tab the user
 * is looking at. Only the tab carries over (and not at all for the default
 * Enrollment tab) — Grade, stream, report, every other parameter and the hash
 * belong to the source Centre. Pass the effective visible tab, never a raw
 * `?tab=` value that may be hidden.
 */
export function centreSwitchHref(targetId: string, effectiveTab: string): string {
  const carry = effectiveTab !== DEFAULT_ROSTER_TAB && (ROSTER_TAB_IDS as readonly string[]).includes(effectiveTab);
  return carry ? `/centre/${targetId}?tab=${effectiveTab}` : `/centre/${targetId}`;
}
