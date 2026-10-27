"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";

import { Button, FormLabel } from "@/components/ui";
import type { TargetMentor } from "@/lib/blended-learning-common-action-items";
import {
  COMMON_ITEM_TEXT_MAX,
  validateCommonItem,
  type CommonItemOwner,
  type CommonTarget,
} from "@/lib/blended-learning-manage-input";

import { BlendedSelect } from "../BlendedSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { FieldError, TextAreaField } from "./fields";
import { manageRequest, students } from "./manageRequest";
import { OwnerSelect } from "./OwnerSelect";
import { targetLabel } from "./targetLabel";

// A new Common Action Item: its text, who does it and who gets it (every
// Student with a Mentor, one grade, or one Mentor's Students). Once the target
// is complete the form previews how many Students it reaches now; pushing asks
// for confirmation, then adds it as an open Action Item for each of them.

type TargetKind = CommonTarget["kind"];
type Draft = { text: string; owner: CommonItemOwner; kind: TargetKind; grade: string; mentorUserId: string };

const EMPTY: Draft = { text: "", owner: "student", kind: "all", grade: "12", mentorUserId: "" };
const TARGET_KINDS: { value: TargetKind; label: string }[] = [
  { value: "all", label: "All students" },
  { value: "grade", label: "One grade" },
  { value: "mentor", label: "One mentor's students" },
];

// The target as the API takes it (the preview's query string, the body).
function draftTarget(draft: Draft) {
  return { kind: draft.kind, grade: draft.grade, mentorUserId: draft.mentorUserId };
}

// The target as chosen, for its label.
function chosenTarget(draft: Draft): CommonTarget {
  if (draft.kind === "grade") return { kind: "grade", grade: draft.grade === "13" ? 13 : 12 };
  if (draft.kind === "mentor") return { kind: "mentor", mentorUserId: Number(draft.mentorUserId) };
  return { kind: "all" };
}

// How many Students the draft's target reaches now; null while unknown.
function usePreview(draft: Draft): number | null {
  const { kind, grade, mentorUserId } = draft;
  const [preview, setPreview] = useState<{ key: string; count: number } | null>(null);
  const key = kind === "mentor" && !mentorUserId ? null : `${kind}:${grade}:${mentorUserId}`;

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    const params = new URLSearchParams({ kind, grade, mentorUserId });
    manageRequest<{ count: number }>(`/api/blended-learning/common-action-items/preview?${params}`).then((result) => {
      if (!cancelled && result.ok) setPreview({ key, count: result.body.count });
    });
    return () => {
      cancelled = true;
    };
  }, [key, kind, grade, mentorUserId]);

  return preview && preview.key === key ? preview.count : null;
}

function TargetChoice({ draft, mentors, errors, onChange }: {
  draft: Draft;
  mentors: TargetMentor[];
  errors: Record<string, string>;
  onChange: (change: Partial<Draft>) => void;
}) {
  const name = useId();
  return (
    <fieldset className="min-w-0 space-y-2">
      <legend className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">Who gets it</legend>
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-5">
        {TARGET_KINDS.map((option) => (
          <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text-primary">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={draft.kind === option.value}
              onChange={() => onChange({ kind: option.value })}
              className="h-5 w-5 accent-accent"
            />
            {option.label}
          </label>
        ))}
      </div>
      {draft.kind === "grade" && (
        <BlendedSelect aria-label="Grade" value={draft.grade} onChange={(event) => onChange({ grade: event.target.value })} wrapperClassName="sm:max-w-xs">
          <option value="12">Grade 12</option>
          <option value="13">Grade 13</option>
        </BlendedSelect>
      )}
      {draft.kind === "mentor" && (
        <BlendedSelect
          aria-label="Mentor"
          value={draft.mentorUserId}
          onChange={(event) => onChange({ mentorUserId: event.target.value })}
          aria-invalid={Boolean(errors.mentorUserId)}
          wrapperClassName="sm:max-w-sm"
        >
          <option value="">Choose a mentor</option>
          {mentors.map((mentor) => (
            <option key={mentor.userId} value={String(mentor.userId)}>
              {mentor.name} ({students(mentor.students)})
            </option>
          ))}
        </BlendedSelect>
      )}
      <FieldError message={errors.mentorUserId ?? errors.grade ?? errors.target} />
    </fieldset>
  );
}

function PreviewLine({ count, kind }: { count: number | null; kind: TargetKind }) {
  let text = "Counting students…";
  if (count === null && kind === "mentor") text = "Choose a mentor to see how many students get it.";
  else if (count !== null) text = count === 0 ? "No students match this target." : `Will be added to ${students(count)}.`;
  return (
    <p aria-live="polite" className={`text-sm font-bold ${count === 0 ? "text-danger" : "text-text-primary"}`}>
      {text}
    </p>
  );
}

function useNewCommonItem() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function review(event: FormEvent) {
    event.preventDefault();
    const validated = validateCommonItem({ ...draft, target: draftTarget(draft) });
    setErrors(validated.ok ? {} : validated.fieldErrors);
    if (validated.ok) setConfirming(true);
  }

  async function push() {
    setBusy(true);
    setError(null);
    const result = await manageRequest("/api/blended-learning/common-action-items", {
      method: "POST",
      body: { text: draft.text, owner: draft.owner, target: draftTarget(draft) },
    });
    setBusy(false);
    if (!result.ok) {
      if (Object.keys(result.fieldErrors).length === 0) return setError(result.error);
      setErrors(result.fieldErrors);
      return setConfirming(false);
    }
    setConfirming(false);
    setDraft(EMPTY);
    router.refresh();
  }

  const change = (update: Partial<Draft>) => setDraft((current) => ({ ...current, ...update }));
  const cancel = () => {
    setConfirming(false);
    setError(null);
  };
  return { draft, change, errors, confirming, busy, error, review, push, cancel };
}

export function NewCommonItemForm({ mentors }: { mentors: TargetMentor[] }) {
  const form = useNewCommonItem();
  const { draft } = form;
  const count = usePreview(draft);
  const mentorName = mentors.find((mentor) => String(mentor.userId) === draft.mentorUserId)?.name ?? null;

  return (
    <form onSubmit={form.review} aria-label="New common action item" className="space-y-4">
      <TextAreaField
        label="Action item"
        value={draft.text}
        maxLength={COMMON_ITEM_TEXT_MAX}
        onChange={(text) => form.change({ text })}
        error={form.errors.text}
      />
      <div className="sm:max-w-xs">
        <FormLabel htmlFor="common-item-owner">Who does it</FormLabel>
        <OwnerSelect id="common-item-owner" value={draft.owner} onChange={(owner) => form.change({ owner })} />
        <FieldError message={form.errors.owner} />
      </div>
      <TargetChoice draft={draft} mentors={mentors} errors={form.errors} onChange={form.change} />
      <PreviewLine count={count} kind={draft.kind} />
      <Button type="submit" disabled={count === 0} className="w-full sm:w-auto">
        <Send aria-hidden="true" className="h-4 w-4" />
        Push to students
      </Button>
      <ConfirmDialog
        open={form.confirming}
        title="Push this action item?"
        confirmLabel="Push"
        busy={form.busy}
        error={form.error}
        onConfirm={form.push}
        onCancel={form.cancel}
      >
        <p className="break-words font-bold text-text-primary">{draft.text.trim()}</p>
        <p>
          {targetLabel(chosenTarget(draft), mentorName)}
          {count !== null && ` · Will be added to ${students(count)}.`}
        </p>
        <p>Students mapped later get it only if you push it again.</p>
      </ConfirmDialog>
    </form>
  );
}
