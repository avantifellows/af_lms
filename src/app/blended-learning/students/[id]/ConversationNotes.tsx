"use client";

import { useState } from "react";

// A past Conversation's full notes, fetched only on first expand. The HTML
// is the stored notes, sanitised on the server before it was saved.
export function ConversationNotes({ conversationId }: { conversationId: number }) {
  const [expanded, setExpanded] = useState(false);
  const [notesHtml, setNotesHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  async function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (!next || notesHtml !== null || status === "loading") return;
    setStatus("loading");
    try {
      const res = await fetch(`/api/blended-learning/conversations/${conversationId}/notes`);
      if (!res.ok) throw new Error(String(res.status));
      const body: { notesHtml: string | null } = await res.json();
      setNotesHtml(body.notesHtml ?? "");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  const panelId = `conversation-${conversationId}-notes`;
  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex min-h-11 items-center text-sm font-bold text-accent hover:text-accent-hover"
      >
        {expanded ? "Hide notes" : "Show notes"}
      </button>
      {expanded && (
        <div id={panelId} className="border-l-2 border-border pl-3">
          {status === "loading" && <p className="text-sm text-text-muted">Loading notes…</p>}
          {status === "error" && <p className="text-sm text-danger">Couldn&apos;t load the notes. Try again.</p>}
          {notesHtml !== null && (
            <div
              className="max-w-full overflow-x-auto break-words text-sm text-text-primary [&_h3]:mt-2 [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_table]:my-2 [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: notesHtml }}
            />
          )}
        </div>
      )}
    </div>
  );
}
