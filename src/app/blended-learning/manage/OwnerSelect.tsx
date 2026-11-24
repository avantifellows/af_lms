"use client";

import { COMMON_ITEM_OWNERS, type CommonItemOwner } from "@/lib/blended-learning-manage-input";

import { BlendedSelect } from "../BlendedSelect";
import { ACTION_ITEM_OWNER } from "../students/[id]/ActionItemMeta";

// Who does a Common Action Item: Student, Mentor or Parent, as on the log form.
export function OwnerSelect({
  id,
  value,
  onChange,
  label,
}: {
  id?: string;
  value: CommonItemOwner;
  onChange: (owner: CommonItemOwner) => void;
  label?: string;
}) {
  return (
    <BlendedSelect
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as CommonItemOwner)}
    >
      {COMMON_ITEM_OWNERS.map((owner) => (
        <option key={owner} value={owner}>
          {ACTION_ITEM_OWNER[owner]}
        </option>
      ))}
    </BlendedSelect>
  );
}
