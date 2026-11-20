"use client";

// The header of a Test Attendance student list: its title, the list filter
// buttons and Download. Shared by the month page and the All year page so the
// two lists look and behave the same. A Download that fails says so here.

import { useState } from "react";

import { Button } from "@/components/ui";

interface StudentListHeaderProps<Value extends string> {
  title: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
  /** Downloads the list as it is on screen; rejects when the file cannot be made. */
  onDownload: () => Promise<void>;
}

export default function StudentListHeader<Value extends string>({
  title,
  options,
  value,
  onChange,
  onDownload,
}: StudentListHeaderProps<Value>) {
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setFailed(false);
    try {
      await onDownload();
    } catch {
      setFailed(true);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-text-primary">{title}</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label="Show Students" className="inline-flex flex-wrap gap-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={value === option.value}
                onClick={() => onChange(option.value)}
                className={`min-h-[44px] rounded-md border px-3 text-xs font-bold transition-colors ${
                  value === option.value
                    ? "border-accent bg-accent text-text-on-accent"
                    : "border-border text-text-secondary hover:bg-hover-bg hover:text-text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void download()}>
            Download
          </Button>
        </div>
      </div>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          Couldn&apos;t download this list. Please try again.
        </p>
      )}
    </div>
  );
}
