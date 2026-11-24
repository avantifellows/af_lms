"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import type { TargetPreview } from "@/lib/blended-learning-common-action-items";

import { manageRequest, students, type ManageResponse } from "./manageRequest";

// The new item's target as the form holds it, and its live preview: how many
// Students it reaches now and, for pasted Student IDs, which IDs won't get it.
// A preview that fails (IDs the server won't take, or the request fails)
// says why, and the form can't push until one for the current target lands.

export type TargetDraft = { kind: "all" | "grade" | "mentor" | "students"; grade: string; mentorUserId: string; studentIds: string };

// Typing IDs waits for a pause before asking again.
const TYPING_DELAY_MS = 400;

// The target as the API takes it.
export function apiTarget(draft: TargetDraft) {
  return { kind: draft.kind, grade: draft.grade, mentorUserId: draft.mentorUserId, studentIds: draft.studentIds };
}

// What still needs choosing before a preview can be asked for; null when the
// target is complete.
function missingChoice(draft: TargetDraft): string | null {
  if (draft.kind === "mentor" && !draft.mentorUserId) return "Choose a mentor to see how many students get it.";
  if (draft.kind === "students" && !draft.studentIds.trim()) return "Paste Student IDs to see how many students get it.";
  return null;
}

// The preview of the draft's target: what is still to choose, counting
// (also while typing pauses), failed with the error to show (a field error,
// such as too many IDs, can't be retried as is), or counted.
export type PreviewState =
  | { status: "incomplete"; hint: string }
  | { status: "counting" }
  | { status: "failed"; error: string; canRetry: boolean }
  | { status: "ready"; preview: TargetPreview };

function previewState(response: ManageResponse<TargetPreview>): PreviewState {
  if (response.ok) return { status: "ready", preview: response.body };
  const fieldError = response.fieldErrors.studentIds ?? Object.values(response.fieldErrors)[0];
  return fieldError
    ? { status: "failed", error: fieldError, canRetry: false }
    : { status: "failed", error: `Couldn't count students. ${response.error}`, canRetry: true };
}

// The preview for the draft's target, and a way to ask again after a failure.
// Each change of target (complete or not) and each retry starts a new
// generation, and only a response from the current one counts: a response
// saved for a target chosen earlier never counts for it again.
export function useTargetPreview(draft: TargetDraft): { state: PreviewState; retry: () => void } {
  const target = JSON.stringify(apiTarget(draft));
  const hint = missingChoice(draft);
  const key = hint === null ? target : null;
  const [generation, setGeneration] = useState(0);
  const [generationTarget, setGenerationTarget] = useState(target);
  if (generationTarget !== target) {
    setGenerationTarget(target);
    setGeneration((current) => current + 1);
  }
  const [response, setResponse] = useState<{ generation: number; value: ManageResponse<TargetPreview> } | null>(null);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        const value = await manageRequest<TargetPreview>("/api/blended-learning/common-action-items/preview", {
          method: "POST",
          body: JSON.parse(key),
        });
        if (!cancelled) setResponse({ generation, value });
      },
      draft.kind === "students" ? TYPING_DELAY_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, draft.kind, generation]);

  const retry = () => setGeneration((current) => current + 1);
  if (hint !== null) return { state: { status: "incomplete", hint }, retry };
  if (response?.generation !== generation) return { state: { status: "counting" }, retry };
  return { state: previewState(response.value), retry };
}

// The counted preview, or null until there is one.
export function countedPreview(state: PreviewState): TargetPreview | null {
  return state.status === "ready" ? state.preview : null;
}

function ids(count: number): string {
  return `${count} ${count === 1 ? "ID" : "IDs"}`;
}

// Pasted IDs that won't get the item, IDs only.
export function UnmatchedIds({ preview }: { preview: TargetPreview }) {
  if (preview.notFound.length === 0 && preview.noMentor.length === 0) return null;
  return (
    <div className="space-y-1 text-sm text-text-secondary">
      {preview.notFound.length > 0 && (
        <p>
          <span className="font-bold text-danger">{ids(preview.notFound.length)} not found:</span>{" "}
          <span className="break-all font-mono">{preview.notFound.join(", ")}</span>
        </p>
      )}
      {preview.noMentor.length > 0 && (
        <p>
          <span className="font-bold text-warning-text">{ids(preview.noMentor.length)} found but with no active mentor:</span>{" "}
          <span className="break-all font-mono">{preview.noMentor.join(", ")}</span>
        </p>
      )}
    </div>
  );
}

export function PreviewLine({ state, onRetry }: { state: PreviewState; onRetry: () => void }) {
  if (state.status === "failed") {
    return (
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <p role="alert" className="text-sm font-bold text-danger">
          {state.error}
        </p>
        {state.canRetry && (
          <Button type="button" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    );
  }
  const preview = countedPreview(state);
  const count = preview?.count ?? null;
  let text = state.status === "incomplete" ? state.hint : "Counting students…";
  if (count !== null) text = count === 0 ? "No students match this target." : `Will be added to ${students(count)}.`;
  return (
    <div aria-live="polite" className="space-y-1">
      <p className={`text-sm font-bold ${count === 0 ? "text-danger" : "text-text-primary"}`}>{text}</p>
      {preview && <UnmatchedIds preview={preview} />}
    </div>
  );
}
