"use client";

import { X } from "lucide-react";
import { useId } from "react";

import { Button } from "@/components/ui";
import type { ActionItemOwner } from "@/lib/blended-learning-mentee-detail";

import { BlendedSelect } from "../../../BlendedSelect";
import { ACTION_ITEM_OWNER } from "../ActionItemMeta";
import { CarriedItemsNotice, CarriedMarker } from "./CarriedActionItems";
import { FieldError, GrowingTextarea, LABEL_CLASSES, LabelRow } from "./formParts";
import { sentActionItemIndex, type DraftActionItem, type FieldErrors } from "./logEntryPayload";

// The new Conversation's Action Items, one compact row each as in the mockup:
// who, what, and a remove button. On a phone the owner takes its own line.
// A row left without text is not saved, so the starter rows never block.
// Rows carried over from the Profile Doc are marked, under a notice.

const OWNERS = Object.keys(ACTION_ITEM_OWNER) as ActionItemOwner[];

function ActionItemRow({
  item,
  number,
  error,
  onChange,
  onRemove,
}: {
  item: DraftActionItem;
  number: number;
  error: (field: "owner" | "text") => string | undefined;
  onChange: (change: Partial<DraftActionItem>) => void;
  onRemove: () => void;
}) {
  const tipId = `${useId()}-carried`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_2.75rem] sm:items-start">
      <BlendedSelect
        aria-label={`Who does action item ${number}`}
        value={item.owner}
        onChange={(event) => onChange({ owner: event.target.value as ActionItemOwner })}
        aria-invalid={Boolean(error("owner"))}
        wrapperClassName="col-span-2 sm:col-span-1"
      >
        {OWNERS.map((owner) => (
          <option key={owner} value={owner}>
            {ACTION_ITEM_OWNER[owner]}
          </option>
        ))}
      </BlendedSelect>
      <GrowingTextarea
        aria-label={`Action item ${number}`}
        placeholder="What will be done"
        value={item.text}
        onChange={(event) => onChange({ text: event.target.value })}
        aria-invalid={Boolean(error("text"))}
        aria-describedby={item.carried ? tipId : undefined}
      />
      <Button
        type="button"
        variant="icon"
        aria-label={`Remove action item ${number}`}
        onClick={onRemove}
        className="w-11"
      >
        <X aria-hidden="true" className="h-5 w-5" />
      </Button>
      <div className="col-span-full empty:hidden">
        {item.carried && <CarriedMarker tipId={tipId} />}
        <FieldError message={error("owner")} />
        <FieldError message={error("text")} />
      </div>
    </div>
  );
}

export function ActionItemsEditor({
  items,
  errors,
  marker,
  onChange,
  onAdd,
  onRemove,
}: {
  items: DraftActionItem[];
  errors: FieldErrors;
  // Shown beside the label while the drafted rows are unedited.
  marker: string | null;
  onChange: (key: number, change: Partial<DraftActionItem>) => void;
  onAdd: () => void;
  onRemove: (key: number) => void;
}) {
  const labelId = useId();
  // The server counts only the rows sent, those with text.
  const sentIndex = sentActionItemIndex(items);
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-2">
      <LabelRow
        label={
          <span id={labelId} className={LABEL_CLASSES}>
            Action items
          </span>
        }
        marker={marker}
      />
      {items.some((item) => item.carried) && <CarriedItemsNotice />}
      {items.map((item, index) => (
        <ActionItemRow
          key={item.key}
          item={item}
          number={index + 1}
          error={(field) => (sentIndex.has(item.key) ? errors[`actionItems.${sentIndex.get(item.key)}.${field}`] : undefined)}
          onChange={(change) => onChange(item.key, change)}
          onRemove={() => onRemove(item.key)}
        />
      ))}
      <Button type="button" variant="secondary" onClick={onAdd}>
        Add an action
      </Button>
      <FieldError message={errors.actionItems} />
    </div>
  );
}
