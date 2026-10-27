"use client";

import { useId } from "react";

import { FormLabel, Input } from "@/components/ui";
import { baseInputClasses } from "@/components/ui/styles";

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

export function TextAreaField({
  label,
  value,
  onChange,
  error,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  maxLength: number;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <FormLabel htmlFor={id}>{label}</FormLabel>
      <textarea
        id={id}
        rows={2}
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`block w-full resize-y ${baseInputClasses}`}
      />
      <div className="flex justify-between gap-3">
        <FieldError id={`${id}-error`} message={error} />
        <span className="ml-auto mt-1 shrink-0 font-mono text-xs text-text-muted">
          {value.length}/{maxLength}
        </span>
      </div>
    </div>
  );
}
