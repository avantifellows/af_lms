"use client";

import { useId } from "react";

import { FormLabel, Input } from "@/components/ui";
import type { CommonItemOwner } from "@/lib/blended-learning-manage-input";

import { OwnerSelect } from "./OwnerSelect";

// The Manage page's labelled fields, each with its inline error.

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {message}
    </p>
  );
}

export function TextField({
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: "text" | "url";
  placeholder?: string;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

// An action item as the Mentor's log form lays one out: who does it and
// what, side by side (the owner on its own line on a phone), on one line
// with a character count against the cap.
export function ActionItemFields({
  text,
  owner,
  onTextChange,
  onOwnerChange,
  errors,
  maxLength,
}: {
  text: string;
  owner: CommonItemOwner;
  onTextChange: (text: string) => void;
  onOwnerChange: (owner: CommonItemOwner) => void;
  errors: { text?: string; owner?: string };
  maxLength: number;
}) {
  const id = useId();
  const describedBy = [errors.owner && `${id}-owner-error`, errors.text && `${id}-error`].filter(Boolean).join(" ");
  return (
    <div className="min-w-0">
      <FormLabel htmlFor={id}>Action item</FormLabel>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)] sm:items-start">
        <OwnerSelect value={owner} onChange={onOwnerChange} label="Who does it" />
        <Input
          id={id}
          type="text"
          value={text}
          placeholder="What will be done"
          maxLength={maxLength}
          onChange={(event) => onTextChange(event.target.value)}
          aria-invalid={Boolean(errors.text)}
          aria-describedby={describedBy || undefined}
        />
      </div>
      <div className="flex justify-between gap-3">
        <div className="min-w-0">
          <FieldError id={`${id}-owner-error`} message={errors.owner} />
          <FieldError id={`${id}-error`} message={errors.text} />
        </div>
        <span className="ml-auto mt-1 shrink-0 font-mono text-xs text-text-muted">
          {text.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}
