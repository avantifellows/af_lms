"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card } from "@/components/ui";
import type { DraftState } from "@/lib/blended-learning-drafts";

// The Mentee's open Conversation Draft. While etl-next is drafting, the page
// polls the draft's state every 15 seconds; a ready or failed draft does not
// change by itself, so polling stops there. A draft that is no longer open
// (discarded or saved elsewhere) disappears.
// Those who can manage drafts (not read-only) can retry a failed draft or one
// whose wake never reached ETL, and discard any open draft.

const DRAFT_POLL_MS = 15_000;

const DRAFT_STATE: Partial<Record<DraftState, { label: string; variant: "info" | "accent" | "danger" }>> = {
  transcribing: { label: "Drafting from the Call Recording", variant: "info" },
  ready: { label: "Draft ready to review", variant: "accent" },
  failed: { label: "Drafting failed", variant: "danger" },
};

type DraftStatusBody = { state: DraftState; retryOffered: boolean };

export function DraftStatus({
  draftId,
  initialState,
  initialRetryOffered = false,
  canManage = false,
}: {
  draftId: number;
  initialState: DraftState;
  initialRetryOffered?: boolean;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<DraftState>(initialState);
  const [retryOffered, setRetryOffered] = useState(initialRetryOffered);
  // Bumped after every poll, so the next one is scheduled even when the state
  // hasn't changed.
  const [polls, setPolls] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "transcribing") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/blended-learning/drafts/${draftId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as DraftStatusBody;
        if (!cancelled) {
          setState(json.state);
          setRetryOffered(json.retryOffered);
        }
      } catch {
        // Keep the last known state and try again on the next poll.
      }
      if (!cancelled) setPolls((count) => count + 1);
    }, DRAFT_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draftId, state, polls]);

  async function send(action: "retry" | "discard"): Promise<DraftStatusBody | null> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/blended-learning/drafts/${draftId}/${action}`, { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof json.error === "string" ? json.error : "Something went wrong. Try again.");
        return null;
      }
      return json as DraftStatusBody;
    } catch {
      setError("Couldn't reach the server. Try again.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    const draft = await send("retry");
    if (!draft) return;
    setState(draft.state);
    setRetryOffered(draft.retryOffered);
    if (draft.state === "transcribing") setMessage("Asked to draft it again.");
  }

  async function discard() {
    if (!window.confirm("Discard this Conversation Draft? The recording won't be drafted.")) return;
    const draft = await send("discard");
    if (!draft) return;
    setState(draft.state);
    router.refresh();
  }

  const shown = DRAFT_STATE[state];
  if (!shown) return null;
  const showRetry = canManage && retryOffered;
  return (
    <section aria-label="Conversation Draft">
      <Card elevation="sm" className="space-y-3 p-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-text-primary">Conversation Draft</span>
          <Badge variant={shown.variant}>{shown.label}</Badge>
        </div>
        {canManage && (
          <div className="flex flex-col gap-2 sm:flex-row">
            {showRetry && (
              <Button type="button" onClick={retry} disabled={busy} className="w-full sm:w-auto">
                {state === "failed" ? "Retry" : "Retry drafting"}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={discard} disabled={busy} className="w-full sm:w-auto">
              Discard
            </Button>
          </div>
        )}
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
      </Card>
    </section>
  );
}
