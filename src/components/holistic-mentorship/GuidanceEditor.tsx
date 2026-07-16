"use client";

import { useState } from "react";

import { baseInputClasses } from "@/components/ui";
import GuidancePreview from "./GuidancePreview";

export default function GuidanceEditor({
  value,
  previewValue = value,
  readOnly = false,
  onChange,
}: {
  value: string;
  previewValue?: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
}) {
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  return (
    <div className="space-y-2">
      <div role="group" aria-label="Guidance view" className="inline-flex rounded-md border border-border p-1 md:hidden">
        {(["edit", "preview"] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={mode === item}
            onClick={() => setMode(item)}
            className={`min-h-9 rounded px-3 text-sm font-medium ${mode === item ? "bg-accent text-text-on-accent" : "text-text-secondary"}`}
          >
            {item === "edit" ? "Edit" : "Preview"}
          </button>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <label className={`${mode === "edit" ? "block" : "hidden"} md:block`}>
          <span className="mb-1 block text-sm font-medium text-text-primary">Guidance Markdown</span>
          <textarea
            value={value}
            readOnly={readOnly}
            onChange={(event) => onChange(event.target.value)}
            rows={12}
            className={`w-full resize-y ${baseInputClasses}`}
          />
        </label>
        <div className={`${mode === "preview" ? "block" : "hidden"} min-h-64 border-l-0 border-border p-3 md:block md:border-l`}>
          <p className="mb-2 text-xs font-semibold uppercase text-text-muted">Preview</p>
          <GuidancePreview markdown={previewValue} />
        </div>
      </div>
    </div>
  );
}
