"use client";

import { useEffect, useState } from "react";

import type { TargetPreview } from "@/lib/blended-learning-common-action-items";

import { manageRequest, students } from "./manageRequest";

// The new item's target as the form holds it, and its live preview: how many
// Students it reaches now and, for pasted Student IDs, which IDs won't get it.

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

// The preview for the draft's target; null while unknown.
export function useTargetPreview(draft: TargetDraft): TargetPreview | null {
  const target = apiTarget(draft);
  const key = missingChoice(draft) === null ? JSON.stringify(target) : null;
  const [preview, setPreview] = useState<{ key: string; value: TargetPreview } | null>(null);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const timer = setTimeout(
      async () => {
        const result = await manageRequest<TargetPreview>("/api/blended-learning/common-action-items/preview", {
          method: "POST",
          body: JSON.parse(key),
        });
        if (!cancelled && result.ok) setPreview({ key, value: result.body });
      },
      draft.kind === "students" ? TYPING_DELAY_MS : 0
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, draft.kind]);

  return preview && preview.key === key ? preview.value : null;
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

export function PreviewLine({ draft, preview }: { draft: TargetDraft; preview: TargetPreview | null }) {
  const count = preview?.count ?? null;
  let text = missingChoice(draft) ?? "Counting students…";
  if (count !== null) text = count === 0 ? "No students match this target." : `Will be added to ${students(count)}.`;
  return (
    <div aria-live="polite" className="space-y-1">
      <p className={`text-sm font-bold ${count === 0 ? "text-danger" : "text-text-primary"}`}>{text}</p>
      {preview && <UnmatchedIds preview={preview} />}
    </div>
  );
}
