"use client";

import { useId, useState, type Dispatch, type SetStateAction } from "react";

import { FormLabel } from "@/components/ui";

import { ActionItemsEditor } from "./ActionItemsEditor";
import { FieldError, FormCard, LABEL_CLASSES, LabelRow, TEXTAREA_CLASSES } from "./formParts";
import { withoutFieldErrors, type EntryFormValues, type FieldErrors } from "./logEntryPayload";
import { MentorFlagsEditor } from "./MentorFlagsEditor";
import { NotesEditor } from "./NotesEditor";
import { PhotoPicker, type PickedPhoto } from "./PhotoPicker";
import type { ChangeValues } from "./SessionDetailsCard";

// The Write-up card: Summary, Action items and Notes, then photos, then the
// Mentor Flags below a rule. While a draft is being drafted the first three
// are held, under their labels; while one is reviewed each is marked as
// coming from the recording until the Mentor edits it.

type Section = "summary" | "actionItems" | "notes";

const DRAFTED = "Drafted from the recording";
const WRITTEN = "Written from the recording";

function DraftingPlaceholder() {
  return (
    <div className="space-y-5">
      {["Summary", "Action items", "Notes"].map((label) => (
        <div key={label}>
          <span className={LABEL_CLASSES}>{label}</span>
          <div className="flex min-h-16 items-center rounded-lg border-2 border-dashed border-border bg-bg-card-alt px-3 text-sm text-text-muted">
            Filling in from the recording…
          </div>
        </div>
      ))}
    </div>
  );
}

function SummaryField({
  value,
  error,
  marker,
  onChange,
}: {
  value: string;
  error?: string;
  marker: string | null;
  onChange: (summary: string) => void;
}) {
  const id = `${useId()}-summary`;
  return (
    <div>
      <LabelRow label={<FormLabel htmlFor={id}>Summary</FormLabel>} marker={marker} />
      <textarea
        id={id}
        rows={3}
        value={value}
        placeholder="Two or three lines. This is what you read first next time."
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        className={TEXTAREA_CLASSES}
      />
      <FieldError message={error} />
    </div>
  );
}

function NotesField({
  initialHtml,
  error,
  marker,
  onChange,
  onEdit,
}: {
  initialHtml: string;
  error?: string;
  marker: string | null;
  onChange: (notesHtml: string) => void;
  onEdit: () => void;
}) {
  const labelId = `${useId()}-notes-label`;
  return (
    <div>
      <LabelRow
        label={
          <span id={labelId} className={LABEL_CLASSES}>
            Notes
          </span>
        }
        marker={marker}
      />
      {/* Switching to Attempt unmounts the editor; it comes back with the
          notes it last showed, so what is saved is what is seen. */}
      <NotesEditor labelId={labelId} initialHtml={initialHtml} onChange={onChange} onEdit={onEdit} />
      <FieldError message={error} />
    </div>
  );
}

// Which drafted sections the Mentor has edited, and the marker each shows.
function useDraftedMarkers(reviewing: boolean) {
  const [edited, setEdited] = useState<ReadonlySet<Section>>(() => new Set());
  const markEdited = (section: Section) =>
    setEdited((current) => (current.has(section) ? current : new Set(current).add(section)));
  const marker = (section: Section, text: string) => (reviewing && !edited.has(section) ? text : null);
  return { markEdited, marker };
}

function WriteUpFields({
  reviewing,
  values,
  change,
  fieldErrors,
  clearErrors,
}: {
  reviewing: boolean;
  values: EntryFormValues;
  change: ChangeValues;
  fieldErrors: FieldErrors;
  clearErrors: (prefix: string) => void;
}) {
  const { markEdited, marker } = useDraftedMarkers(reviewing);
  return (
    <>
      <SummaryField
        value={values.summary}
        error={fieldErrors.summary}
        marker={marker("summary", DRAFTED)}
        onChange={(summary) => {
          change(() => ({ summary }));
          markEdited("summary");
        }}
      />
      <ActionItemsEditor
        items={values.actionItems}
        errors={fieldErrors}
        marker={marker("actionItems", DRAFTED)}
        onChange={(key, itemChange) => {
          change(({ actionItems }) => ({
            actionItems: actionItems.map((item) => (item.key === key ? { ...item, ...itemChange } : item)),
          }));
          markEdited("actionItems");
        }}
        onAdd={() => {
          change(({ actionItems, nextItemKey }) => ({
            actionItems: [...actionItems, { key: nextItemKey, owner: "student", text: "" }],
            nextItemKey: nextItemKey + 1,
          }));
          markEdited("actionItems");
        }}
        onRemove={(key) => {
          change(({ actionItems }) => ({ actionItems: actionItems.filter((item) => item.key !== key) }));
          clearErrors("actionItems");
          markEdited("actionItems");
        }}
      />
      <NotesField
        initialHtml={values.notesHtml}
        error={fieldErrors.notesHtml}
        marker={marker("notes", WRITTEN)}
        onChange={(notesHtml) => change(() => ({ notesHtml }))}
        onEdit={() => markEdited("notes")}
      />
    </>
  );
}

export function WriteUpCard({
  studentId,
  reviewing,
  drafting,
  values,
  change,
  photos,
  setPhotos,
  fieldErrors,
  setFieldErrors,
}: {
  studentId: number;
  reviewing: boolean;
  // A draft is being drafted: the write-up is held until it is ready.
  drafting: boolean;
  values: EntryFormValues;
  change: ChangeValues;
  photos: PickedPhoto[];
  setPhotos: Dispatch<SetStateAction<PickedPhoto[]>>;
  fieldErrors: FieldErrors;
  setFieldErrors: Dispatch<SetStateAction<FieldErrors>>;
}) {
  // Per-item errors are keyed by position, which a removal or switch shifts.
  const clearErrors = (prefix: string) => setFieldErrors((errors) => withoutFieldErrors(errors, prefix));
  return (
    <FormCard title="Write-up">
      {drafting ? (
        <DraftingPlaceholder />
      ) : (
        <WriteUpFields
          reviewing={reviewing}
          values={values}
          change={change}
          fieldErrors={fieldErrors}
          clearErrors={clearErrors}
        />
      )}
      <PhotoPicker
        studentId={studentId}
        photos={photos}
        setPhotos={(next) => {
          setPhotos(next);
          clearErrors("photoKeys");
        }}
        errors={fieldErrors}
      />
      <MentorFlagsEditor
        flags={values.flags}
        errors={fieldErrors}
        onChange={(flags) => {
          change(() => ({ flags }));
          clearErrors("flags");
        }}
      />
    </FormCard>
  );
}
