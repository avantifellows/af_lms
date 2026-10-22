import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ArrowUpRight, ClipboardList, FileText, type LucideIcon } from "lucide-react";

import { Badge, Card } from "@/components/ui";
import { canBlendedLearning, type BlendedLearningAccess } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage, requireNumericPageId } from "@/lib/blended-learning-guard";
import { getDraftStatus } from "@/lib/blended-learning-drafts";
import { describeSession, formatCalendarDate } from "@/lib/blended-learning-format";
import {
  getMenteeDetail,
  type ActionItem,
  type HistoryEntry,
  type MenteeDetail,
  type MentorFlag,
} from "@/lib/blended-learning-mentee-detail";
import { loadDashboardChrome } from "@/lib/dashboard-chrome";

import { BlendedPageShell } from "../../BlendedPageShell";
import { ActionItemMeta, OwnerPill } from "./ActionItemMeta";
import { ConversationNotes } from "./ConversationNotes";
import { ConversationPhotos } from "./ConversationPhotos";
import { ConversationRecording } from "./ConversationRecording";
import { DraftStatus } from "./DraftStatus";
import { FLAG_HISTORY } from "./flagRecipients";

// One Mentee: name, profile line, contact, links, any open Conversation Draft
// (polled while drafting) and the newest-first history, laid out as in the
// mockup. Notes and photos load on demand from their API routes.
// Only a Mentor who can log (not read-only) gets the entry point to the log
// page and the draft's Retry and Discard controls; admins are view only. Open Action Items are listed for
// everyone, and ticked done only from there. Only Blended Learning Admins
// (read-only too) can play a saved Call Recording or read its transcript.

type Conversation = Extract<HistoryEntry, { kind: "conversation" }>;

function profileMeta(mentee: MenteeDetail): string[] {
  return [mentee.grade === null ? null : `Grade ${mentee.grade}`, mentee.programName, mentee.gender].filter(
    (part): part is string => Boolean(part)
  );
}

function MetaLine({ parts }: { parts: string[] }) {
  if (parts.length === 0) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-x-1.5 text-sm text-text-secondary sm:text-base">
      {parts.map((part, index) => (
        <span key={part} className="flex gap-x-1.5">
          {index > 0 && <span aria-hidden="true">·</span>}
          <span>{part}</span>
        </span>
      ))}
    </p>
  );
}

// The Student's own numbers, as a smaller line under the profile line.
function ContactLine({ phone, whatsappPhone }: { phone: string | null; whatsappPhone: string | null }) {
  return (
    <section aria-label="Contact" className="flex flex-wrap items-center gap-x-4 text-sm text-text-secondary">
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="inline-flex min-h-11 items-center font-mono text-text-primary underline-offset-4 hover:text-accent hover:underline sm:min-h-8"
        >
          {phone}
        </a>
      ) : (
        <p className="py-1.5">No contact number</p>
      )}
      {whatsappPhone && <p className="font-mono">WhatsApp {whatsappPhone}</p>}
    </section>
  );
}

function ExternalLink({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${children} (opens in a new tab)`}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-primary underline underline-offset-4 hover:text-accent"
    >
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
      {children}
      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
    </a>
  );
}

function ProfileLinks({ mentee }: { mentee: MenteeDetail }) {
  if (!mentee.profileDocUrl && !mentee.screenerUrl) return null;
  return (
    <div className="flex flex-wrap gap-x-6">
      {mentee.profileDocUrl && (
        <ExternalLink href={mentee.profileDocUrl} icon={FileText}>
          Profile doc
        </ExternalLink>
      )}
      {mentee.screenerUrl && (
        <ExternalLink href={mentee.screenerUrl} icon={ClipboardList}>
          Screener form
        </ExternalLink>
      )}
    </div>
  );
}

// The page heading: name, profile line, contact and links, with the way to
// log beside it (below it on a phone).
function Profile({ mentee, canLog }: { mentee: MenteeDetail; canLog: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="break-words text-2xl font-bold text-text-primary sm:text-3xl">{mentee.name}</h1>
        <MetaLine parts={profileMeta(mentee)} />
        <ContactLine phone={mentee.phone} whatsappPhone={mentee.whatsappPhone} />
        <ProfileLinks mentee={mentee} />
      </div>
      {canLog && (
        <Link
          href={`/blended-learning/students/${mentee.studentId}/log`}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover"
        >
          Log conversation
        </Link>
      )}
    </div>
  );
}

// A labelled block inside a history entry: SUMMARY, ACTION ITEMS and so on.
function EntrySection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-bold uppercase tracking-wide text-text-secondary">{label}</h4>
      {children}
    </div>
  );
}

function EntryHeader({ date, meta, chips }: { date: string; meta: string; chips: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h3 className="text-base font-bold text-text-primary sm:text-lg">{formatCalendarDate(date)}</h3>
        <p className="text-sm text-text-secondary">{meta}</p>
      </div>
      {chips}
    </header>
  );
}

function FlagChips({ flags }: { flags: MentorFlag[] }) {
  if (flags.length === 0) return null;
  return (
    <ul aria-label="Mentor Flags" className="flex flex-wrap gap-1.5">
      {flags.map((flag) => (
        <li key={flag.recipient}>
          <Badge variant={flag.recipient === "emotional_wellbeing" ? "danger" : "warning"}>
            {FLAG_HISTORY[flag.recipient].chip}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ActionItemRow({ item }: { item: ActionItem }) {
  const done = item.status === "done";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-2.5 gap-y-0.5 text-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <OwnerPill owner={item.owner} />
      <span className={`break-words ${done ? "text-text-muted line-through" : "text-text-primary"}`}>{item.text}</span>
      <span className={`col-start-2 text-xs font-bold sm:col-start-auto ${done ? "text-success" : "text-accent"}`}>
        {done ? "Done" : "Open"}
      </span>
    </li>
  );
}

function ActionItems({ items }: { items: ActionItem[] }) {
  return (
    <EntrySection label="Action items">
      {items.length === 0 ? (
        <p className="text-sm text-text-secondary">None agreed.</p>
      ) : (
        <ul aria-label="Action Items" className="space-y-2">
          {items.map((item) => (
            <ActionItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </EntrySection>
  );
}

// Each flag's comment, under "Flag note for …". Flags without one show only
// their header chip.
function FlagNotes({ flags }: { flags: MentorFlag[] }) {
  return flags
    .filter((flag) => flag.comment)
    .map((flag) => (
      <EntrySection key={flag.recipient} label={FLAG_HISTORY[flag.recipient].noteLabel}>
        <p className="whitespace-pre-line break-words text-sm text-text-primary">{flag.comment}</p>
      </EntrySection>
    ));
}

function ConversationMedia({ entry, canPlayRecording }: { entry: Conversation; canPlayRecording: boolean }) {
  return (
    <>
      {entry.hasNotes && <ConversationNotes conversationId={entry.id} />}
      {canPlayRecording && (entry.hasRecording || entry.hasTranscript) && (
        <ConversationRecording
          conversationId={entry.id}
          hasRecording={entry.hasRecording}
          hasTranscript={entry.hasTranscript}
        />
      )}
    </>
  );
}

function ConversationEntry({ entry, canPlayRecording }: { entry: Conversation; canPlayRecording: boolean }) {
  return (
    <>
      <EntryHeader date={entry.occurredOn} meta={describeSession(entry)} chips={<FlagChips flags={entry.flags} />} />
      <div className="mt-4 space-y-4">
        <EntrySection label="Summary">
          <p className="whitespace-pre-line break-words text-sm text-text-primary">{entry.summary}</p>
        </EntrySection>
        <ActionItems items={entry.actionItems} />
        {entry.photoCount > 0 && (
          <EntrySection label="Photos">
            <ConversationPhotos conversationId={entry.id} count={entry.photoCount} />
          </EntrySection>
        )}
        <FlagNotes flags={entry.flags} />
      </div>
      <div className="mt-2">
        <ConversationMedia entry={entry} canPlayRecording={canPlayRecording} />
      </div>
    </>
  );
}

function AttemptEntry({ entry }: { entry: Extract<HistoryEntry, { kind: "attempt" }> }) {
  return (
    <>
      <EntryHeader date={entry.occurredOn} meta="Attempt" chips={<Badge variant="danger">Not reachable</Badge>} />
      {entry.note && <p className="mt-2 break-words text-sm text-text-primary">{entry.note}</p>}
    </>
  );
}

function OpenActionItems({ items }: { items: MenteeDetail["openActionItems"] }) {
  return (
    <section aria-label="Open Action Items">
      <Card elevation="sm" className="space-y-3 p-4 sm:px-6">
        <h2 className="text-xs font-bold uppercase tracking-wide text-text-secondary">Open action items</h2>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-baseline gap-2.5 text-sm text-text-primary">
              <OwnerPill owner={item.owner} />
              <span className="min-w-0 break-words">
                {item.text}
                <ActionItemMeta agreedOn={item.agreedOn} />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function EmptyHistory({ canLog }: { canLog: boolean }) {
  return (
    <Card elevation="sm" className="p-6 text-center sm:p-8">
      <p className="text-sm font-bold text-text-primary">No conversations yet</p>
      {canLog && <p className="mt-1 text-sm text-text-secondary">Log the first one to start this student&apos;s history.</p>}
    </Card>
  );
}

function History({
  history,
  canPlayRecording,
  canLog,
}: {
  history: HistoryEntry[];
  canPlayRecording: boolean;
  canLog: boolean;
}) {
  const conversations = history.filter((entry) => entry.kind === "conversation").length;
  return (
    <section aria-label="History" className="space-y-3">
      <h2 className="text-lg font-bold text-text-primary sm:text-xl">Conversations ({conversations})</h2>
      {history.length === 0 ? (
        <EmptyHistory canLog={canLog} />
      ) : (
        <ol className="space-y-3">
          {history.map((entry) => (
            <li key={entry.id}>
              <article className="rounded-lg border border-border bg-bg-card p-4 shadow-sm sm:p-6">
                {entry.kind === "attempt" ? (
                  <AttemptEntry entry={entry} />
                ) : (
                  <ConversationEntry entry={entry} canPlayRecording={canPlayRecording} />
                )}
              </article>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Where an admin came from, passed on the link as `?from=`; only known
// origins count. Without one, an admin came from the Mentor's list.
const BACK_ORIGINS = ["flags"] as const;
type BackOrigin = (typeof BACK_ORIGINS)[number];

function backOrigin(from: string | string[] | undefined): BackOrigin | null {
  const value = Array.isArray(from) ? from[0] : from;
  return BACK_ORIGINS.find((origin) => origin === value) ?? null;
}

// A Mentor goes back to their own list; an admin to the Flags tab when they
// came from it, else to the Student's Mentor's list.
function backLink(access: BlendedLearningAccess, mentee: MenteeDetail, from: BackOrigin | null) {
  if (access.kind === "mentor") return { href: "/blended-learning", label: "Back to students" };
  if (from === "flags") return { href: "/blended-learning?tab=flags", label: "Back to flags" };
  return {
    href: `/blended-learning/mentors/${mentee.mentor.userId}`,
    label: `Back to ${mentee.mentor.firstName}'s students`,
  };
}

export default async function MenteeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string | string[] }>;
}) {
  const access = await requireBlendedLearningPage("view_student");
  const mentee = await getMenteeDetail(access, Number(await requireNumericPageId(params)));
  if (!mentee) notFound();
  const [draftStatus, chrome, query] = await Promise.all([
    mentee.openDraft ? getDraftStatus(access, mentee.openDraft.id) : null,
    loadDashboardChrome(access),
    searchParams,
  ]);
  const canLog = canBlendedLearning(access, "log");
  const back = backLink(access, mentee, backOrigin(query?.from));

  return (
    <BlendedPageShell access={access} chrome={chrome} width="max-w-3xl" wideHeader={false} className="space-y-6">
      <Link
        href={back.href}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded text-sm font-bold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        <span aria-hidden="true">←</span> {back.label}
      </Link>
      <Profile mentee={mentee} canLog={canLog} />
      {mentee.openDraft && (
        <DraftStatus
          key={mentee.openDraft.id}
          draftId={mentee.openDraft.id}
          initialState={mentee.openDraft.state}
          initialRetryOffered={draftStatus?.retryOffered ?? false}
          canManage={canBlendedLearning(access, "manage_draft")}
          reviewHref={canLog ? `/blended-learning/students/${mentee.studentId}/log` : null}
        />
      )}
      {mentee.openActionItems.length > 0 && <OpenActionItems items={mentee.openActionItems} />}
      <History
        history={mentee.history}
        canPlayRecording={canBlendedLearning(access, "play_recording")}
        canLog={canLog}
      />
    </BlendedPageShell>
  );
}
