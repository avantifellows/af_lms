"use client";

import { SectionCard } from "@/components/ui/SectionCard";
import type { GenderStat, SchoolComparisonRow } from "@/types/question-analytics";
import { TD, TH } from "./QuestionTable";

const GENDER_LABEL: Record<string, string> = { female: "Girls", male: "Boys", other: "Other" };
const GENDER_ORDER = ["female", "male", "other", ""];

/** Attempt rate, accuracy and score for girls and boys. */
export function GenderSplitSection({ gender }: { gender: GenderStat[] }) {
  const rows = [...gender].sort(
    (a, b) => GENDER_ORDER.indexOf(a.gender) - GENDER_ORDER.indexOf(b.gender),
  );
  return (
    <SectionCard title="Gender Split">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-border-accent">
              <th className={TH}>Gender</th>
              <th className={TH}>Students</th>
              <th className={TH}>Attempt Rate</th>
              <th className={TH}>Accuracy</th>
              <th className={TH}>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.gender} className="border-b border-border/25">
                <td className="px-3 py-2 text-sm text-text-primary">
                  {GENDER_LABEL[g.gender] ?? "Not recorded"}
                </td>
                <td className={TD}>{g.students}</td>
                <td className={TD}>{g.avg_attempt_rate}%</td>
                <td className={TD}>{g.avg_accuracy}%</td>
                <td className={TD}>{g.avg_score}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

/** Every physical centre that sat the same test, best score first. */
export function SchoolComparisonSection({ rows }: { rows: SchoolComparisonRow[] }) {
  const others = rows.filter((r) => !r.is_this_school).length;
  return (
    <SectionCard
      title="Comparison with Other Centres"
      subtitle={
        others === 0
          ? "No other centre has taken this test yet."
          : "Centres that have taken the same test, best score first. Small groups can swing a lot on one or two students."
      }
    >
      {others > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-border-accent">
                <th className={TH}>Centre</th>
                <th className={TH}>Students</th>
                <th className={TH}>Attempt Rate</th>
                <th className={TH}>Accuracy</th>
                <th className={TH}>Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.udise}
                  className={`border-b border-border/25 ${r.is_this_school ? "bg-hover-bg" : ""}`}
                >
                  <td className="px-3 py-2 text-sm text-text-primary">
                    {r.school}
                    {r.is_this_school && (
                      <span className="ml-2 text-xs font-bold uppercase tracking-wide text-accent">This centre</span>
                    )}
                  </td>
                  <td className={TD}>{r.students}</td>
                  <td className="px-3 py-2"><Bar value={r.avg_attempt_rate} highlight={r.is_this_school} /></td>
                  <td className="px-3 py-2"><Bar value={r.avg_accuracy} highlight={r.is_this_school} /></td>
                  <td className="px-3 py-2"><Bar value={r.avg_score} highlight={r.is_this_school} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
