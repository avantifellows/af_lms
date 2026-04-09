"use client";

import { useState } from "react";
import { baseInputClasses } from "./styles";

interface RemarkFieldProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
  /** Start revealed (e.g. when value already exists) */
  defaultRevealed?: boolean;
}

export function RemarkField({
  value,
  onChange,
  disabled,
  testId,
  defaultRevealed,
}: RemarkFieldProps) {
  const [revealed, setRevealed] = useState(defaultRevealed ?? value.length > 0);

  if (!revealed && !disabled) {
    return (
      <button
        type="button"
        onClick={() => setRevealed(true)}
        className="mt-2 min-h-[44px] rounded-lg px-3 py-2 text-xs font-medium text-accent underline hover:bg-hover-bg hover:text-accent-hover transition-colors"
      >
        Add remark
      </button>
    );
  }

  if (!revealed) return null;

  return (
    <label className="mt-2 block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
        Remark
      </span>
      <textarea
        rows={2}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional remark"
        className={`w-full ${baseInputClasses}`}
        data-testid={testId}
      />
    </label>
  );
}
