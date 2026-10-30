// Chapter selection and ordering for the Student report. Pure, so tested alone.
import type { ChapterRow } from "@/types/student-support";

export type ChapterSort = "priority" | "weakest" | "order";

const PRIORITY_ORDER: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
const priorityRank = (p: string | null) => (p && p in PRIORITY_ORDER ? PRIORITY_ORDER[p] : 3);
const scoreOf = (c: ChapterRow) => c.score ?? Infinity;

/** Up to 4 focus chapters: flagged High-priority chapters, Concept gap first,
 *  then the lowest score. */
export function focusChapters(chapters: ChapterRow[]): ChapterRow[] {
  return chapters
    .filter((c) => c.flag && c.priority === "High")
    .sort((a, b) => (a.flag === b.flag ? scoreOf(a) - scoreOf(b) : a.flag === "C" ? -1 : 1))
    .slice(0, 4);
}

export function sortChapters(chapters: ChapterRow[], sort: ChapterSort): ChapterRow[] {
  const rows = [...chapters];
  if (sort === "weakest") return rows.sort((a, b) => scoreOf(a) - scoreOf(b));
  if (sort === "order") return rows.sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, undefined, { numeric: true }));
  return rows.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || scoreOf(a) - scoreOf(b));
}
