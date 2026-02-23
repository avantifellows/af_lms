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

const COLORS = ["#3b82f6", "#8b5cf6", "#f59e0b", "#10b981", "#ec4899", "#f97316"];

export default function SubjectAnalysisSection({ subjects }: Props) {
  if (subjects.length === 0) return null;

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Subject Analysis</h3>

      <ResponsiveContainer width="100%" height={Math.max(200, subjects.length * 50)}>
        <BarChart data={subjects} layout="vertical" margin={{ left: 80 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" domain={[0, 100]} unit="%" />
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
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Subject</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Avg Score</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Attempt Rate</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {subjects.map((s) => (
              <tr key={s.subject} className="hover:bg-gray-50">
                <td className="px-4 py-2 text-sm font-medium text-gray-900">{s.subject}</td>
                <td className="px-4 py-2 text-sm text-gray-900">{s.avg_score}%</td>
                <td className="px-4 py-2 text-sm text-gray-900">{s.avg_accuracy}%</td>
                <td className="px-4 py-2 text-sm text-gray-900">{s.avg_attempt_rate}%</td>
                <td className="px-4 py-2 text-sm text-gray-900">{s.total_questions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
