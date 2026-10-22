import { getServerSession } from "next-auth";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Card } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { canBlendedLearning, getBlendedLearningAccess } from "@/lib/blended-learning-access";
import { getMenteeDetail, type HistoryEntry } from "@/lib/blended-learning-mentee-detail";
import { getTodayIST } from "@/lib/curriculum-date-helpers";

import { BlendedLearningHeader } from "../../../BlendedLearningHeader";
import { LogEntryForm } from "./LogEntryForm";

// Log a Conversation or an Attempt for one Mentee. A Mentor logs for their
// own Mentees; a Blended Learning Admin logs on the mapped Mentor's behalf.
// Read-only users are sent back to the detail page.

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

function LastConversationPanel({ conversation }: { conversation: Extract<HistoryEntry, { kind: "conversation" }> | null }) {
  return (
    <section aria-label="Last Conversation">
      <Card elevation="sm" className="space-y-2 p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Last Conversation</h3>
        {conversation ? (
          <>
            <p className="text-sm font-bold text-text-primary">{formatDate(conversation.occurredOn)}</p>
            <p className="text-xs text-text-secondary">
              {[MODE[conversation.mode], SPOKE_WITH[conversation.spokeWith], `${conversation.durationMinutes} min`].join(
                " · "
              )}
            </p>
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
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const access = await getBlendedLearningAccess(email);
  if (!access || !canBlendedLearning(access, "view_student")) redirect("/dashboard");

  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  if (!canBlendedLearning(access, "log")) redirect(`/blended-learning/students/${id}`);

  const mentee = await getMenteeDetail(access, Number(id));
  if (!mentee) notFound();

  const lastConversation =
    mentee.history.find((entry): entry is Extract<HistoryEntry, { kind: "conversation" }> => entry.kind === "conversation") ??
    null;
  const firstName = mentee.name.split(" ")[0] || mentee.name;

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
        <h2 className="break-words text-xl font-bold text-text-primary">Log for {mentee.name}</h2>
        <LogEntryForm
          studentId={mentee.studentId}
          name={mentee.name}
          firstName={firstName}
          today={getTodayIST()}
          forOwnList={access.kind === "mentor"}
          lastConversationPanel={<LastConversationPanel conversation={lastConversation} />}
          openActionItems={mentee.openActionItems}
          hasOpenDraft={mentee.openDraft !== null}
        />
      </main>
    </>
  );
}
