import Link from "next/link";

import type { MentorCard } from "@/lib/blended-learning-mentees";

// The admin Mentors tab: one card per Mentor showing load and recency. Cards
// stack at 360 px and each one opens that Mentor's Mentee list.

function Stat({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "warning" }) {
  const valueClass = tone === "warning" && value > 0 ? "text-warning-text" : "text-text-primary";
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className={`text-lg font-bold ${valueClass}`}>{value}</dd>
    </div>
  );
}

export function MentorCards({ cards }: { cards: MentorCard[] }) {
  if (cards.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-bg-card p-4 text-sm text-text-secondary shadow-sm sm:p-6">
        No Mentors have Mentees mapped this year.
      </p>
    );
  }
  return (
    <ul aria-label="Mentors" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <li key={card.mentorUserId}>
          <Link
            href={`/blended-learning/mentors/${card.mentorUserId}`}
            className="block h-full min-h-11 rounded-lg border border-border bg-bg-card p-4 shadow-sm hover:border-accent hover:shadow-md"
          >
            <h3 className="font-bold text-text-primary">{card.name}</h3>
            <dl className="mt-3 grid grid-cols-3 gap-x-3">
              <Stat label="Assigned" value={card.assigned} />
              <Stat label="Grade 12" value={card.grade12} />
              <Stat label="Grade 13" value={card.grade13} />
            </dl>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 border-t border-border pt-2">
              <Stat label="Talked in last 7 days" value={card.talkedLast7} />
              <Stat label="Not spoken 30+ days" value={card.notSpoken30Plus} tone="warning" />
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}
