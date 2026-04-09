"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import type { ChapterAnalysisRow } from "@/types/quiz";

interface Props {
  chapters: ChapterAnalysisRow[];
}

function scoreColorClass(score: number): string {
  if (score < 40) return "bg-danger-bg";
  if (score < 60) return "bg-warning-bg";
  return "bg-success-bg";
}

const TH = "px-4 py-3 text-left text-xs uppercase tracking-wider font-bold bg-bg-card-alt text-text-muted";

export default function ChapterAnalysisSection({ chapters }: Props) {
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(() => {
    // Open first subject by default
    if (chapters.length > 0) {
      const firstSubject = chapters[0].subject;
      return new Set([firstSubject]);
    }
    return new Set();
  });

  if (chapters.length === 0) {
    return (
      <Card elevation="sm" className="overflow-hidden">
        <div className="px-4 md:px-6 py-3 md:py-4 border-b-2 border-border-accent">
          <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
            Chapter Analysis
          </h3>
        </div>
        <div className="p-4 md:p-6">
          <p className="text-sm text-text-muted">No chapter-level data available for this test.</p>
        </div>
      </Card>
    );
  }

  const grouped = new Map<string, ChapterAnalysisRow[]>();
  for (const ch of chapters) {
    const list = grouped.get(ch.subject) || [];
    list.push(ch);
    grouped.set(ch.subject, list);
  }

  const subjects = Array.from(grouped.keys());

  const toggleSubject = (subject: string) => {
    setOpenSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
  };

  return (
    <Card elevation="sm" className="overflow-hidden">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b-2 border-border-accent">
        <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
          Chapter Analysis
        </h3>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {subjects.map((subject) => {
          const isOpen = openSubjects.has(subject);
          return (
            <div key={subject}>
              <button
                onClick={() => toggleSubject(subject)}
                className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide transition-colors min-h-[44px] py-1 rounded-lg px-2 hover:bg-hover-bg ${
                  isOpen ? "text-accent" : "text-text-primary hover:text-accent"
                }`}
              >
                <span className="w-1 h-4 bg-accent" />
                {subject} ({grouped.get(subject)!.length} chapters)
                <span className="text-xs">{isOpen ? "▼" : "▶"}</span>
              </button>

              {isOpen && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b-2 border-border-accent">
                        <th className={TH}>Chapter</th>
                        <th className={TH}>Avg Score</th>
                        <th className={TH}>Accuracy</th>
                        <th className={TH}>Attempt Rate</th>
                        <th className={TH}>Questions</th>
                        <th className={TH}>Avg Time/Q</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.get(subject)!.map((ch) => (
                        <tr
                          key={`${ch.subject}-${ch.chapter_name}`}
                          className={`border-b border-border/25 transition-colors hover:bg-hover-bg ${scoreColorClass(ch.avg_score)}`}
                        >
                          <td className="px-4 py-3 text-sm text-text-primary">{ch.chapter_name}</td>
                          <td className="px-4 py-3 text-sm font-bold font-mono text-accent">{ch.avg_score}%</td>
                          <td className="px-4 py-3 text-sm font-mono text-text-primary">{ch.accuracy}%</td>
                          <td className="px-4 py-3 text-sm font-mono text-text-primary">{ch.attempt_rate}%</td>
                          <td className="px-4 py-3 text-sm font-bold font-mono text-text-primary">{ch.questions}</td>
                          <td className="px-4 py-3 text-sm font-mono text-text-primary">
                            {ch.avg_time != null ? `${ch.avg_time}s` : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
