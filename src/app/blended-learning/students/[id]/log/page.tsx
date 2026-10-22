import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { canBlendedLearning } from "@/lib/blended-learning-access";
import { requireBlendedLearningPage, requireNumericPageId } from "@/lib/blended-learning-guard";
import { draftNotesToHtml } from "@/lib/blended-learning-draft-notes";
import { getDraftForReview, getDraftStatus, type DraftForReview } from "@/lib/blended-learning-drafts";
import { describeSession, formatCalendarDate } from "@/lib/blended-learning-format";
import { getMenteeDetail, type HistoryEntry } from "@/lib/blended-learning-mentee-detail";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

import { BlendedLearningHeader } from "../../../BlendedLearningHeader";
import { LogEntryForm, type ReviewDraft } from "./LogEntryForm";

// Log a Conversation or an Attempt for one Mentee. A Mentor logs for their
// own Mentees; a Blended Learning Admin logs on the mapped Mentor's behalf.
// Read-only users are sent back to the detail page. A Mentee with a ready
// Conversation Draft gets the same form, prefilled from the draft for review.
// While a draft is being drafted (or has failed) the form stays, with the
// draft's progress in place of the recording upload; once it is ready the page
// refreshes and the form opens again, prefilled.

// The form's prefill: the Summary Tags follow the drafted summary as text,
// and the drafted notes become editor HTML.
function toReviewDraft(draft: DraftForReview): ReviewDraft {
  const tags = draft.summaryTags.length > 0 ? `\n\nTags: ${draft.summaryTags.join(", ")}` : "";
  return {
    id: draft.id,
    occurredOn: draft.occurredOn,
    mode: draft.mode,
    spokeWith: draft.spokeWith,
    durationMinutes: draft.durationMinutes,
    summary: `${draft.summary}${tags}`,
    actionItems: draft.actionItems.map(({ owner, text }) => ({ owner, text })),
    notesHtml: draftNotesToHtml(draft.notes),
  };
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
          <p className="text-sm text-text-secondary">No Conversations yet.</p>
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
  const draft = mentee.openDraft?.state === "ready" ? await getDraftForReview(access, mentee.studentId) : null;
  const openDraft = mentee.openDraft;
  const pendingDraft =
    openDraft && openDraft.state !== "ready" ? { id: openDraft.id, state: openDraft.state } : null;
  const pendingStatus = pendingDraft ? await getDraftStatus(access, pendingDraft.id) : null;

  return (
    <>
      <BlendedLearningHeader access={access} />
      <main className="mx-auto max-w-5xl space-y-4 px-4 py-4 sm:px-6 sm:py-6">
        <Link
          href={`/blended-learning/students/${mentee.studentId}`}
          className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-bold text-text-secondary hover:text-text-primary"
        >
          <span aria-hidden="true">←</span> {mentee.name}
        </Link>
        <h2 className="break-words text-xl font-bold text-text-primary">
          {draft ? `Review the draft for ${mentee.name}` : `Log for ${mentee.name}`}
        </h2>
        {/* A new key once the draft is ready, so the form opens prefilled. */}
        <LogEntryForm
          key={draft ? `review-${draft.id}` : "entry"}
          studentId={mentee.studentId}
          name={mentee.name}
          firstName={firstName}
          today={getTodayIST()}
          forOwnList={access.kind === "mentor"}
          lastConversationPanel={<LastConversationPanel conversation={lastConversation} />}
          openActionItems={mentee.openActionItems}
          hasOpenDraft={mentee.openDraft !== null}
          draft={draft ? toReviewDraft(draft) : null}
          pendingDraft={
            pendingDraft
              ? { id: pendingDraft.id, state: pendingDraft.state, retryOffered: pendingStatus?.retryOffered ?? false }
              : null
          }
          canManageDraft={canBlendedLearning(access, "manage_draft")}
        />
      </main>
    </>
  );
}
