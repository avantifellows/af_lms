"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button, baseInputClasses, type ButtonVariant } from "@/components/ui";
import { validateConcernEventBody, type VisitConcernAction } from "@/lib/visit-concern-event-types";

// Resolve / Comment / Reopen on a Visit Concern (#470). Resolve on an open concern; Comment and
// Reopen on a resolved one. The note is trimmed and must be 1–2000 characters. A failed save shows
// the error and keeps the typed text; a saved one refreshes the server page, so the concern moves
// to its new section. `children` is the card's body: the action buttons sit to its right, and the
// note form opens below it, in place of the buttons.

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

async function postEvent(concernId: number, action: VisitConcernAction, body: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/visit-concerns/${concernId}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, body }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    return data?.error ?? "Something went wrong. Please try again.";
  } catch {
    return "Could not reach the server. Please try again.";
  }
}

export function ConcernActions({
  concernId,
  status,
  children,
}: {
  concernId: number;
  status: "open" | "resolved";
  children?: ReactNode;
}) {
  const router = useRouter();
  const [action, setAction] = useState<VisitConcernAction | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const actions: VisitConcernAction[] = status === "open" ? ["resolve"] : ["comment", "reopen"];

  function open(next: VisitConcernAction) {
    setAction(next);
    setError(null);
  }

  function cancel() {
    setAction(null);
    setText("");
    setError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || saving) return;
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
      setError(failure);
      return;
    }
    setAction(null);
    setText("");
    router.refresh();
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
            disabled={saving}
            autoFocus
            className={`${baseInputClasses} block w-full bg-bg-input`}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="success" size="sm" disabled={saving}>
              {saving ? "Saving…" : form.submit}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
