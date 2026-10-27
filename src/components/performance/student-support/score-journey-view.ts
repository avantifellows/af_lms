// Grouping, filtering and sorting for the Score journey table. Pure, so the
// ordering rules are tested without rendering.
import type { AlStatus, ScoreJourneyRow, ToNextLevel } from "@/types/student-support";

export type GenderFilter = "all" | "female" | "male";
export type SortKey = "default" | "name" | "predicted" | "toNext" | "latest" | "status";

export interface JourneyGroup {
  /** "M1", "B2" …, or null for students with no Mode AL yet. */
  level: string | null;
  rows: ScoreJourneyRow[];
}

const GROUP_ORDER = ["M1", "B1", "M2", "B2", "M3", "B3"];
const STATUS_ORDER: Record<AlStatus, number> = { Sliding: 0, Same: 1, Improving: 2 };
const LEVEL_ORDER: Record<string, number> = { M1: 0, B1: 0, M2: 1, B2: 1, M3: 2, B3: 2 };

export function matchesGender(row: ScoreJourneyRow, gender: GenderFilter): boolean {
  if (gender === "all") return true;
  return (row.gender || "").toLowerCase() === gender;
}

export function statusCounts(rows: ScoreJourneyRow[]): Record<AlStatus, number> {
  const counts: Record<AlStatus, number> = { Sliding: 0, Same: 0, Improving: 0 };
  for (const r of rows) if (r.status) counts[r.status] += 1;
  return counts;
}

/** Numbers for sorting; a missing value is null and always sorts last. */
function toNextValue(t: ToNextLevel): number | null {
  if (t.kind === "count") return t.questions;
  if (t.kind === "reached" || t.kind === "top") return 0;
  return null;
}

function sortValue(row: ScoreJourneyRow, key: SortKey): number | string | null {
  switch (key) {
    case "name":
      return row.name.toLowerCase();
    case "predicted":
      return row.predicted ? (LEVEL_ORDER[row.predicted] ?? null) : null;
    case "toNext":
      return toNextValue(row.toNext);
    case "latest":
      return row.latestPct;
    case "status":
      return row.status ? STATUS_ORDER[row.status] : null;
    default:
      return null;
  }
}

/** Default: Sliding → Same → Improving → no status, then latest score high → low. */
function defaultCompare(a: ScoreJourneyRow, b: ScoreJourneyRow): number {
  const sa = a.status ? STATUS_ORDER[a.status] : 3;
  const sb = b.status ? STATUS_ORDER[b.status] : 3;
  if (sa !== sb) return sa - sb;
  return (b.latestPct ?? -1) - (a.latestPct ?? -1);
}

export function sortRows(rows: ScoreJourneyRow[], key: SortKey, ascending: boolean): ScoreJourneyRow[] {
  if (key === "default") return [...rows].sort(defaultCompare);
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb === null) return a.name.localeCompare(b.name);
    if (va === null) return 1;
    if (vb === null) return -1;
    const cmp = typeof va === "string" ? va.localeCompare(vb as string) : va - (vb as number);
    return ascending ? cmp : -cmp;
  });
}

/** One group per Mode AL, best first, then "No Mode AL yet"; sorted within. */
export function groupRows(rows: ScoreJourneyRow[], key: SortKey, ascending: boolean): JourneyGroup[] {
  const groups: JourneyGroup[] = [];
  for (const level of GROUP_ORDER) {
    const inGroup = rows.filter((r) => r.mode === level);
    if (inGroup.length) groups.push({ level, rows: sortRows(inGroup, key, ascending) });
  }
  const rest = rows.filter((r) => !r.mode || !GROUP_ORDER.includes(r.mode));
  if (rest.length) groups.push({ level: null, rows: sortRows(rest, key, ascending) });
  return groups;
}
