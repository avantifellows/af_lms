import Link from "next/link";

import { alShortLabel } from "@/lib/academic-level";
import type { AcademicLevelCard, AcademicLevelCards as AcademicLevelCardsData } from "@/lib/visit-summary-school";

// The School page's academic-level cards (#470): one per physical Centre × grade × JEE/NEET,
// each opening that Centre's cumulative report for the grade in the same tab.

const NA_REASON = "No AL-bearing test yet";
// The cards count every current-year student; the cumulative report lists tested students only.
const CARD_HOVER =
  `NA: ${NA_REASON.toLowerCase()}. ` +
  "The total can be higher than the cumulative report's student count by the students shown as NA.";

function cumulativeReportHref(card: AcademicLevelCard): string {
  return `/centre/${card.centreId}?tab=performance&grade=${card.grade}&view=cumulative`;
}

function formatStudents(count: number): string {
  return `${count} ${count === 1 ? "student" : "students"}`;
}

function LevelCard({ card }: { card: AcademicLevelCard }) {
  return (
    <Link
      href={cumulativeReportHref(card)}
      title={`${card.centreName}. ${CARD_HOVER}`}
      className="block h-full border border-border bg-bg-card-alt p-3 hover:border-accent"
    >
      <p className="text-sm font-bold text-text-primary">
        {card.tag} · Grade {card.grade} · {card.exam}
      </p>
      <p className="text-xs text-text-muted">{formatStudents(card.total)}</p>
      <p className="mt-2 text-sm text-text-primary">
        <span className="mr-2 text-xs font-bold uppercase text-text-muted">Now</span>
        {card.levels.length === 0
          ? <span className="text-text-muted">—</span>
          : card.levels.map((entry, index) => (
              <span key={entry.level}>
                {index > 0 && " · "}
                <span>{`${alShortLabel(entry.level)} ${entry.students}`}</span>
              </span>
            ))}
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        <span title={NA_REASON}>{`NA ${card.na}`}</span>
      </p>
    </Link>
  );
}

export function AcademicLevelCards({ data }: { data: AcademicLevelCardsData }) {
  return (
    <div>
      <h2 id="academic-levels-heading" className="text-xs font-bold uppercase tracking-wider text-text-muted">
        Academic levels
      </h2>
      {!data.available ? (
        <p className="mt-1 text-sm text-text-muted">Academic levels unavailable</p>
      ) : data.cards.length === 0 ? (
        <p className="mt-1 text-sm text-text-muted">No JEE or NEET students at this School&apos;s physical centres</p>
      ) : (
        <ul aria-labelledby="academic-levels-heading" className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.cards.map((card) => (
            <li key={`${card.centreId}:${card.grade}:${card.exam}`}>
              <LevelCard card={card} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
