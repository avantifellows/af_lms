"use client";

import { useEffect, useState } from "react";

import { Badge, Card } from "@/components/ui";
import type { DraftState } from "@/lib/blended-learning-drafts";

// The Mentee's open Conversation Draft. While etl-next is drafting, the page
// polls the draft's state every 15 seconds; a ready or failed draft does not
// change by itself, so polling stops there. A draft that is no longer open
// (discarded or saved elsewhere) disappears.

const DRAFT_POLL_MS = 15_000;

const DRAFT_STATE: Partial<Record<DraftState, { label: string; variant: "info" | "accent" | "danger" }>> = {
  transcribing: { label: "Drafting from the Call Recording", variant: "info" },
  ready: { label: "Draft ready to review", variant: "accent" },
  failed: { label: "Drafting failed", variant: "danger" },
};

export function DraftStatus({ draftId, initialState }: { draftId: number; initialState: DraftState }) {
  const [state, setState] = useState<DraftState>(initialState);
  // Bumped after every poll, so the next one is scheduled even when the state
  // hasn't changed.
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (state !== "transcribing") return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/blended-learning/drafts/${draftId}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as { state: DraftState };
        if (!cancelled) setState(json.state);
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

  const shown = DRAFT_STATE[state];
  if (!shown) return null;
  return (
    <section aria-label="Conversation Draft">
      <Card elevation="sm" className="flex flex-wrap items-center gap-2 p-4 sm:px-6">
        <span className="text-sm font-bold text-text-primary">Conversation Draft</span>
        <Badge variant={shown.variant}>{shown.label}</Badge>
      </Card>
    </section>
  );
}
