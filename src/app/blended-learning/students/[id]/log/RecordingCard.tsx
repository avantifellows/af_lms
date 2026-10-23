"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { DraftStatus } from "../DraftStatus";
import { FormCard } from "./formParts";
import { durationMinutes, type EntryFormValues } from "./logEntryPayload";
import type { ChangeValues } from "./SessionDetailsCard";
import { RecordingFileRow } from "./RecordingFileRow";
import { RecordingUpload } from "./RecordingUpload";

// The Recording card. A Conversation's Call Recording is uploaded here; a
// draft being drafted, or one that failed, shows its progress and controls
// instead, and once it is ready the page refreshes to open it. While a ready
// draft is reviewed, its recording shows as drafted. A picked recording's
// length fills in Duration when the Mentor hasn't typed one.

// An open Conversation Draft that is not ready yet: being drafted, or failed.
export type PendingDraft = { id: number; state: "transcribing" | "failed"; retryOffered: boolean };

// The log page checks a draft being drafted this often.
const PENDING_DRAFT_POLL_MS = 5_000;

function PendingDraftStatus({ pendingDraft, canManageDraft }: { pendingDraft: PendingDraft; canManageDraft: boolean }) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  return (
    <DraftStatus
      key={pendingDraft.id}
      draftId={pendingDraft.id}
      initialState={pendingDraft.state}
      initialRetryOffered={pendingDraft.retryOffered}
      canManage={canManageDraft}
      pollMs={PENDING_DRAFT_POLL_MS}
      onReady={refresh}
      framed={false}
      drafting="Writing the summary, action items and notes from the recording. They fill in below when ready, usually within a couple of minutes. You can leave this page and come back."
    />
  );
}

function RecordingSlot({
  studentId,
  firstName,
  reviewing,
  hasOpenDraft,
  pendingDraft,
  canManageDraft,
  values,
  change,
}: {
  studentId: number;
  firstName: string;
  reviewing: boolean;
  hasOpenDraft: boolean;
  pendingDraft: PendingDraft | null;
  canManageDraft: boolean;
  values: EntryFormValues;
  change: ChangeValues;
}) {
  if (reviewing) return <RecordingFileRow name="Call recording" tone="done" status="Drafted. Check and edit below" />;
  if (pendingDraft) return <PendingDraftStatus pendingDraft={pendingDraft} canManageDraft={canManageDraft} />;
  if (hasOpenDraft) {
    return (
      <p className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary">
        {`${firstName} already has a Conversation Draft, so no recording can be uploaded now.`}
      </p>
    );
  }
  return (
    <RecordingUpload
      studentId={studentId}
      sessionDetails={{
        occurredOn: values.occurredOn || null,
        mode: values.mode,
        spokeWith: values.spokeWith,
        durationMinutes: durationMinutes(values.duration),
      }}
      onDuration={(minutes) => change(({ duration }) => (duration.trim() === "" ? { duration: String(minutes) } : {}))}
    />
  );
}

export function RecordingCard(props: Parameters<typeof RecordingSlot>[0]) {
  return (
    <FormCard title="Recording">
      <RecordingSlot {...props} />
    </FormCard>
  );
}
