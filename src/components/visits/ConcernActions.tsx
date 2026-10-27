"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button, baseInputClasses } from "@/components/ui";
import { validateConcernEventBody, type VisitConcernAction } from "@/lib/visit-concern-event-types";

// Resolve / Comment / Reopen on a Visit Concern (#470). Resolve on an open concern; Comment and
// Reopen on a resolved one. The note is trimmed and must be 1–2000 characters. A failed save shows
// the error and keeps the typed text; a saved one refreshes the server page, so the concern moves
// to its new section.

const FORMS: Record<VisitConcernAction, { button: string; prompt: string; submit: string }> = {
  resolve: { button: "Resolve", prompt: "How was this resolved?", submit: "Save resolution" },
  comment: { button: "Comment", prompt: "Comment", submit: "Add comment" },
  reopen: { button: "Reopen", prompt: "Why reopen this concern?", submit: "Reopen concern" },
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

export function ConcernActions({ concernId, status }: { concernId: number; status: "open" | "resolved" }) {
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

  if (!action) {
    return (
      <div className="mt-2 flex gap-2">
        {actions.map((next) => (
          <Button key={next} type="button" variant="secondary" size="sm" onClick={() => open(next)}>
            {FORMS[next].button}
          </Button>
        ))}
      </div>
    );
  }

  const form = FORMS[action];
  return (
    <form onSubmit={submit} className="mt-2 space-y-2">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-text-primary">{form.prompt}</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={3}
          disabled={saving}
          className={`${baseInputClasses} w-full`}
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Saving…" : form.submit}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
