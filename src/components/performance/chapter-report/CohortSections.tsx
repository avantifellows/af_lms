"use client";

import type { ReactNode } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import type { GenderStat, SchoolComparisonRow } from "@/types/question-analytics";
import { TD, TH } from "./QuestionTable";

const GENDER_LABEL: Record<string, string> = { female: "Girls", male: "Boys", other: "Other" };
const GENDER_ORDER = ["female", "male", "other", ""];

interface CohortRow {
  key: string;
  label: ReactNode;
  students: number;
  metrics: ReactNode[];
  className?: string;
}

/** Students, then attempt rate, accuracy and score, one row per cohort. */
function CohortTable({ first, rows }: { first: string; rows: CohortRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-border-accent">
            {[first, "Students", "Attempt Rate", "Accuracy", "Score"].map((h) => (
              <th key={h} className={TH}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`border-b border-border/25 ${r.className ?? ""}`}>
              <td className="px-3 py-2 text-sm text-text-primary">{r.label}</td>
              <td className={TD}>{r.students}</td>
              {r.metrics.map((m, i) => (
                <td key={i} className={TD}>{m}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Attempt rate, accuracy and score for girls and boys. */
export function GenderSplitSection({ gender }: { gender: GenderStat[] }) {
  const rows = [...gender]
    .sort((a, b) => GENDER_ORDER.indexOf(a.gender) - GENDER_ORDER.indexOf(b.gender))
    .map((g) => ({
      key: g.gender,
      label: GENDER_LABEL[g.gender] ?? "Not recorded",
      students: g.students,
      metrics: [g.avg_attempt_rate, g.avg_accuracy, g.avg_score].map((v) => `${v}%`),
    }));
  return (
    <SectionCard title="Gender Split">
      <CohortTable first="Gender" rows={rows} />
    </SectionCard>
  );
}

function Bar({ value, highlight }: { value: number; highlight: boolean }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2 min-w-[140px]">
      <div className="h-2 flex-1 rounded bg-bg-card-alt overflow-hidden">
        <div
          className={`h-full rounded ${highlight ? "bg-accent" : "bg-text-muted/50"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="text-sm font-mono text-text-primary w-14 text-right">{value}%</span>
    </div>
  );
}

/** Centres of the same kind (CoE or Nodal) that sat the same test, best score first. */
export function SchoolComparisonSection({ rows }: { rows: SchoolComparisonRow[] }) {
  const others = rows.filter((r) => !r.is_this_school).length;
  const cohortRows = rows.map((r) => ({
    key: r.udise,
    label: (
      <>
        {r.school}
        {r.is_this_school && (
          <span className="ml-2 text-xs font-bold uppercase tracking-wide text-accent">This centre</span>
        )}
      </>
    ),
    students: r.students,
    metrics: [r.avg_attempt_rate, r.avg_accuracy, r.avg_score].map((v, i) => (
      <Bar key={i} value={v} highlight={r.is_this_school} />
    )),
    className: r.is_this_school ? "bg-hover-bg" : "",
  }));
  return (
    <SectionCard
      title="Comparison with Other Centres"
      subtitle={
        others === 0
          ? "No other centre to compare with on this test yet."
          : "CoEs compare with CoEs and Nodals with Nodals: same test, grade and stream, best score first. Small groups can swing a lot on one or two students."
      }
    >
      {others > 0 && <CohortTable first="Centre" rows={cohortRows} />}
    </SectionCard>
  );
}
