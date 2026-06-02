"use client";

import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import StatCard from "../StatCard";
import type {
  CumulativeALData,
  CumulativeALRow,
  ProgressionEntry,
  ProgressionTest,
} from "@/types/quiz";

interface Props {
  schoolUdise: string;
  grade: number;
  program?: string;
  stream?: string;
}

// Display order — best (top tier) first. M1/B1 are top of their respective
// stream-specific scales; M2/B2 are mid; NQ/NE are bottom.
const AL_DISPLAY_ORDER = [
  "M1",
  "B1",
  "M2",
  "B2",
  "Not Qualified",
  "Not Eligible for Academic Level",
];

// Unified rank — M and B tiers are parallel scales (engineering vs medical).
const AL_RANK: Record<string, number> = {
  M1: 3,
  B1: 3,
  M2: 2,
  B2: 2,
  "Not Qualified": 1,
  "Not Eligible for Academic Level": 0,
};

const AL_SHORT_LABEL: Record<string, string> = {
  "Not Qualified": "NQ",
  "Not Eligible for Academic Level": "NE",
};

// Display label for canonical stream keys (mirrors bigquery.ts streamDisplayLabel).
const STREAM_DISPLAY: Record<string, string> = {
  pcm: "PCM (JEE / Engineering)",
  pcb: "PCB (NEET / Medical)",
  pcmb: "PCMB",
  engineering: "Engineering",
  medical: "Medical",
  foundation: "Foundation",
  clat: "CLAT",
  ca: "CA",
};

function streamGroupLabel(canonical: string | null): string {
  if (!canonical) return "Stream not set";
  return STREAM_DISPLAY[canonical] || canonical.toUpperCase();
}

function shortLabel(al: string): string {
  return AL_SHORT_LABEL[al] || al;
}

function alChipColor(al: string): string {
  switch (al) {
    case "M1":
    case "B1":
      return "bg-success-bg text-success border-success/30";
    case "M2":
    case "B2":
      return "bg-success-bg/50 text-success/80 border-success/20";
    case "Not Qualified":
      return "bg-warning-bg text-warning border-warning/30";
    case "Not Eligible for Academic Level":
      return "bg-bg-card-alt text-text-muted border-border";
    default:
      return "bg-bg-card-alt text-text-muted border-border";
  }
}

type SortKey = "name" | "tests" | "mode_al" | "latest_al";
type SortDir = "asc" | "desc";

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function latestAL(progression: ProgressionEntry[]): string | null {
  if (!progression.length) return null;
  return progression[progression.length - 1].academic_level;
}

function latestEntry(progression: ProgressionEntry[]): ProgressionEntry | null {
  if (!progression.length) return null;
  return progression[progression.length - 1];
}

function formatMarks(entry: { marks_scored: number | null; max_marks_possible: number | null }): string | null {
  const { marks_scored, max_marks_possible } = entry;
  if (marks_scored == null || max_marks_possible == null) return null;
  const scored = Number.isInteger(marks_scored) ? marks_scored : Math.round(marks_scored * 10) / 10;
  return `${scored}/${max_marks_possible}`;
}

// Lowercase the display-label stream back to canonical form so we can group
// students. The API returns `stream` as a display label ("PCM"); canonical is
// the lowercase form ("pcm"). This is a deterministic mapping.
function studentCanonicalStream(row: CumulativeALRow): string | null {
  if (!row.stream) return null;
  return row.stream.toLowerCase();
}

interface StreamGroup {
  key: string; // canonical stream or "__none__"
  canonical: string | null;
  label: string;
  tests: ProgressionTest[];
  students: CumulativeALRow[];
}

function buildGroups(data: CumulativeALData): StreamGroup[] {
  const map = new Map<string, StreamGroup>();
  const keyOf = (canonical: string | null) => canonical || "__none__";

  for (const t of data.tests) {
    const key = keyOf(t.stream);
    if (!map.has(key)) {
      map.set(key, {
        key,
        canonical: t.stream,
        label: streamGroupLabel(t.stream),
        tests: [],
        students: [],
      });
    }
    map.get(key)!.tests.push(t);
  }

  for (const s of data.students) {
    const sc = studentCanonicalStream(s);
    const key = keyOf(sc);
    if (!map.has(key)) {
      map.set(key, {
        key,
        canonical: sc,
        label: streamGroupLabel(sc),
        tests: [],
        students: [],
      });
    }
    map.get(key)!.students.push(s);
  }

  // Drop empty groups, sort by group label for stable display.
  const groups = [...map.values()].filter((g) => g.students.length > 0);
  groups.sort((a, b) => a.label.localeCompare(b.label));
  // Sort each group's tests chronologically (already pre-sorted, but be safe).
  for (const g of groups) {
    g.tests.sort((a, b) => a.start_date.localeCompare(b.start_date));
  }
  return groups;
}

export default function CumulativeALTable({ schoolUdise, grade, program, stream }: Props) {
  const [data, setData] = useState<CumulativeALData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("mode_al");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setData(null);

    const programParam = program ? `&program=${encodeURIComponent(program)}` : "";
    const streamParam = stream ? `&stream=${encodeURIComponent(stream)}` : "";
    fetch(
      `/api/quiz-analytics/${schoolUdise}/cumulative-als?grade=${grade}${programParam}${streamParam}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Failed to fetch cumulative AL data");
        }
        return res.json();
      })
      .then((d: CumulativeALData) => setData(d))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [schoolUdise, grade, program, stream]);

  const groups = useMemo(() => (data ? buildGroups(data) : []), [data]);

  const summary = useMemo(() => {
    if (!data) return null;
    const counts: Record<string, number> = {};
    const totalStudents = data.students.length;
    let totalTests = 0;
    for (const s of data.students) {
      totalTests += s.total_major_tests;
      if (s.mode_al) counts[s.mode_al] = (counts[s.mode_al] || 0) + 1;
    }
    return { counts, totalStudents, totalTests };
  }, [data]);

  const sortStudents = (rows: CumulativeALRow[]): CumulativeALRow[] => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      switch (sortKey) {
        case "name":
          return dir * a.student_name.localeCompare(b.student_name);
        case "tests":
          return dir * (a.total_major_tests - b.total_major_tests);
        case "mode_al": {
          const ar = a.mode_al ? AL_RANK[a.mode_al] ?? -1 : -1;
          const br = b.mode_al ? AL_RANK[b.mode_al] ?? -1 : -1;
          if (ar !== br) return dir * (ar - br);
          return dir * (a.total_major_tests - b.total_major_tests);
        }
        case "latest_al": {
          const al = latestAL(a.progression);
          const bl = latestAL(b.progression);
          const ar = al ? AL_RANK[al] ?? -1 : -1;
          const br = bl ? AL_RANK[bl] ?? -1 : -1;
          if (ar !== br) return dir * (ar - br);
          return dir * (a.total_major_tests - b.total_major_tests);
        }
      }
    });
    return sorted;
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "name" ? "asc" : "desc");
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return null;
    return <span className="ml-1 text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-[30vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="ml-3 text-sm text-text-secondary">Loading cumulative data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">
        {error}
      </div>
    );
  }

  if (!data || data.students.length === 0) {
    return (
      <div className="p-8 text-center bg-bg-card-alt border border-border rounded-lg shadow-sm">
        <p className="text-sm text-text-muted">
          No cumulative AL data available for this grade
          {stream ? " and selected stream" : ""} yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
          <StatCard label="Students Tracked" value={summary.totalStudents} color="brand-gold" />
          <StatCard label="Major Tests Taken" value={summary.totalTests} color="brand-coral" />
          <StatCard
            label="Mode AL Distribution"
            value={
              AL_DISPLAY_ORDER
                .filter((al) => summary.counts[al])
                .map((al) => `${shortLabel(al)}:${summary.counts[al]}`)
                .join(" · ") || "—"
            }
            size="sm"
            color="brand-amber"
          />
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
        <span className="font-bold uppercase tracking-wide mr-1">Legend</span>
        {AL_DISPLAY_ORDER.map((al) => (
          <span
            key={al}
            className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded border ${alChipColor(al)}`}
            title={al}
          >
            {shortLabel(al)}
          </span>
        ))}
        <span className="text-text-muted">— newer tests on the right →</span>
      </div>

      {/* One matrix per stream group */}
      {groups.map((group) => (
        <StreamMatrix
          key={group.key}
          group={group}
          sortStudents={sortStudents}
          sortKey={sortKey}
          toggleSort={toggleSort}
          sortIndicator={sortIndicator}
        />
      ))}
    </div>
  );
}

interface StreamMatrixProps {
  group: StreamGroup;
  sortStudents: (rows: CumulativeALRow[]) => CumulativeALRow[];
  sortKey: SortKey;
  toggleSort: (key: SortKey) => void;
  sortIndicator: (key: SortKey) => React.ReactNode;
}

function StreamMatrix({
  group,
  sortStudents,
  toggleSort,
  sortIndicator,
}: StreamMatrixProps) {
  const sorted = sortStudents(group.students);
  const showTestColumns = group.tests.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-text-primary">
          {group.label}
        </h3>
        <span className="text-xs text-text-muted">
          {group.students.length} student{group.students.length === 1 ? "" : "s"}
          {showTestColumns
            ? ` · ${group.tests.length} test${group.tests.length === 1 ? "" : "s"}`
            : " · no tests recorded"}
        </span>
      </div>

      <Card elevation="sm" className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-bg-card-alt">
              <tr className="border-b border-border">
                <th
                  className="text-left px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-muted cursor-pointer select-none sticky left-0 bg-bg-card-alt z-10"
                  onClick={() => toggleSort("name")}
                >
                  Student{sortIndicator("name")}
                </th>
                <th
                  className="text-right px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-muted cursor-pointer select-none"
                  onClick={() => toggleSort("tests")}
                >
                  #{sortIndicator("tests")}
                </th>
                <th
                  className="text-left px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-muted cursor-pointer select-none"
                  onClick={() => toggleSort("mode_al")}
                >
                  Mode AL{sortIndicator("mode_al")}
                </th>
                <th
                  className="text-left px-3 py-2 text-xs font-bold uppercase tracking-wide text-text-muted cursor-pointer select-none"
                  onClick={() => toggleSort("latest_al")}
                >
                  Latest AL{sortIndicator("latest_al")}
                </th>
                {group.tests.map((t) => (
                  <th
                    key={t.session_id}
                    className="text-center px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-text-muted border-l border-border/40 align-bottom"
                    title={t.test_name}
                  >
                    <div className="max-w-[7.5rem] truncate" title={t.test_name}>
                      {t.test_name}
                    </div>
                    <div className="font-normal normal-case text-[10px] text-text-muted/80 mt-0.5">
                      {formatDate(t.start_date)}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => {
                const cellMap: Record<string, ProgressionEntry> = {};
                for (const e of row.progression) cellMap[e.session_id] = e;
                const latest = latestAL(row.progression);
                const latestE = latestEntry(row.progression);
                const latestMarks = latestE ? formatMarks(latestE) : null;
                return (
                  <tr
                    key={row.student_id}
                    className="border-b border-border/25 hover:bg-hover-bg transition-colors"
                  >
                    <td className="px-3 py-2 text-text-primary sticky left-0 bg-bg-card z-10">
                      {row.student_name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-text-primary">
                      {row.total_major_tests}
                    </td>
                    <td className="px-3 py-2">
                      {row.mode_al ? (
                        <span
                          className={`inline-flex items-center px-2 py-0.5 text-xs font-bold uppercase tracking-wide rounded border ${alChipColor(row.mode_al)}`}
                        >
                          {shortLabel(row.mode_al)}
                        </span>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {latest ? (
                        <div className="flex flex-col items-start gap-0.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 text-xs font-bold uppercase tracking-wide rounded border ${alChipColor(latest)}`}
                          >
                            {shortLabel(latest)}
                          </span>
                          {latestMarks && (
                            <span className="font-mono text-[10px] text-text-muted">
                              {latestMarks}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                    {group.tests.map((t) => {
                      const entry = cellMap[t.session_id];
                      const al = entry?.academic_level;
                      const marks = entry ? formatMarks(entry) : null;
                      return (
                        <td
                          key={t.session_id}
                          className="px-2 py-2 text-center border-l border-border/40"
                        >
                          {al ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <span
                                className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded border ${alChipColor(al)}`}
                                title={`${t.test_name} (${formatDate(t.start_date)}): ${al}${marks ? ` · ${marks}` : ""}`}
                              >
                                {shortLabel(al)}
                              </span>
                              {marks && (
                                <span className="font-mono text-[10px] text-text-muted">
                                  {marks}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-text-muted/60 text-xs">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
