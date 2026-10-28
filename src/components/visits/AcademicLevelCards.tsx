import Link from "next/link";

import { AL_DISPLAY_ORDER, alShortLabel } from "@/lib/academic-level";
import type { AcademicLevelCard, AcademicLevelCards as AcademicLevelCardsData } from "@/lib/visit-summary-school";

// The School page's academic-level cards (#470): one compact card per physical Centre × grade ×
// JEE/NEET, all on one line, each opening that Centre's cumulative report for the grade in the
// same tab. The body is one Now row of level cells (the exam's three levels always, any other
// level the data has, then NA); the largest level is red. Predictions are a later follow-up.

const NA_REASON = "No AL-bearing test yet";
// The cards count every current-year student; the cumulative report lists tested students only.
const CARD_HOVER =
  `NA: ${NA_REASON.toLowerCase()}. ` +
  "The total can be higher than the cumulative report's student count by the students shown as NA.";

// The levels every card of an exam shows, even at 0.
const EXAM_LEVELS: Record<AcademicLevelCard["exam"], string[]> = {
  JEE: ["M1", "M2", "M3"],
  NEET: ["B1", "B2", "B3"],
};

function cumulativeReportHref(card: AcademicLevelCard): string {
  return `/centre/${card.centreId}?tab=performance&grade=${card.grade}&view=cumulative`;
}

function formatStudents(count: number): string {
  return `${count} ${count === 1 ? "student" : "students"}`;
}

function levelRank(level: string): number {
  const index = AL_DISPLAY_ORDER.indexOf(level);
  return index === -1 ? AL_DISPLAY_ORDER.length : index;
}

// The exam's levels (0 when absent) plus any other level the data has, best first.
function nowCells(card: AcademicLevelCard): { level: string; students: number }[] {
  const counts = new Map<string, number>(EXAM_LEVELS[card.exam].map((level) => [level, 0]));
  for (const entry of card.levels) counts.set(entry.level, entry.students);
  return [...counts.entries()]
    .map(([level, students]) => ({ level, students }))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level));
}

function Cell({ label, count, largest, title }: { label: string; count: number; largest?: boolean; title?: string }) {
  return (
    <div title={title} data-largest={largest || undefined} className="flex items-baseline gap-1.5 border-l border-border px-1.5">
      <dt className={`font-mono text-xs ${largest ? "text-danger" : "text-text-muted"}`}>{label}</dt>
      <dd className={`font-mono text-sm font-bold ${largest ? "text-danger" : "text-text-primary"}`}>{count}</dd>
    </div>
  );
}

function LevelCard({ card }: { card: AcademicLevelCard }) {
  const cells = nowCells(card);
  const largest = Math.max(0, ...cells.map((cell) => cell.students));
  return (
    <Link
      href={cumulativeReportHref(card)}
      title={`${card.centreName}. ${CARD_HOVER}`}
      className="group block h-full rounded-lg border border-border bg-bg-card px-3 py-2.5 hover:border-accent"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold uppercase leading-none text-text-on-accent">
          {card.tag}
        </span>
        <span className="whitespace-nowrap text-sm font-bold text-text-primary group-hover:text-accent">
          G{card.grade} {card.exam} <span aria-hidden className="text-xs text-text-muted">↗</span>
        </span>
        <span className="ml-auto whitespace-nowrap text-xs text-text-muted">{formatStudents(card.total)}</span>
      </div>
      <div className="mt-2 flex items-baseline">
        <span className="pr-1 text-[11px] font-bold uppercase tracking-wide text-text-muted">Now</span>
        <dl className="flex flex-wrap items-baseline gap-y-1">
          {cells.map((cell) => (
            <Cell
              key={cell.level}
              label={alShortLabel(cell.level)}
              count={cell.students}
              largest={largest > 0 && cell.students === largest}
            />
          ))}
          <Cell label="NA" count={card.na} title={NA_REASON} />
        </dl>
      </div>
    </Link>
  );
}

export function AcademicLevelCards({ data }: { data: AcademicLevelCardsData }) {
  return (
    <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
      <h2 id="academic-level-heading" className="pt-1 text-xs font-bold uppercase tracking-wider text-text-muted">
        Academic level
      </h2>
      {!data.available ? (
        <p className="text-sm text-text-muted">Academic levels unavailable</p>
      ) : data.cards.length === 0 ? (
        <p className="text-sm text-text-muted">No JEE or NEET students at this School&apos;s physical centres</p>
      ) : (
        // One line from `sm`: equal columns that share the row (a card's cells wrap inside it); past
        // what fits at 11rem each, the row scrolls sideways instead of wrapping.
        <ul
          aria-labelledby="academic-level-heading"
          className="grid gap-2 overflow-x-auto pb-1 sm:auto-cols-[minmax(11rem,1fr)] sm:grid-flow-col"
        >
          {data.cards.map((card) => (
            <li key={`${card.centreId}:${card.grade}:${card.exam}`} className="min-w-0">
              <LevelCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
