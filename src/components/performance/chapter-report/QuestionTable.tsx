"use client";

import { Fragment, useState, type ReactNode } from "react";
import { pct, questionLabel } from "@/lib/question-aggregates";
import type { QuestionStat } from "@/types/question-analytics";
import QuestionContentView from "./QuestionContentView";

export const TH = "px-3 py-2 text-left text-xs uppercase tracking-wider font-bold text-text-muted";
export const TD = "px-3 py-2 text-sm font-mono text-text-primary whitespace-nowrap";

/** "2.3 min" from seconds; "—" when not recorded. */
export function formatMinutes(seconds: number | null): string {
  return seconds == null ? "—" : `${Math.round(seconds / 6) / 10} min`;
}

/** "12 (25%)": a count and its share of a whole. */
export function countWithPct(count: number, whole: number): string {
  return `${count} (${Math.round(pct(count, whole))}%)`;
}

export function DifficultyLabel({ difficulty }: { difficulty: string | null }) {
  if (!difficulty) return <span className="text-text-muted">—</span>;
  return <span className="capitalize">{difficulty}</span>;
}

export interface QuestionColumn {
  header: string;
  cell: (q: QuestionStat) => ReactNode;
}

interface Props {
  questions: QuestionStat[];
  columns: QuestionColumn[];
  schoolUdise: string;
  /** The session's query (grade, sessionId, program, stream); null when the test
   *  is not a new-CMS test, and a row then expands to its topic only. */
  sessionQuery: string | null;
  emptyText?: string;
}

/** Question rows that expand to the question itself (from the CMS), its answer and topics. */
export default function QuestionTable({ questions, columns, schoolUdise, sessionQuery, emptyText }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  if (questions.length === 0) {
    return <p className="text-sm text-text-muted">{emptyText ?? "No questions."}</p>;
  }

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-border-accent">
            <th className={TH}>Question</th>
            {columns.map((c) => (
              <th key={c.header} className={TH}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {questions.map((q, i) => {
            const isOpen = open.has(q.question_id);
            return (
              <Fragment key={q.question_id}>
                <tr
                  onClick={() => toggle(q.question_id)}
                  className="border-b border-border/25 cursor-pointer transition-colors hover:bg-hover-bg"
                >
                  <td className={`${TD} font-bold`}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      className="inline-flex items-center gap-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(q.question_id);
                      }}
                    >
                      <span className="text-xs text-text-muted" aria-hidden="true">
                        {isOpen ? "▼" : "▶"}
                      </span>
                      {questionLabel(q, i)}
                    </button>
                  </td>
                  {columns.map((c) => (
                    <td key={c.header} className={TD}>
                      {c.cell(q)}
                    </td>
                  ))}
                </tr>
                {isOpen && (
                  <tr className="bg-bg-card-alt/40">
                    <td colSpan={columns.length + 1} className="px-4 py-3 space-y-3">
                      <p className="text-xs text-text-secondary">
                        <span className="font-bold uppercase tracking-wide text-text-muted">Topic </span>
                        {q.topics.length > 0 ? q.topics.join(", ") : "Not tagged"}
                      </p>
                      {sessionQuery && q.cms_question_id != null ? (
                        <QuestionContentView
                          schoolUdise={schoolUdise}
                          sessionQuery={sessionQuery}
                          cmsQuestionId={q.cms_question_id}
                        />
                      ) : (
                        <p className="text-xs text-text-muted">
                          The question text is available for new-CMS tests only.
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
