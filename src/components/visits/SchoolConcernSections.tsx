import Link from "next/link";
import type { ReactNode } from "react";

import { Badge, Card } from "@/components/ui";
import { ConcernActions } from "@/components/visits/ConcernActions";
import type {
  ConcernCard,
  ConcernHistoryEntry,
  SchoolConcernPage,
  VisitNoteItem,
  VisitNotes,
} from "@/lib/visit-concerns";
import {
  RECURRING_CONCERN_MIN_VISITS,
  formatCompactVisitDates,
  formatIstDate,
  formatIstTimestamp,
  formatVisitCount,
} from "@/lib/visit-summary";

// The School page's concern sections (#470), in order: Needs attention and Going well side by side
// (stacked on mobile), the Intervention flags section (`flags`, when the viewer may see it),
// Resolved concerns, and Visit-wise notes (one collapsible row per Visit). Every text is stored
// text and renders as text. `today` decides the compact dates' year rule. `canAct` (visits edit,
// the rule the events API enforces) adds Resolve on open concerns and Comment / Reopen on resolved
// ones.

const EVENT_LABELS: Record<Exclude<ConcernHistoryEntry["kind"], "auto_reopened">, { label: string; className: string }> = {
  resolved: { label: "Resolved", className: "text-success" },
  reopened: { label: "Reopened", className: "text-danger" },
  comment: { label: "Comment", className: "text-text-secondary" },
};

// Two columns on desktop, Needs attention the wider; the flags section sits under its column.
const COLUMNS = "grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]";

function authorOf(entry: ConcernHistoryEntry): string {
  return entry.authorName ?? entry.authorEmail ?? "Unknown";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// The IST date, with the full IST time on hover.
function EventDate({ at }: { at: Date }) {
  return (
    <time dateTime={new Date(at).toISOString()} title={formatIstTimestamp(at)}>
      {formatIstDate(at)}
    </time>
  );
}

function HistoryList({ history }: { history: ConcernHistoryEntry[] }) {
  return (
    <ol className="mt-3 space-y-2">
      {history.map((entry, index) => (
        <li key={index} className="rounded-md bg-bg-card/70 px-3 py-2 text-sm">
          <p className="text-xs text-text-muted">
            {entry.kind === "auto_reopened" ? (
              <span className="font-bold text-danger">
                Reopened automatically: raised again in visit of {entry.visitDate ? formatIstDate(entry.visitDate) : "an unknown date"}
              </span>
            ) : (
              <>
                <span className={`font-bold ${EVENT_LABELS[entry.kind].className}`}>{EVENT_LABELS[entry.kind].label}</span>
                {` · ${authorOf(entry)}`}
              </>
            )}
            {" · "}
            <EventDate at={entry.at} />
          </p>
          {entry.body && <p className="mt-0.5 whitespace-pre-wrap text-text-primary">{entry.body}</p>}
        </li>
      ))}
    </ol>
  );
}

// Section heading with its count on the right. `tone` colours the heading.
function SectionHeading({
  id,
  title,
  count,
  tone = "text-text-primary",
}: {
  id: string;
  title: string;
  count?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 id={id} className={`text-sm font-bold uppercase tracking-wider ${tone}`}>
        {title}
      </h2>
      {count !== undefined && <span className="text-sm text-text-muted">{count}</span>}
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text-muted">{children}</p>;
}

function OpenConcernCard({ card, today, canAct }: { card: ConcernCard; today: Date; canAct: boolean }) {
  const body = (
    <>
      <p className="font-bold text-text-primary">{card.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-secondary">
        {card.visitCount >= RECURRING_CONCERN_MIN_VISITS && (
          <span className="font-bold text-danger">{`Recurring · ${formatVisitCount(card.visitCount)}`}</span>
        )}
        <span>{formatCompactVisitDates(card.visitDates, today)}</span>
        {card.reopened && <Badge variant="warning">reopened</Badge>}
      </div>
      {card.history.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-bold uppercase text-accent">
            History ({card.history.length})
          </summary>
          <HistoryList history={card.history} />
        </details>
      )}
    </>
  );
  return (
    <article className="rounded-lg border border-l-4 border-border border-l-text-muted/30 bg-bg-card p-4 shadow-sm">
      {canAct ? <ConcernActions concernId={card.id} status="open">{body}</ConcernActions> : body}
    </article>
  );
}

function NeedsAttention({ cards, today, canAct }: { cards: ConcernCard[]; today: Date; canAct: boolean }) {
  return (
    <section aria-labelledby="needs-attention-heading" className="min-w-0 space-y-3">
      <SectionHeading id="needs-attention-heading" title="Needs attention" count={`${cards.length} open`} tone="text-danger" />
      {cards.length === 0 ? (
        <Card elevation="sm" className="p-4">
          <EmptyState>No open concerns in view</EmptyState>
        </Card>
      ) : (
        cards.map((card) => <OpenConcernCard key={card.id} card={card} today={today} canAct={canAct} />)
      )}
    </section>
  );
}

function GoingWell({ cards, today }: { cards: ConcernCard[]; today: Date }) {
  return (
    <section aria-labelledby="going-well-heading" className="min-w-0 space-y-3">
      <SectionHeading id="going-well-heading" title="Going well" tone="text-success" />
      <Card elevation="sm" className="px-4 py-1">
        {cards.length === 0 ? (
          <div className="py-3">
            <EmptyState>No highlights in view</EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {cards.map((card) => (
              <li key={card.id} className="flex gap-3 py-3">
                <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-success" />
                <div className="min-w-0">
                  <p className="text-text-primary">{card.text}</p>
                  <p className="mt-0.5 text-sm text-text-muted">{formatCompactVisitDates(card.visitDates, today)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}

function latestResolution(card: ConcernCard): ConcernHistoryEntry | undefined {
  return card.history.filter((entry) => entry.kind === "resolved").at(-1);
}

function ResolvedConcernCard({ card, canAct }: { card: ConcernCard; canAct: boolean }) {
  const resolution = latestResolution(card);
  const body = (
    <>
      <p className="font-medium text-text-secondary">{card.text}</p>
      {resolution && (
        <p className="mt-1 text-sm text-text-muted">
          Resolved by {authorOf(resolution)} · <EventDate at={resolution.at} />
        </p>
      )}
      <HistoryList history={card.history} />
    </>
  );
  return (
    <article className="rounded-md border-l-4 border-l-success bg-bg-card-alt p-4">
      {canAct ? <ConcernActions concernId={card.id} status="resolved">{body}</ConcernActions> : body}
    </article>
  );
}

function ResolvedConcerns({ cards, canAct }: { cards: ConcernCard[]; canAct: boolean }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="resolved-heading" className="space-y-3">
        <SectionHeading id="resolved-heading" title="Resolved concerns" count={String(cards.length)} />
        {cards.length === 0 ? (
          <EmptyState>No resolved concerns in view</EmptyState>
        ) : (
          cards.map((card) => <ResolvedConcernCard key={card.id} card={card} canAct={canAct} />)
        )}
      </section>
    </Card>
  );
}

function NoteItems({ title, items }: { title: string; items: VisitNoteItem[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase text-text-muted">{title}</p>
      <ul className="list-disc pl-5 text-sm text-text-primary">
        {items.map((item) => (
          <li key={item.id}>
            {item.text}
            {item.status === "resolved" && <span className="text-text-muted"> (resolved)</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function VisitNotesRow({ visit, backHref }: { visit: VisitNotes; backHref?: string }) {
  const empty = visit.concerns.length === 0 && visit.highlights.length === 0;
  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-1 py-3 [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="inline-block w-3 text-sm text-text-secondary transition-transform group-open:rotate-90">
            ▸
          </span>
          <span className="font-bold text-text-primary">{formatIstDate(visit.visitDate)}</span>
          <span className="text-text-secondary">{visit.pmName ?? visit.pmEmail}</span>
          <span className="text-text-muted">
            · {plural(visit.concerns.length, "concern")} · {plural(visit.highlights.length, "highlight")}
          </span>
          {visit.status !== "completed" && <Badge variant="info">In progress</Badge>}
        </summary>
        <div className="space-y-2 pb-3 pl-5">
          {empty ? (
            <EmptyState>No concerns or highlights</EmptyState>
          ) : (
            <>
              <NoteItems title="Concerns" items={visit.concerns} />
              <NoteItems title="Going well" items={visit.highlights} />
            </>
          )}
          <Link
            href={`/school-visit-summary/${visit.visitId}${backHref ? `?${new URLSearchParams({ back: backHref })}` : ""}`}
            className="inline-block text-sm font-bold text-accent hover:text-accent-hover"
          >
            Open visit details →
          </Link>
        </div>
      </details>
    </li>
  );
}

function VisitWiseNotes({ visits, backHref }: { visits: VisitNotes[]; backHref?: string }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="visit-notes-heading">
        <SectionHeading id="visit-notes-heading" title="Visit-wise notes" count={plural(visits.length, "visit")} />
        {visits.length === 0 ? (
          <div className="mt-3">
            <EmptyState>No visits in view</EmptyState>
          </div>
        ) : (
          <ul className="mt-1 divide-y divide-border">
            {visits.map((visit) => <VisitNotesRow key={visit.visitId} visit={visit} backHref={backHref} />)}
          </ul>
        )}
      </section>
    </Card>
  );
}

export function SchoolConcernSections({
  page,
  today,
  canAct,
  flags,
  visitBackHref,
}: {
  page: SchoolConcernPage;
  today: Date;
  canAct: boolean;
  flags?: ReactNode;
  // Where a Visit-wise note's detail page goes Back to (this School page with its filters).
  visitBackHref?: string;
}) {
  return (
    <>
      <div className={COLUMNS}>
        <NeedsAttention cards={page.needsAttention} today={today} canAct={canAct} />
        <GoingWell cards={page.goingWell} today={today} />
      </div>
      {flags && (
        <div className={COLUMNS}>
          <div className="min-w-0">{flags}</div>
        </div>
      )}
      <ResolvedConcerns cards={page.resolved} canAct={canAct} />
      <VisitWiseNotes visits={page.visitNotes} backHref={visitBackHref} />
    </>
  );
}
