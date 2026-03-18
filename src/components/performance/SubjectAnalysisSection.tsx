"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import type { SubjectAnalysisRow } from "@/types/quiz";

interface Props {
  subjects: SubjectAnalysisRow[];
}

const COLORS = ["#059669", "#047857", "#10b981", "#34d399", "#6ee7b7", "#a7f3d0"];

const TH = "px-4 py-3 text-left text-xs uppercase tracking-wider font-bold bg-bg-card-alt text-text-muted";

export default function SubjectAnalysisSection({ subjects }: Props) {
  if (subjects.length === 0) return null;

  return (
    <div className="bg-bg-card border border-border">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b-2 border-border-accent">
        <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
          Subject Analysis
        </h3>
      </div>

      <div className="p-4 md:p-6">
        <ResponsiveContainer width="100%" height={Math.max(200, subjects.length * 50)}>
          <BarChart data={subjects} layout="vertical" margin={{ left: 80 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#D1E7DD" />
            <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
            <YAxis type="category" dataKey="subject" tick={{ fontSize: 12 }} width={80} />
            <Tooltip formatter={(value) => [`${value}%`, "Avg Score"]} />
            <Bar dataKey="avg_score">
              {subjects.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-border-accent">
                <th className={TH}>Subject</th>
                <th className={TH}>Avg Score</th>
                <th className={TH}>Accuracy</th>
                <th className={TH}>Attempt Rate</th>
                <th className={TH}>Questions</th>
              </tr>
            </thead>
            <tbody>
              {subjects.map((s) => (
                <tr
                  key={s.subject}
                  className="border-b border-border/25 transition-colors hover:bg-hover-bg"
                >
                  <td className="px-4 py-3 text-sm font-semibold text-text-primary">{s.subject}</td>
                  <td className="px-4 py-3 text-sm font-bold font-mono text-accent">{s.avg_score}%</td>
                  <td className="px-4 py-3 text-sm font-mono text-text-primary">{s.avg_accuracy}%</td>
                  <td className="px-4 py-3 text-sm font-mono text-text-primary">{s.avg_attempt_rate}%</td>
                  <td className="px-4 py-3 text-sm font-bold font-mono text-text-primary">{s.total_questions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
