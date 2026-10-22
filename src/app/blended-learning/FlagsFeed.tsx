import Link from "next/link";

import type { FlagCard, FlagsPage } from "@/lib/blended-learning-flags";
import type { FlagRecipient } from "@/lib/blended-learning-mentee-detail";

import { ConversationNotes } from "./students/[id]/ConversationNotes";
import { FLAG_RECIPIENT } from "./students/[id]/flagRecipients";

// The admin Flags tab: a read-only feed of every Mentor Flag, newest first,
// filtered by Mentor and Flag Recipient through the URL. Flags raised since
// the viewer's previous visit are marked New.

export type FlagsView = {
  page: FlagsPage;
  mentors: { mentorUserId: number; name: string }[];
  mentorUserId: number | null;
  recipient: FlagRecipient | null;
  cursor: number | null;
};

const linkClass =
  "inline-flex min-h-11 items-center text-sm font-bold text-accent underline-offset-2 hover:text-accent-hover hover:underline";
const selectClass =
  "min-h-11 w-full rounded-lg border border-border bg-bg-input px-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function feedHref(view: FlagsView, cursor: number | null): string {
  const params = new URLSearchParams({ tab: "flags" });
  if (view.mentorUserId !== null) params.set("mentor", String(view.mentorUserId));
  if (view.recipient) params.set("recipient", view.recipient);
  if (cursor !== null) params.set("cursor", String(cursor));
  return `/blended-learning?${params}`;
}

function Filters({ view }: { view: FlagsView }) {
  return (
    <form
      role="search"
      aria-label="Filter flags"
      action="/blended-learning"
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
    >
      <input type="hidden" name="tab" value="flags" />
      <label className="block space-y-1 text-sm font-bold text-text-secondary">
        <span>Mentor</span>
        <select name="mentor" defaultValue={view.mentorUserId ?? ""} className={selectClass}>
          <option value="">All Mentors</option>
          {view.mentors.map((mentor) => (
            <option key={mentor.mentorUserId} value={mentor.mentorUserId}>
              {mentor.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-bold text-text-secondary">
        <span>Flag Recipient</span>
        <select name="recipient" defaultValue={view.recipient ?? ""} className={selectClass}>
          <option value="">All recipients</option>
          {(Object.keys(FLAG_RECIPIENT) as FlagRecipient[]).map((recipient) => (
            <option key={recipient} value={recipient}>
              {FLAG_RECIPIENT[recipient]}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="min-h-11 rounded-lg border border-border bg-bg-card px-4 text-sm font-bold text-text-primary shadow-sm hover:border-accent"
      >
        Apply
      </button>
    </form>
  );
}

function FlagCardView({ flag }: { flag: FlagCard }) {
  const meta = [flag.grade === null ? null : `Grade ${flag.grade}`, flag.programName, flag.gender].filter(Boolean);
  return (
    <article
      className={`space-y-2 rounded-lg border bg-bg-card p-4 shadow-sm ${
        flag.isNew ? "border-l-4 border-accent" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 break-words font-bold text-text-primary">
          <Link href={`/blended-learning/students/${flag.studentId}`} className="hover:text-accent hover:underline">
            {flag.name}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {flag.isNew && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-bold text-text-on-accent">New</span>
          )}
          <span className="rounded-lg bg-danger-bg px-2.5 py-1 text-xs font-bold text-danger">
            {FLAG_RECIPIENT[flag.recipient]}
          </span>
        </div>
      </div>
      {meta.length > 0 && <p className="text-sm text-text-secondary">{meta.join(" · ")}</p>}
      <p className="text-sm text-text-secondary">
        {formatDate(flag.occurredOn)} · {flag.mentorName}
      </p>
      {flag.comment && (
        <p className="whitespace-pre-line break-words border-l-2 border-danger pl-3 text-sm text-text-primary">
          {flag.comment}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-6">
        {flag.phone ? (
          <a href={`tel:${flag.phone}`} className={`${linkClass} font-mono`}>
            {flag.phone}
          </a>
        ) : (
          <span className="text-sm text-text-muted">No contact number</span>
        )}
        {flag.whatsappPhone && <span className="font-mono text-sm text-text-secondary">WhatsApp {flag.whatsappPhone}</span>}
        {flag.profileDocUrl && (
          <a href={flag.profileDocUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Profile Doc
          </a>
        )}
        {flag.screenerUrl && (
          <a href={flag.screenerUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
            Screener Link
          </a>
        )}
      </div>
      {flag.hasNotes && <ConversationNotes conversationId={flag.conversationId} />}
    </article>
  );
}

export function FlagsFeed({ view }: { view: FlagsView }) {
  const { flags, nextCursor } = view.page;
  const filtered = view.mentorUserId !== null || view.recipient !== null;
  return (
    <section aria-label="Mentor Flags" className="space-y-4">
      <Filters view={view} />
      {flags.length === 0 ? (
        <p className="rounded-lg border border-border bg-bg-card p-4 text-sm text-text-secondary shadow-sm sm:p-6">
          {filtered ? "No Mentor Flags match these filters." : "No Mentor Flags yet."}
        </p>
      ) : (
        <ol className="space-y-3">
          {flags.map((flag) => (
            <li key={flag.id}>
              <FlagCardView flag={flag} />
            </li>
          ))}
        </ol>
      )}
      {(view.cursor !== null || nextCursor !== null) && (
        <nav aria-label="Flag pages" className="flex flex-wrap justify-between gap-3">
          {view.cursor !== null ? <Link href={feedHref(view, null)} className={linkClass}>Newest flags</Link> : <span />}
          {nextCursor !== null && (
            <Link href={feedHref(view, nextCursor)} className={linkClass}>
              Older flags
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}
