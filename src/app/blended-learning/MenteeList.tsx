import Link from "next/link";

import { Badge } from "@/components/ui";
import type { MenteeRow } from "@/lib/blended-learning-mentees";
import type { TalkToFirstReason } from "@/lib/blended-learning-talk-to-first";

// The Mentor's Mentee list: Talk to First, then Everyone else. A table from
// 640 px up; cards below that, each one a 44 px+ tap target. A ready
// Conversation Draft's chip opens it for review on the log page, for viewers
// who can log; for a read-only viewer it is a plain label.

const WHY_NOW: Record<TalkToFirstReason, string> = {
  attempt: "Last try didn't connect",
  no_contact: "Never reached",
  gap_30: "30+ days",
};

function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function daysAgo(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function LastContact({ mentee }: { mentee: MenteeRow }) {
  if (mentee.lastContact === null) {
    return <span className="text-text-muted">No contact yet</span>;
  }
  if (mentee.lastContactSource === "legacy") {
    return <span>{`${formatDate(mentee.lastContact, { month: "short", year: "numeric" })} · before app`}</span>;
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span>{formatDate(mentee.lastContact, { day: "numeric", month: "short", year: "numeric" })}</span>
      {mentee.daysSince !== null && (
        <span className="text-xs text-text-muted">{daysAgo(mentee.daysSince)}</span>
      )}
    </span>
  );
}

export function WhyNowTags({ mentee }: { mentee: MenteeRow }) {
  if (mentee.reasons.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {mentee.reasons.map((reason) => (
        <Badge key={reason} variant="warning">
          {WHY_NOW[reason]}
        </Badge>
      ))}
    </span>
  );
}

function DraftChip({ mentee, canLog, className = "" }: { mentee: MenteeRow; canLog: boolean; className?: string }) {
  if (mentee.openDraftState !== "ready") return null;
  if (!canLog) {
    return (
      <span className={`inline-flex items-center ${className}`}>
        <Badge variant="accent">Draft ready to review</Badge>
      </span>
    );
  }
  return (
    <Link href={`${menteeHref(mentee)}/log`} className={`inline-flex min-h-11 items-center ${className}`}>
      <Badge variant="accent">Draft ready to review</Badge>
    </Link>
  );
}

function menteeHref(mentee: MenteeRow) {
  return `/blended-learning/students/${mentee.studentId}`;
}

function MenteeMeta({ mentee }: { mentee: MenteeRow }) {
  const parts = [
    mentee.grade === null ? null : `Grade ${mentee.grade}`,
    mentee.programName,
    mentee.gender,
  ].filter((part): part is string => Boolean(part));
  return (
    <span className="flex flex-wrap gap-x-1.5 text-xs text-text-secondary">
      {parts.map((part, index) => (
        <span key={part} className="flex gap-x-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>{part}</span>
        </span>
      ))}
    </span>
  );
}

function MenteeTable({ mentees, canLog }: { mentees: MenteeRow[]; canLog: boolean }) {
  return (
    <table className="hidden w-full text-left text-sm sm:table">
      <thead className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
        <tr>
          <th scope="col" className="px-4 py-2 font-semibold">Mentee</th>
          <th scope="col" className="px-4 py-2 font-semibold">Grade</th>
          <th scope="col" className="px-4 py-2 font-semibold">Program</th>
          <th scope="col" className="px-4 py-2 font-semibold">Last Contact</th>
          <th scope="col" className="px-4 py-2 font-semibold">Why now</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {mentees.map((mentee) => (
          <tr key={mentee.studentId} className="align-top hover:bg-hover-bg">
            <td className="px-4 py-2">
              <Link
                href={menteeHref(mentee)}
                className="inline-flex min-h-11 items-center font-semibold text-text-primary hover:text-accent"
              >
                {mentee.name}
              </Link>
              <div className="flex flex-wrap items-center gap-2 pb-1">
                {mentee.gender && <span className="text-xs text-text-secondary">{mentee.gender}</span>}
                <DraftChip mentee={mentee} canLog={canLog} />
              </div>
            </td>
            <td className="px-4 py-3">{mentee.grade === null ? "—" : `Grade ${mentee.grade}`}</td>
            <td className="px-4 py-3">{mentee.programName ?? "—"}</td>
            <td className="px-4 py-3">
              <LastContact mentee={mentee} />
            </td>
            <td className="px-4 py-3">
              <WhyNowTags mentee={mentee} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MenteeCards({ mentees, canLog }: { mentees: MenteeRow[]; canLog: boolean }) {
  return (
    <ul className="divide-y divide-border sm:hidden">
      {mentees.map((mentee) => (
        <li key={mentee.studentId}>
          <Link
            href={menteeHref(mentee)}
            className="flex min-h-11 flex-col gap-1.5 px-4 py-3 hover:bg-hover-bg active:bg-hover-bg"
          >
            <span className="font-semibold text-text-primary">{mentee.name}</span>
            <MenteeMeta mentee={mentee} />
            <span className="text-sm text-text-primary">
              <LastContact mentee={mentee} />
            </span>
            <WhyNowTags mentee={mentee} />
          </Link>
          {/* Outside the card's link: links can't nest. */}
          <DraftChip mentee={mentee} canLog={canLog} className="-mt-2 px-4 pb-1" />
        </li>
      ))}
    </ul>
  );
}

export function MenteeGroup({
  title,
  description,
  mentees,
  emptyText,
  canLog,
}: {
  title: string;
  description: string;
  mentees: MenteeRow[];
  emptyText: string;
  canLog: boolean;
}) {
  return (
    <section aria-label={title} className="overflow-hidden rounded-lg border border-border bg-bg-card shadow-sm">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-bold text-text-primary">
          <span>{title}</span>
          <Badge>{mentees.length}</Badge>
        </h2>
        <p className="mt-0.5 text-xs text-text-muted">{description}</p>
      </div>
      {mentees.length === 0 ? (
        <p className="px-4 py-6 text-sm text-text-muted">{emptyText}</p>
      ) : (
        <>
          <MenteeTable mentees={mentees} canLog={canLog} />
          <MenteeCards mentees={mentees} canLog={canLog} />
        </>
      )}
    </section>
  );
}
