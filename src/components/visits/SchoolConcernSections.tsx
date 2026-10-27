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

// The School page's concern sections (#470): Needs attention, Going well, Resolved concerns
// (collapsed) and Visit-wise notes (collapsible). Every text is stored text and renders as text.
// `today` decides the compact dates' year rule. `canAct` (visits edit, the rule the events API
// enforces) adds Resolve on open concerns and Comment / Reopen on resolved ones. `flags` (the
// Intervention flags section, when the viewer may see it) sits between Needs attention and Going well.

const EVENT_LABELS: Record<Exclude<ConcernHistoryEntry["kind"], "auto_reopened">, string> = {
  resolved: "Resolved",
  reopened: "Reopened",
  comment: "Comment",
};

function authorOf(entry: ConcernHistoryEntry): string {
  return entry.authorName ?? entry.authorEmail ?? "Unknown";
}

function HistoryList({ history }: { history: ConcernHistoryEntry[] }) {
  return (
    <ol className="mt-2 space-y-2 border-l-2 border-border pl-3">
      {history.map((entry, index) => (
        <li key={index} className="text-sm">
          <p className="text-xs text-text-muted">
            {entry.kind === "auto_reopened" ? (
              <>
                <span className="font-bold text-text-secondary">
                  Reopened automatically: raised again in visit of {entry.visitDate ? formatIstDate(entry.visitDate) : "an unknown date"}
                </span>
                {" · "}
                {formatIstTimestamp(entry.at)}
              </>
            ) : (
              <>
                <span className="font-bold text-text-secondary">{EVENT_LABELS[entry.kind]}</span>
                {` · ${authorOf(entry)} · ${formatIstTimestamp(entry.at)}`}
              </>
            )}
          </p>
          {entry.body && <p className="whitespace-pre-wrap text-text-primary">{entry.body}</p>}
        </li>
      ))}
    </ol>
  );
}

function ConcernCardView({
  card,
  today,
  countLabel,
  children,
}: {
  card: ConcernCard;
  today: Date;
  countLabel: string;
  children?: ReactNode;
}) {
  return (
    <article className="border border-border bg-bg-card p-3">
      <p className="text-sm font-medium text-text-primary">{card.text}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
        <span className="font-bold">{countLabel}</span>
        <span>{formatCompactVisitDates(card.visitDates, today)}</span>
        {card.reopened && <Badge variant="warning">reopened</Badge>}
      </div>
      {children}
    </article>
  );
}

function SectionHeading({ id, title, count }: { id: string; title: string; count: number }) {
  return (
    <span className="flex items-baseline gap-2">
      <h2 id={id} className="text-xs font-bold uppercase tracking-wider text-text-muted">
        {title}
      </h2>
      <span className="text-xs text-text-muted">{count}</span>
    </span>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text-muted">{children}</p>;
}

function NeedsAttention({ cards, today, canAct }: { cards: ConcernCard[]; today: Date; canAct: boolean }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="needs-attention-heading" className="space-y-3">
        <SectionHeading id="needs-attention-heading" title="Needs attention" count={cards.length} />
        {cards.length === 0 ? (
          <EmptyState>No open concerns in view</EmptyState>
        ) : (
          cards.map((card) => (
            <ConcernCardView
              key={card.id}
              card={card}
              today={today}
              countLabel={card.visitCount >= RECURRING_CONCERN_MIN_VISITS ? `Recurring · ${formatVisitCount(card.visitCount)}` : formatVisitCount(card.visitCount)}
            >
              {card.history.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs font-bold uppercase text-accent">
                    History ({card.history.length})
                  </summary>
                  <HistoryList history={card.history} />
                </details>
              )}
              {canAct && <ConcernActions concernId={card.id} status="open" />}
            </ConcernCardView>
          ))
        )}
      </section>
    </Card>
  );
}

function GoingWell({ cards, today }: { cards: ConcernCard[]; today: Date }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="going-well-heading" className="space-y-3">
        <SectionHeading id="going-well-heading" title="Going well" count={cards.length} />
        {cards.length === 0 ? (
          <EmptyState>No highlights in view</EmptyState>
        ) : (
          cards.map((card) => (
            <ConcernCardView key={card.id} card={card} today={today} countLabel={formatVisitCount(card.visitCount)} />
          ))
        )}
      </section>
    </Card>
  );
}

function latestResolution(card: ConcernCard): ConcernHistoryEntry | undefined {
  return card.history.filter((entry) => entry.kind === "resolved").at(-1);
}

function ResolvedConcerns({ cards, today, canAct }: { cards: ConcernCard[]; today: Date; canAct: boolean }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="resolved-heading">
        <details>
          <summary className="cursor-pointer">
            <SectionHeading id="resolved-heading" title="Resolved concerns" count={cards.length} />
          </summary>
          <div className="mt-3 space-y-3">
            {cards.length === 0 ? (
              <EmptyState>No resolved concerns in view</EmptyState>
            ) : (
              cards.map((card) => {
                const resolution = latestResolution(card);
                return (
                  <ConcernCardView key={card.id} card={card} today={today} countLabel={formatVisitCount(card.visitCount)}>
                    {resolution && (
                      <p className="mt-1 text-xs text-text-secondary">
                        Resolved by {authorOf(resolution)} on {formatIstTimestamp(resolution.at)}
                      </p>
                    )}
                    <HistoryList history={card.history} />
                    {canAct && <ConcernActions concernId={card.id} status="resolved" />}
                  </ConcernCardView>
                );
              })
            )}
          </div>
        </details>
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

function VisitNotesEntry({ visit, backHref }: { visit: VisitNotes; backHref?: string }) {
  const empty = visit.concerns.length === 0 && visit.highlights.length === 0;
  return (
    <article className="border border-border bg-bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/school-visit-summary/${visit.visitId}${backHref ? `?${new URLSearchParams({ back: backHref })}` : ""}`}
          className="text-sm font-bold text-accent hover:text-accent-hover"
        >
          {formatIstDate(visit.visitDate)} · {visit.pmName ?? visit.pmEmail}
        </Link>
        {visit.status !== "completed" && <Badge variant="info">In progress</Badge>}
      </div>
      <div className="mt-2 space-y-2">
        {empty ? (
          <EmptyState>No concerns or highlights</EmptyState>
        ) : (
          <>
            <NoteItems title="Concerns" items={visit.concerns} />
            <NoteItems title="Going well" items={visit.highlights} />
          </>
        )}
      </div>
    </article>
  );
}

function VisitWiseNotes({ visits, backHref }: { visits: VisitNotes[]; backHref?: string }) {
  return (
    <Card elevation="sm" className="p-4">
      <section aria-labelledby="visit-notes-heading">
        <details open>
          <summary className="cursor-pointer">
            <SectionHeading id="visit-notes-heading" title="Visit-wise notes" count={visits.length} />
          </summary>
          <div className="mt-3 space-y-3">
            {visits.length === 0 ? (
              <EmptyState>No visits in view</EmptyState>
            ) : (
              visits.map((visit) => <VisitNotesEntry key={visit.visitId} visit={visit} backHref={backHref} />)
            )}
          </div>
        </details>
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
      <NeedsAttention cards={page.needsAttention} today={today} canAct={canAct} />
      {flags}
      <GoingWell cards={page.goingWell} today={today} />
      <ResolvedConcerns cards={page.resolved} today={today} canAct={canAct} />
      <VisitWiseNotes visits={page.visitNotes} backHref={visitBackHref} />
    </>
  );
}
