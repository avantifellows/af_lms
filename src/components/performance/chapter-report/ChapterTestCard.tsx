"use client";

import { Card } from "@/components/ui/Card";
import PriorityBadge from "../PriorityBadge";
import { appearedLine, chapterTitle, formatLongDate, formatPct } from "./format";
import type { TestTrendPoint } from "@/types/quiz";

interface Props {
  test: TestTrendPoint;
  /** Students in the test's stream at this School and grade; null when unknown. */
  enrolled: number | null;
  /** Students who submitted it (in the test's stream when it has one). */
  appeared: number;
  /** The grade the overview is showing; used when the test has no target grade. */
  grade: number;
  onClick: () => void;
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-text-muted">{label}</p>
      <p className="font-bold font-mono text-lg text-text-primary">{formatPct(value)}</p>
    </div>
  );
}

/** A chapter test on the Performance overview: what Poojita's report index shows, in LMS style. */
export default function ChapterTestCard({ test, enrolled, appeared, grade, onClick }: Props) {
  const meta = [
    `Grade ${test.test_grade ?? grade}`,
    formatLongDate(test.start_date),
    appearedLine(appeared, enrolled),
  ].filter(Boolean);

  return (
    <Card
      elevation="sm"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="p-4 cursor-pointer transition-colors hover:border-accent/50 hover:bg-hover-bg"
    >
      <h4 className="text-sm font-bold text-text-primary">
        {chapterTitle(test.chapter, test.test_name)}
      </h4>
      <div className="flex flex-wrap items-center gap-2 mt-2">
        {test.exam && (
          <span className="text-xs font-bold uppercase tracking-wide text-text-secondary">
            {test.exam}
          </span>
        )}
        {test.chapter?.priority && (
          <PriorityBadge priority={test.chapter.priority} suffix=" priority" />
        )}
      </div>
      <p className="text-xs text-text-muted mt-2">{meta.join(" · ")}</p>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Metric label="Attempt" value={test.avg_attempt_rate} />
        <Metric label="Accuracy" value={test.avg_accuracy} />
        <Metric label="Score" value={test.avg_score} />
      </div>
      <p className="text-xs font-bold uppercase tracking-wide text-accent mt-3">
        Open report &rarr;
      </p>
    </Card>
  );
}
