"use client";

import type { ChapterAnalysisRow } from "@/types/quiz";

interface Props {
  chapters: ChapterAnalysisRow[];
}

function scoreColor(score: number): string {
  if (score < 40) return "bg-red-50";
  if (score < 60) return "bg-yellow-50";
  return "bg-green-50";
}

export default function ChapterAnalysisSection({ chapters }: Props) {
  if (chapters.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-700 mb-2">Chapter Analysis</h3>
        <p className="text-gray-500 text-sm">No chapter-level data available for this test.</p>
      </div>
    );
  }

  // Group by subject
  const grouped = new Map<string, ChapterAnalysisRow[]>();
  for (const ch of chapters) {
    const list = grouped.get(ch.subject) || [];
    list.push(ch);
    grouped.set(ch.subject, list);
  }

  const subjects = Array.from(grouped.keys());

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">Chapter Analysis</h3>
      <div className="space-y-4">
        {subjects.map((subject, idx) => (
          <details key={subject} open={idx === 0}>
            <summary className="cursor-pointer text-sm font-medium text-gray-800 hover:text-blue-600 py-1">
              {subject} ({grouped.get(subject)!.length} chapters)
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Chapter</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Avg Score</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Accuracy</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Attempt Rate</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Questions</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Avg Time/Q</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {grouped.get(subject)!.map((ch) => (
                    <tr key={`${ch.subject}-${ch.chapter_name}`} className={scoreColor(ch.avg_score)}>
                      <td className="px-4 py-2 text-sm text-gray-900">{ch.chapter_name}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">{ch.avg_score}%</td>
                      <td className="px-4 py-2 text-sm text-gray-900">{ch.accuracy}%</td>
                      <td className="px-4 py-2 text-sm text-gray-900">{ch.attempt_rate}%</td>
                      <td className="px-4 py-2 text-sm text-gray-900">{ch.questions}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {ch.avg_time != null ? `${ch.avg_time}s` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
