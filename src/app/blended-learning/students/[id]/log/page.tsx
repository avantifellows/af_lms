import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { canBlendedLearning, type BlendedLearningAccess } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage, requireNumericPageId } from "@/lib/blended-learning-guard";
import { draftNotesToHtml } from "@/lib/blended-learning-draft-notes";
import { getDraftForReview, getDraftStatus, type DraftForReview } from "@/lib/blended-learning-drafts";
import { describeSession, formatCalendarDate } from "@/lib/blended-learning-format";
import { getMenteeDetail, type HistoryEntry, type MenteeDetail } from "@/lib/blended-learning-mentee-detail";
import { listMentees } from "@/lib/blended-learning-mentees";
import { menteeGroup, type MenteeGroup } from "@/lib/blended-learning-talk-to-first";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

import { BlendedLearningHeader } from "../../../BlendedLearningHeader";
import { LogEntryForm, type ReviewDraft } from "./LogEntryForm";

// Log a Conversation or an Attempt for one Mentee. Only a Mentor logs, for
// their own Mentees; Blended Learning Admins (view only) and read-only users
// are sent back to the detail page. A Mentee with a ready
// Conversation Draft gets the same form, prefilled from the draft for review.
// While a draft is being drafted (or has failed) the form stays, with the
// draft's progress in place of the recording upload; once it is ready the page
// refreshes and the form opens again, prefilled.

// The form's prefill: the drafted notes become editor HTML. The Summary Tags
// are not used.
function toReviewDraft(draft: DraftForReview): ReviewDraft {
  return {
    id: draft.id,
    occurredOn: draft.occurredOn,
    mode: draft.mode,
    spokeWith: draft.spokeWith,
    durationMinutes: draft.durationMinutes,
    summary: draft.summary,
    actionItems: draft.actionItems.map(({ owner, text }) => ({ owner, text })),
    notesHtml: draftNotesToHtml(draft.notes),
  };
}

// The open draft as the form takes it: a ready one prefilled for review,
// anything else pending with its retry offer.
async function loadOpenDraft(access: BlendedLearningAccess, mentee: MenteeDetail) {
  const open = mentee.openDraft;
  if (!open) return { draft: null, pendingDraft: null };
  if (open.state === "ready") {
    const ready = await getDraftForReview(access, mentee.studentId);
    return { draft: ready ? toReviewDraft(ready) : null, pendingDraft: null };
  }
  const status = await getDraftStatus(access, open.id);
  return { draft: null, pendingDraft: { id: open.id, state: open.state, retryOffered: status?.retryOffered ?? false } };
}

// The Mentee's group on the Mentor's Student list as the form opens, from
// the list's own read; null when the list has no row for them.
async function currentListGroup(
  access: BlendedLearningAccess,
  studentId: number,
  today: string
): Promise<MenteeGroup | null> {
  const list = await listMentees({ access, studentId, today });
  const row = [...list.talkToFirst, ...list.everyoneElse][0];
  return row ? menteeGroup(row.reasons) : null;
}

function LastConversationPanel({ conversation }: { conversation: Extract<HistoryEntry, { kind: "conversation" }> | null }) {
  return (
    <section aria-label="Last Conversation">
      <Card elevation="sm" className="space-y-2 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Last Conversation</h3>
        {conversation ? (
          <>
            <p className="text-sm font-bold text-text-primary">{formatCalendarDate(conversation.occurredOn)}</p>
            <p className="text-xs text-text-secondary">{describeSession(conversation)}</p>
            <p className="whitespace-pre-line break-words text-sm text-text-primary">{conversation.summary}</p>
          </>
        ) : (
          <p className="text-sm text-text-secondary">No earlier Conversation. This will be the first one.</p>
        )}
      </Card>
    </section>
  );
}

export default async function LogEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const access = await requireBlendedLearningPage("view_student");
  const id = await requireNumericPageId(params);
  if (!canBlendedLearning(access, "log")) redirect(`/blended-learning/students/${id}`);

  const mentee = await getMenteeDetail(access, Number(id));
  if (!mentee) notFound();

  const lastConversation =
    mentee.history.find((entry): entry is Extract<HistoryEntry, { kind: "conversation" }> => entry.kind === "conversation") ??
    null;
  const firstName = mentee.name.split(" ")[0] || mentee.name;
  const subtitle = [mentee.name, mentee.grade !== null ? `Grade ${mentee.grade}` : null, mentee.programName]
    .filter(Boolean)
    .join(" · ");
  const today = getTodayIST();
  const [{ draft, pendingDraft }, listGroup] = await Promise.all([
    loadOpenDraft(access, mentee),
    currentListGroup(access, mentee.studentId, today),
  ]);

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href={`/blended-learning/students/${mentee.studentId}`}
          className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-bold text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {`Back to ${mentee.name}`}
        </Link>
        {/* A new key once the draft is ready, so the form opens prefilled. */}
        <LogEntryForm
          key={draft ? `review-${draft.id}` : "entry"}
          studentId={mentee.studentId}
          name={mentee.name}
          firstName={firstName}
          subtitle={subtitle}
          today={today}
          listGroup={listGroup}
          lastConversationPanel={<LastConversationPanel conversation={lastConversation} />}
          openActionItems={mentee.openActionItems}
          hasOpenDraft={mentee.openDraft !== null}
          draft={draft}
          pendingDraft={pendingDraft}
          canManageDraft={canBlendedLearning(access, "manage_draft")}
        />
      </main>
    </>
  );
}
