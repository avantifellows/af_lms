"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { Button, baseInputClasses, type ButtonVariant } from "@/components/ui";
import { validateConcernEventBody, type VisitConcernAction } from "@/lib/visit-concern-event-types";

// Resolve / Comment / Reopen on a Visit Concern (#470). Resolve on an open concern; Comment and
// Reopen on a resolved one. The note is trimmed and must be 1–2000 characters. A failed save shows
// the error and keeps the typed text; a saved one refreshes the server page, so the concern moves
// to its new section. The form stays open and disabled until that refresh lands, so the old buttons
// never come back to be pressed twice. A 409 (someone else changed the concern) shows the error and
// refreshes too, so the user sees its current state. `children` is the card's body: the action buttons sit to its right, and the
// note form opens below it, in place of the buttons. `onOpen` runs when a form opens (the card
// expands, so its mentions show above the note).

const FORMS: Record<
  VisitConcernAction,
  { button: string; variant: ButtonVariant; prompt: string; placeholder: string; submit: string }
> = {
  resolve: {
    button: "Resolve",
    variant: "success-outline",
    prompt: "How was this resolved?",
    placeholder: "How was this resolved? (required)",
    submit: "Mark resolved",
  },
  comment: {
    button: "Comment",
    variant: "secondary",
    prompt: "Comment",
    placeholder: "Add a comment (required)",
    submit: "Add comment",
  },
  reopen: {
    button: "Reopen",
    variant: "success-outline",
    prompt: "Why is this being reopened?",
    placeholder: "Why is this being reopened? (required)",
    submit: "Reopen",
  },
};

// null on success; otherwise the error to show, and whether the concern changed under the user.
async function postEvent(
  concernId: number,
  action: VisitConcernAction,
  body: string
): Promise<{ error: string; stale: boolean } | null> {
  try {
    const res = await fetch(`/api/visit-concerns/${concernId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, body }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return { error: data?.error ?? "Something went wrong. Please try again.", stale: res.status === 409 };
  } catch {
    return { error: "Could not reach the server. Please try again.", stale: false };
  }
}

export function ConcernActions({
  concernId,
  status,
  children,
  onOpen,
}: {
  concernId: number;
  status: "open" | "resolved";
  children?: ReactNode;
  onOpen?: (action: VisitConcernAction) => void;
}) {
  const router = useRouter();
  const [action, setAction] = useState<VisitConcernAction | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = saving || refreshing;

  const actions: VisitConcernAction[] = status === "open" ? ["resolve"] : ["comment", "reopen"];

  function open(next: VisitConcernAction) {
    setAction(next);
    setError(null);
    onOpen?.(next);
  }

  function cancel() {
    setAction(null);
    setText("");
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || busy) return;
    const body = validateConcernEventBody(text);
    if (!body.ok) {
      setError(body.error);
      return;
    }
    setSaving(true);
    setError(null);
    const failure = await postEvent(concernId, action, body.body);
    setSaving(false);
    if (failure) {
      setError(failure.error);
      if (failure.stale) startRefresh(() => router.refresh());
      return;
    }
    // The form closes in the same transition as the refresh, so it stays until the new page lands.
    startRefresh(() => {
      setAction(null);
      setText("");
      router.refresh();
    });
  }

  const form = action ? FORMS[action] : null;
  return (
    <div>
      {/* The buttons wrap below the body when the card is too narrow for both (phones). */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-40 flex-1">{children}</div>
        {!form && (
          <div className="flex shrink-0 gap-2">
            {actions.map((next) => (
              <Button key={next} type="button" variant={FORMS[next].variant} size="sm" onClick={() => open(next)}>
                {FORMS[next].button}
              </Button>
            ))}
          </div>
        )}
      </div>
      {form && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <textarea
            aria-label={form.prompt}
            placeholder={form.placeholder}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            disabled={busy}
            autoFocus
            className={`${baseInputClasses} block w-full bg-bg-input`}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="success" size="sm" disabled={busy}>
              {busy ? "Saving…" : form.submit}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
