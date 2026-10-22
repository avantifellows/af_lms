"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card } from "@/components/ui";
import type { DraftState } from "@/lib/blended-learning-drafts";

// The Mentee's open Conversation Draft. While etl-next is drafting, the page
// polls the draft's state (every 15 seconds unless told otherwise) and shows a
// spinner; a ready or failed draft does not change by itself, so polling stops
// there. The log page passes `onReady` to open the ready draft in place. A draft that is no longer open
// (discarded or saved elsewhere) disappears.
// Those who can manage drafts (not read-only) can retry a failed draft or one
// whose wake never reached ETL, and discard any open draft. Those who can log
// open a ready draft for review.

const DRAFT_POLL_MS = 15_000;

// The drafting badge uses `warning`: `info`'s light blue text was nearly
// unreadable on its fill.
const DRAFT_STATE: Partial<Record<DraftState, { label: string; variant: "warning" | "accent" | "danger" }>> = {
  transcribing: { label: "Drafting from the Call Recording", variant: "warning" },
  ready: { label: "Draft ready to review", variant: "accent" },
  failed: { label: "Drafting failed", variant: "danger" },
};

type DraftStatusBody = { state: DraftState; retryOffered: boolean };
type DraftAction = "retry" | "discard";

// The draft's state and retry offer, polled while etl-next is drafting;
// `onReady` is called once a draft that wasn't ready turns ready.
function usePolledDraft(draftId: number, initial: DraftStatusBody, pollMs: number, onReady?: () => void) {
  const [status, setStatus] = useState<DraftStatusBody>(initial);
  const initialState = initial.state;

  useEffect(() => {
    if (status.state === "ready" && initialState !== "ready") onReady?.();
  }, [status.state, initialState, onReady]);
  // Bumped after every poll, so the next one is scheduled even when the state
  // hasn't changed.
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (status.state !== "transcribing") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/blended-learning/drafts/${draftId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as DraftStatusBody;
        if (!cancelled) setStatus({ state: json.state, retryOffered: json.retryOffered });
      } catch {
        // Keep the last known state and try again on the next poll.
      }
      if (!cancelled) setPolls((count) => count + 1);
    }, pollMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draftId, status.state, polls, pollMs]);

  return [status, setStatus] as const;
}

// Retry or discard the draft: its new status, or the error to show.
async function postDraftAction(
  draftId: number,
  action: DraftAction
): Promise<{ draft: DraftStatusBody } | { error: string }> {
  try {
    const res = await fetch(`/api/blended-learning/drafts/${draftId}/${action}`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) return { draft: json as DraftStatusBody };
    return { error: typeof json.error === "string" ? json.error : "Something went wrong. Try again." };
  } catch {
    return { error: "Couldn't reach the server. Try again." };
  }
}

function DraftActions({
  state,
  reviewHref,
  showRetry,
  canManage,
  busy,
  onRetry,
  onDiscard,
}: {
  state: DraftState;
  // Set only when a ready draft can be opened for review.
  reviewHref: string | null;
  showRetry: boolean;
  canManage: boolean;
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  if (!canManage && reviewHref === null) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {reviewHref !== null && (
        <Link
          href={reviewHref}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-text-on-accent shadow-sm hover:bg-accent-hover sm:w-auto"
        >
          Review draft
        </Link>
      )}
      {showRetry && (
        <Button type="button" onClick={onRetry} disabled={busy} className="w-full sm:w-auto">
          {state === "failed" ? "Retry" : "Retry drafting"}
        </Button>
      )}
      {canManage && (
        <Button type="button" variant="secondary" onClick={onDiscard} disabled={busy} className="w-full sm:w-auto">
          Discard
        </Button>
      )}
    </div>
  );
}

// The title and state badge; while drafting, a spinner and what is happening.
function DraftHeading({ state, drafting }: { state: DraftState; drafting: string | null }) {
  const shown = DRAFT_STATE[state];
  const inProgress = state === "transcribing";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold text-text-primary">Conversation Draft</span>
        {shown && (
          <Badge variant={shown.variant} className="gap-2">
            {inProgress && (
              <span
                aria-hidden="true"
                className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-warning-text border-t-transparent motion-reduce:animate-none"
              />
            )}
            <span>{shown.label}</span>
          </Badge>
        )}
      </div>
      {inProgress && drafting && (
        <p role="status" className="text-sm text-text-secondary">
          {drafting}
        </p>
      )}
    </>
  );
}

// The detail page shows the draft as its own Card; the log page sets
// `framed={false}` because it already sits inside the Recording card.
function DraftFrame({ framed, children }: { framed: boolean; children: ReactNode }) {
  if (!framed) return <div className="space-y-3">{children}</div>;
  return (
    <Card elevation="sm" className="space-y-3 p-4 sm:px-6">
      {children}
    </Card>
  );
}

export function DraftStatus({
  draftId,
  initialState,
  initialRetryOffered = false,
  canManage = false,
  reviewHref = null,
  pollMs = DRAFT_POLL_MS,
  onReady,
  drafting = null,
  framed = true,
}: {
  draftId: number;
  initialState: DraftState;
  initialRetryOffered?: boolean;
  canManage?: boolean;
  // The log page that reviews a ready draft, for those who can log.
  reviewHref?: string | null;
  pollMs?: number;
  // Called once the polled draft turns ready.
  onReady?: () => void;
  // What to say while drafting, under the badge.
  drafting?: string | null;
  // False to drop the Card, when the caller already frames the draft.
  framed?: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = usePolledDraft(
    draftId,
    { state: initialState, retryOffered: initialRetryOffered },
    pollMs,
    onReady
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(action: DraftAction): Promise<DraftStatusBody | null> {
    setBusy(true);
    setError(null);
    setMessage(null);
    const result = await postDraftAction(draftId, action);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return null;
    }
    return result.draft;
  }

  async function retry() {
    const draft = await send("retry");
    if (!draft) return;
    setStatus({ state: draft.state, retryOffered: draft.retryOffered });
    if (draft.state === "transcribing") setMessage("Asked to draft it again.");
  }

  async function discard() {
    if (!window.confirm("Discard this Conversation Draft? The recording won't be drafted.")) return;
    const draft = await send("discard");
    if (!draft) return;
    setStatus((current) => ({ ...current, state: draft.state }));
    router.refresh();
  }

  const shown = DRAFT_STATE[status.state];
  if (!shown) return null;
  return (
    <section aria-label="Conversation Draft">
      <DraftFrame framed={framed}>
        <DraftHeading state={status.state} drafting={drafting} />
        <DraftActions
          state={status.state}
          reviewHref={status.state === "ready" ? reviewHref : null}
          showRetry={canManage && status.retryOffered}
          canManage={canManage}
          busy={busy}
          onRetry={retry}
          onDiscard={discard}
        />
        {message && (
          <p role="status" className="text-sm text-text-secondary">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </DraftFrame>
    </section>
  );
}
