import { getServerSession } from "next-auth";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Badge, Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getDraftStatus } from "@/lib/blended-learning-drafts";
import {
  getMenteeDetail,
  type HistoryEntry,
  type MenteeDetail,
} from "@/lib/blended-learning-mentee-detail";

import { BlendedLearningHeader } from "../../BlendedLearningHeader";
import { ActionItemMeta } from "./ActionItemMeta";
import { ConversationNotes } from "./ConversationNotes";
import { ConversationPhotos } from "./ConversationPhotos";
import { DraftStatus } from "./DraftStatus";
import { FLAG_RECIPIENT } from "./flagRecipients";

// One Mentee: profile, contact, links, any open Conversation Draft (polled
// while drafting) and the newest-first history. Notes and photos load on
// demand from their API routes.
// Users who can log (not read-only) get the entry point to the log page and
// the draft's Retry and Discard controls; Open Action Items are listed for
// everyone, and ticked done only from there.

const MODE: Record<"call" | "in_person", string> = { call: "Call", in_person: "In person" };
const SPOKE_WITH: Record<"student" | "parent_or_sibling" | "both", string> = {
  student: "Student",
  parent_or_sibling: "Parent or sibling",
  both: "Student and parent",
};

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day))
  );
}

function Profile({ mentee }: { mentee: MenteeDetail }) {
  const meta = [mentee.grade === null ? null : `Grade ${mentee.grade}`, mentee.programName, mentee.gender].filter(
    (part): part is string => Boolean(part)
  );
  const linkClass =
    "flex min-h-11 items-center text-sm font-bold text-accent hover:text-accent-hover underline-offset-2 hover:underline";
  return (
    <Card elevation="sm" className="space-y-4 p-4 sm:p-6">
      <div className="min-w-0">
        <h2 className="break-words text-xl font-bold text-text-primary">{mentee.name}</h2>
        <p className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-text-secondary">
          {meta.map((part, index) => (
            <span key={part} className="flex gap-x-1.5">
              {index > 0 && <span aria-hidden="true">·</span>}
              <span>{part}</span>
            </span>
          ))}
        </p>
      </div>
      <section aria-label="Contact" className="space-y-1">
        {mentee.phone ? (
          <a href={`tel:${mentee.phone}`} className={`${linkClass} font-mono`}>
            {mentee.phone}
          </a>
        ) : (
          <p className="text-sm text-text-muted">No contact number</p>
        )}
        {mentee.whatsappPhone && (
          <p className="font-mono text-sm text-text-secondary">WhatsApp {mentee.whatsappPhone}</p>
        )}
      </section>
      {(mentee.profileDocUrl || mentee.screenerUrl) && (
        <div className="flex flex-wrap gap-x-6">
          {mentee.profileDocUrl && (
            <a href={mentee.profileDocUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Profile Doc
            </a>
          )}
          {mentee.screenerUrl && (
            <a href={mentee.screenerUrl} target="_blank" rel="noopener noreferrer" className={linkClass}>
              Screener Link
            </a>
          )}
        </div>
      )}
    </Card>
  );
}

function ConversationEntry({ entry }: { entry: Extract<HistoryEntry, { kind: "conversation" }> }) {
  return (
    <>
      <p className="text-xs text-text-secondary">
        {[MODE[entry.mode], SPOKE_WITH[entry.spokeWith], `${entry.durationMinutes} min`].join(" · ")}
      </p>
      <p className="whitespace-pre-line break-words text-sm text-text-primary">{entry.summary}</p>
      {entry.actionItems.length > 0 && (
        <ul aria-label="Action Items" className="space-y-1.5">
          {entry.actionItems.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="min-w-0 break-words">
                <span className={item.status === "done" ? "text-text-muted line-through" : ""}>{item.text}</span>
                <ActionItemMeta owner={item.owner} dueOn={item.dueOn} />
              </span>
              <Badge variant={item.status === "done" ? "success" : "warning"} className="shrink-0">
                {item.status === "done" ? "Done" : "Open"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {entry.flags.length > 0 && (
        <ul aria-label="Mentor Flags" className="flex flex-wrap gap-2">
          {entry.flags.map((flag) => (
            <li
              key={flag.recipient}
              className="max-w-full rounded-lg bg-danger-bg px-2.5 py-1 text-xs text-danger break-words"
            >
              <span className="font-bold">{FLAG_RECIPIENT[flag.recipient]}</span>
              {flag.comment && <span className="text-text-primary"> · {flag.comment}</span>}
            </li>
          ))}
        </ul>
      )}
      {entry.photoCount > 0 && <ConversationPhotos conversationId={entry.id} count={entry.photoCount} />}
      {entry.hasNotes && <ConversationNotes conversationId={entry.id} />}
    </>
  );
}

function OpenActionItems({ items }: { items: MenteeDetail["openActionItems"] }) {
  return (
    <section aria-label="Open Action Items">
      <Card elevation="sm" className="space-y-2 p-4 sm:px-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-text-secondary">Open Action Items</h3>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="break-words text-sm text-text-primary">
              {item.text}
              <ActionItemMeta owner={item.owner} dueOn={item.dueOn} agreedOn={item.agreedOn} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function History({ history }: { history: HistoryEntry[] }) {
  return (
    <section aria-label="History" className="space-y-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-text-secondary">History</h3>
      {history.length === 0 ? (
        <Card elevation="sm" className="p-4 sm:p-6">
          <p className="text-sm text-text-secondary">No Conversations or Attempts yet.</p>
        </Card>
      ) : (
        <ol className="space-y-3">
          {history.map((entry) => (
            <li key={entry.id}>
              <article className="space-y-2 rounded-lg border border-border bg-bg-card p-4 shadow-sm sm:px-6">
                <header className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold text-text-primary">{formatDate(entry.occurredOn)}</span>
                  <Badge variant={entry.kind === "attempt" ? "warning" : "default"}>
                    {entry.kind === "attempt" ? "Attempt" : "Conversation"}
                  </Badge>
                </header>
                {entry.kind === "attempt" ? (
                  <p className="break-words text-sm text-text-secondary">{entry.note ?? "No note"}</p>
                ) : (
                  <ConversationEntry entry={entry} />
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default async function MenteeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const access = await getBlendedLearningAccess(email);
  if (!access || !canBlendedLearning(access, "view_student")) redirect("/dashboard");

  const { id } = await params;
  const mentee = /^\d+$/.test(id) ? await getMenteeDetail(access, Number(id)) : null;
  if (!mentee) notFound();
  const draftStatus = mentee.openDraft ? await getDraftStatus(access, mentee.openDraft.id) : null;

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href="/blended-learning"
          className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden="true">←</span> Mentees
        </Link>
        <Profile mentee={mentee} />
        {canBlendedLearning(access, "log") && (
          <Link
            href={`/blended-learning/students/${mentee.studentId}/log`}
            className="flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover sm:inline-flex sm:w-auto"
          >
            Log a Conversation or Attempt
          </Link>
        )}
        {mentee.openDraft && (
          <DraftStatus
            key={mentee.openDraft.id}
            draftId={mentee.openDraft.id}
            initialState={mentee.openDraft.state}
            initialRetryOffered={draftStatus?.retryOffered ?? false}
            canManage={canBlendedLearning(access, "manage_draft")}
          />
        )}
        {mentee.openActionItems.length > 0 && <OpenActionItems items={mentee.openActionItems} />}
        <History history={mentee.history} />
      </main>
    </>
  );
}
