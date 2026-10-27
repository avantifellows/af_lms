// Display helpers shared by the chapter-test card and report.

/** "2026-10-14" → "October 14, 2026"; unparseable input is returned as is. */
export function formatLongDate(date: string | null): string {
  if (!date) return "";
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** 45.8 → "45.8%"; null → "—". */
export function formatPct(value: number | null | undefined): string {
  return value == null ? "—" : `${value}%`;
}

/** "X of Y students appeared", or "X students appeared" when Y is unknown. */
export function appearedLine(appeared: number, enrolled: number | null): string {
  return enrolled && enrolled > 0
    ? `${appeared} of ${enrolled} students appeared`
    : `${appeared} students appeared`;
}

/** "12P24 – Wave Optics · Physics" from the CMS chapter; the test name otherwise. */
export function chapterTitle(
  chapter: { code: string | null; name: string | null; subject: string | null } | null,
  testName: string,
): string {
  if (!chapter?.name) return testName;
  const head = chapter.code ? `${chapter.code} – ${chapter.name}` : chapter.name;
  return chapter.subject ? `${head} · ${chapter.subject}` : head;
}
