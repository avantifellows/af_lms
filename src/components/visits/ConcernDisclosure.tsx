"use client";

import { useId, useState, type ReactNode } from "react";

import { ConcernActions } from "@/components/visits/ConcernActions";

// The body of a School page concern or highlight card (#470): `summary` is the toggle (a button
// with aria-expanded) that shows or hides `mentions` (what the PMs said, rendered by the server
// and passed in), and `after` (the history) always shows below. With `actions` the card gets its
// Resolve / Comment / Reopen controls; opening one expands the card, so the mentions sit above the
// note. The action buttons are siblings of the toggle, so they never toggle it.
export function ConcernDisclosure({
  summary,
  mentions,
  after,
  actions,
}: {
  summary: ReactNode;
  mentions: ReactNode;
  after?: ReactNode;
  actions?: { concernId: number; status: "open" | "resolved" };
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const body = (
    <>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full cursor-pointer items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1"
      >
        <span
          aria-hidden
          className={`mt-0.5 inline-block w-3 shrink-0 text-sm text-text-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          ▸
        </span>
        <span className="block min-w-0 flex-1">{summary}</span>
      </button>
      <div id={panelId} hidden={!expanded} className="pl-5">
        {expanded && mentions}
      </div>
      {after && <div className="pl-5">{after}</div>}
    </>
  );

  return actions ? (
    <ConcernActions concernId={actions.concernId} status={actions.status} onOpen={() => setExpanded(true)}>
      {body}
    </ConcernActions>
  ) : (
    body
  );
}
