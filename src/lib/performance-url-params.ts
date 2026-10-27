// The Performance tab's URL vocabulary: which filters are shareable, and how
// each one is spelled as a query param.
//
// This used to be eight near-identical if-blocks inside PerformanceTab —
// "is this key in the patch, is its value meaningful, set or delete" written
// out once per filter. That boilerplate was 19 of the component's 41 cyclomatic
// complexity, which is what put it over the repo's CRAP gate. The shape is
// genuinely uniform, so it belongs in a table: one encoder per param, one loop.
//
// Pure and framework-free on purpose — no router, no hooks — so the rules are
// unit-testable without rendering anything.

export type TestCategory = "chapter" | "full";
export type FullTestView = "per_test" | "cumulative";

/** A partial update. A key that is absent is left alone; a key present with a
 *  null/empty value is removed from the URL. That distinction is the whole
 *  point of the type — `{ subject: null }` clears the subject, `{}` doesn't. */
export interface PerformanceUrlPatch {
  program?: string | null;
  grade?: number | null;
  session?: string | null;
  stream?: string | null;
  subject?: string | null;
  testGrade?: number | null;
  view?: FullTestView | null;
  category?: TestCategory | null;
}

/** The tab's filter state as the URL describes it on first render. `view` and
 *  `category` are never null — an absent or unrecognised param means the
 *  default, which is what the tab opens on. */
export interface PerformanceUrlState {
  program: string | null;
  grade: number | null;
  session: string | null;
  stream: string | null;
  subject: string | null;
  testGrade: number | null;
  view: FullTestView;
  category: TestCategory;
}

/** Parse a grade-like param. A non-numeric value (a hand-edited or truncated
 *  link) reads as absent rather than NaN, which would otherwise travel into
 *  the analytics queries as `grade=NaN`. */
function readNumber(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * Read the tab's initial filter state out of the URL.
 *
 * The counterpart to applyPerformanceParams: that one writes, this one reads.
 * Keeping the pair in one file is what stops the two spellings of a param
 * drifting apart.
 */
export function readPerformanceParams(searchParams: {
  get(name: string): string | null;
}): PerformanceUrlState {
  return {
    program: searchParams.get("program") || null,
    grade: readNumber(searchParams.get("grade")),
    session: searchParams.get("session") || null,
    stream: searchParams.get("stream") || null,
    subject: searchParams.get("subject") || null,
    testGrade: readNumber(searchParams.get("testGrade")),
    view: searchParams.get("view") === "cumulative" ? "cumulative" : "per_test",
    category: searchParams.get("category") === "chapter" ? "chapter" : "full",
  };
}

/** How each param renders. Returning null means "this param should not appear
 *  in the URL" — either because there's no value, or because the value is the
 *  default and carrying it would just make links noisier. */
type Encoders = {
  [K in keyof Required<PerformanceUrlPatch>]: (
    value: NonNullable<PerformanceUrlPatch[K]>
  ) => string | null;
};

const ENCODERS: Encoders = {
  program: (v) => v || null,
  // Numeric params use String() rather than a truthiness check so a legitimate
  // 0 would survive; no grade is 0 today, but the sentinel is handled by the
  // caller, not here.
  grade: (v) => String(v),
  session: (v) => v || null,
  stream: (v) => v || null,
  subject: (v) => v || null,
  testGrade: (v) => String(v),
  // "per_test" and "full" are the defaults the tab opens on, so they stay out
  // of the URL — a link with no view/category param means the default view.
  view: (v) => (v === "per_test" ? null : v),
  category: (v) => (v === "full" ? null : v),
};

const PARAM_NAMES = Object.keys(ENCODERS) as (keyof PerformanceUrlPatch)[];

/**
 * Apply `patch` to `current`, returning the new query string (no leading "?").
 *
 * Keys absent from the patch are preserved, so this composes with params the
 * Performance tab doesn't own (e.g. a tab selector on the page around it).
 */
export function applyPerformanceParams(
  current: URLSearchParams | string,
  patch: PerformanceUrlPatch
): string {
  const params = new URLSearchParams(
    typeof current === "string" ? current : current.toString()
  );

  for (const name of PARAM_NAMES) {
    const value = patch[name];
    // Absent key: leave whatever the URL already says untouched.
    if (value === undefined) continue;
    // The encoder map is keyed by the same union as the patch, but TypeScript
    // can't see that `patch[name]` and `ENCODERS[name]` are correlated across
    // an iteration, so the call is widened here rather than at every use site.
    const encode = ENCODERS[name] as (v: unknown) => string | null;
    const encoded = value === null ? null : encode(value);
    if (encoded === null) params.delete(name);
    else params.set(name, encoded);
  }

  return params.toString();
}
