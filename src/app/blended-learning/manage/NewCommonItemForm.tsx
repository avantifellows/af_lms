"use client";

import { Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

import { Button, FormLabel } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";
import type { TargetMentor } from "@/lib/blended-learning-common-action-items";
import {
  COMMON_ITEM_TEXT_MAX,
  parseStudentIds,
  validateCommonItem,
  type CommonItemOwner,
  type CommonTarget,
} from "@/lib/blended-learning-manage-input";

import { BlendedSelect } from "../BlendedSelect";
import { ConfirmDialog } from "./ConfirmDialog";
import { ActionItemFields, FieldError } from "./fields";
import { manageRequest, students } from "./manageRequest";
import { targetLabel } from "./targetLabel";
import {
  apiTarget,
  countedPreview,
  PreviewLine,
  UnmatchedIds,
  useTargetPreview,
  type TargetDraft,
} from "./targetPreview";

// A new Common Action Item: its text, who does it and who gets it (every
// Student with a Mentor, one grade, one Mentor's Students, or Student IDs
// pasted from the sheet). Once the target is complete the form previews how
// many Students it reaches now (and which pasted IDs won't get it); pushing
// asks for confirmation, then adds it as an open Action Item for each of them.
// Push waits for that preview: it is off while counting, after a failed
// preview and when no one matches (an incomplete target still gets the
// form's own checks).

type Draft = TargetDraft & { text: string; owner: CommonItemOwner };

const EMPTY: Draft = { text: "", owner: "student", kind: "all", grade: "12", mentorUserId: "", studentIds: "" };
const TARGET_KINDS: { value: TargetDraft["kind"]; label: string }[] = [
  { value: "all", label: "All students" },
  { value: "grade", label: "One grade" },
  { value: "mentor", label: "One mentor's students" },
  { value: "students", label: "Specific students" },
];

// The target as chosen, for its label.
function chosenTarget(draft: Draft): CommonTarget {
  if (draft.kind === "grade") return { kind: "grade", grade: draft.grade === "13" ? 13 : 12 };
  if (draft.kind === "mentor") return { kind: "mentor", mentorUserId: Number(draft.mentorUserId) };
  if (draft.kind === "students") return { kind: "students", studentIds: parseStudentIds(draft.studentIds) };
  return { kind: "all" };
}

function StudentIdsField({
  value,
  error,
  invalid,
  onChange,
}: {
  value: string;
  error?: string;
  // The preview turned the IDs down; its line says why.
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div>
      <FormLabel htmlFor={id}>Student IDs</FormLabel>
      <textarea
        id={id}
        rows={4}
        value={value}
        placeholder="Paste Student IDs, separated by spaces, commas or new lines"
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error) || invalid}
        className={`block w-full resize-y font-mono ${baseInputClasses}`}
      />
      <FieldError message={error} />
    </div>
  );
}

function TargetChoice({ draft, mentors, errors, idsTurnedDown, onChange }: {
  draft: Draft;
  mentors: TargetMentor[];
  errors: Record<string, string>;
  idsTurnedDown: boolean;
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
      {draft.kind === "students" && (
        <StudentIdsField
          value={draft.studentIds}
          error={errors.studentIds}
          invalid={idsTurnedDown}
          onChange={(studentIds) => onChange({ studentIds })}
        />
      )}
      <FieldError message={errors.mentorUserId ?? errors.grade ?? errors.target} />
    </fieldset>
  );
}

function useNewCommonItem(onPushed: (added: number) => void) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const preview = useTargetPreview(draft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counted = countedPreview(preview.state);
  // Push only once the current target is counted and reaches someone.
  const canConfirm = counted !== null && counted.count > 0;

  function review(event: FormEvent) {
    event.preventDefault();
    const validated = validateCommonItem({ ...draft, target: apiTarget(draft) });
    setErrors(validated.ok ? {} : validated.fieldErrors);
    if (validated.ok && canConfirm) setConfirming(true);
  }

  async function push() {
    setBusy(true);
    setError(null);
    const result = await manageRequest<{ added: number }>("/api/blended-learning/common-action-items", {
      method: "POST",
      body: { text: draft.text, owner: draft.owner, target: apiTarget(draft) },
    });
    setBusy(false);
    if (!result.ok) {
      if (Object.keys(result.fieldErrors).length === 0) return setError(result.error);
      setErrors(result.fieldErrors);
      return setConfirming(false);
    }
    setConfirming(false);
    setDraft(EMPTY);
    onPushed(result.body.added);
    router.refresh();
  }

  const change = (update: Partial<Draft>) => setDraft((current) => ({ ...current, ...update }));
  const cancel = () => {
    setConfirming(false);
    setError(null);
  };
  const pushOff = preview.state.status === "counting" || preview.state.status === "failed" || counted?.count === 0;
  return { draft, change, preview, counted, pushOff, errors, confirming, busy, error, review, push, cancel };
}

export function NewCommonItemForm({ mentors, onPushed }: { mentors: TargetMentor[]; onPushed: (added: number) => void }) {
  const form = useNewCommonItem(onPushed);
  const { draft, counted: preview } = form;
  const count = preview?.count ?? null;
  const idsTurnedDown = form.preview.state.status === "failed" && !form.preview.state.canRetry;
  const mentorName = mentors.find((mentor) => String(mentor.userId) === draft.mentorUserId)?.name ?? null;

  return (
    <form onSubmit={form.review} aria-label="New program action item" className="space-y-4">
      <ActionItemFields
        text={draft.text}
        owner={draft.owner}
        maxLength={COMMON_ITEM_TEXT_MAX}
        onTextChange={(text) => form.change({ text })}
        onOwnerChange={(owner) => form.change({ owner })}
        errors={form.errors}
      />
      <TargetChoice
        draft={draft}
        mentors={mentors}
        errors={form.errors}
        idsTurnedDown={idsTurnedDown}
        onChange={form.change}
      />
      <PreviewLine state={form.preview.state} onRetry={form.preview.retry} />
      <Button type="submit" disabled={form.pushOff} className="w-full sm:w-auto">
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
        {preview && <UnmatchedIds preview={preview} />}
        <p>Students mapped later get it only if you push it again.</p>
      </ConfirmDialog>
    </form>
  );
}
