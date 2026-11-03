// School Assignment Coverage filters (Holistic tab on School and Centre pages).
// They live in the page URL so Back from a Student, and the Student page's own
// back link, return to the same view. Every name has an `hm_` prefix so it can
// never collide with the page's other params (tab, program_id, source, grade,
// stream, students, curriculum, flag, view, q, page, ...). Defaults are omitted
// and invalid values read as defaults. Client-safe: no server-only imports.

/**
 * Progress filter values, in Students & Progress's order and with its value
 * strings ("" is All Students). Pending, Completed and No active phase are
 * assigned Students only; Unassigned is every Student without a Mentor.
 */
const COVERAGE_PROGRESS_VALUES = [
  "assigned",
  "pending",
  "completed",
  "no_active_phase",
  "unassigned",
] as const;
export type CoverageProgress = typeof COVERAGE_PROGRESS_VALUES[number];

export type CoverageFilters = {
  search: string;
  grade: "" | "11" | "12";
  /** A Mentor's user ID, or "" for All Mentors. */
  mentor: string;
  /** "" is All Students. */
  progress: "" | CoverageProgress;
};

export const DEFAULT_COVERAGE_FILTERS: CoverageFilters = {
  search: "",
  grade: "",
  mentor: "",
  progress: "",
};

const FILTER_PARAMS: Record<keyof CoverageFilters, string> = {
  search: "hm_search",
  grade: "hm_grade",
  mentor: "hm_mentor",
  progress: "hm_progress",
};
const FILTER_PREFIX = "hm_";

const CENTRE_PARAM = "centre_id";
/** The longest search the URL keeps; the search input uses the same limit. */
export const MAX_COVERAGE_SEARCH_LENGTH = 100;
const POSITIVE_ID = /^[1-9]\d{0,9}$/;

type ParamReader = { get(name: string): string | null };

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

function positiveId(value: string | null) {
  return value !== null && POSITIVE_ID.test(value) ? value : "";
}

export function readCoverageFilters(params: ParamReader): CoverageFilters {
  return {
    search: (params.get(FILTER_PARAMS.search) ?? "").slice(0, MAX_COVERAGE_SEARCH_LENGTH),
    grade: oneOf(params.get(FILTER_PARAMS.grade), ["11", "12"] as const, ""),
    mentor: positiveId(params.get(FILTER_PARAMS.mentor)),
    progress: oneOf(params.get(FILTER_PARAMS.progress), COVERAGE_PROGRESS_VALUES, ""),
  };
}

// A blank (or spaces-only) search filters nothing, so it is left out like a
// default; a real search keeps its spacing as typed.
function isDefaultFilter(filters: CoverageFilters, key: keyof CoverageFilters) {
  if (key === "search") return filters.search.trim() === "";
  return filters[key] === DEFAULT_COVERAGE_FILTERS[key];
}

/**
 * Which page a URL is, for the coverage filters: the path and every param
 * except `hm_` ones (filters, current or retired) and the School tab
 * (switching tabs stays on the page). A different Centre, `program_id` or
 * Program choice screen is another page.
 */
export function coveragePageKey(pathname: string, params: Iterable<[string, string]>) {
  const rest = [...params]
    .filter(([name]) => name !== "tab" && !name.startsWith(FILTER_PREFIX))
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .sort();
  return `${pathname}?${rest.join("&")}`;
}

/** Whether any filter narrows the roster (a blank search does not). */
export function hasActiveCoverageFilters(filters: CoverageFilters) {
  return (Object.keys(FILTER_PARAMS) as Array<keyof CoverageFilters>)
    .some((key) => !isDefaultFilter(filters, key));
}

/**
 * Sets the non-default filters on `params` and removes the default ones, and
 * any other `hm_` param (e.g. the retired `hm_assignment`).
 */
export function writeCoverageFilters(params: URLSearchParams, filters: CoverageFilters) {
  const known = new Set(Object.values(FILTER_PARAMS));
  for (const name of [...params.keys()]) {
    if (name.startsWith(FILTER_PREFIX) && !known.has(name)) params.delete(name);
  }
  for (const key of Object.keys(FILTER_PARAMS) as Array<keyof CoverageFilters>) {
    if (isDefaultFilter(filters, key)) params.delete(FILTER_PARAMS[key]);
    else params.set(FILTER_PARAMS[key], filters[key]);
  }
}

/**
 * The coverage view a Student/Phase page was opened from: the Centre (when it
 * was a Centre page) and the filters, as a sanitized query string. The Student
 * page keeps it on Phase links and locked-Phase redirects and adds it to its
 * back link.
 */
export function coverageReturnQuery(params: ParamReader) {
  const query = new URLSearchParams();
  const centreId = positiveId(params.get(CENTRE_PARAM));
  if (centreId) query.set(CENTRE_PARAM, centreId);
  writeCoverageFilters(query, readCoverageFilters(params));
  return query.toString();
}

/** The return query for a Student opened from this coverage view. */
export function coverageReturnFor(filters: CoverageFilters, centreId?: number) {
  const query = new URLSearchParams();
  if (centreId !== undefined) query.set(CENTRE_PARAM, String(centreId));
  writeCoverageFilters(query, filters);
  return coverageReturnQuery(query);
}

/** The Centre the coverage view was opened from, and the filters alone. */
export function splitCoverageReturn(returnQuery = "") {
  const query = new URLSearchParams(coverageReturnQuery(new URLSearchParams(returnQuery)));
  const centreId = query.get(CENTRE_PARAM);
  query.delete(CENTRE_PARAM);
  return { centreId, filterQuery: query.toString() };
}
