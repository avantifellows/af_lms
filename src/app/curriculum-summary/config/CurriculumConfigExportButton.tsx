"use client";

import { useState } from "react";
import { Download } from "lucide-react";

interface CurriculumConfigExportButtonProps {
  exportHref: string;
}

export default function CurriculumConfigExportButton({
  exportHref,
}: CurriculumConfigExportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState("");

  async function handleExport() {
    setIsExporting(true);
    setError("");

    try {
      const response = await fetch(exportHref);
      if (!response.ok) {
        setError("Could not export Curriculum Config rows.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filenameFromDisposition(response.headers.get("content-disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not export Curriculum Config rows.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="button"
        onClick={handleExport}
        disabled={isExporting}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover disabled:text-text-muted"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {isExporting ? "Exporting" : "Export"}
      </button>
      {error ? (
        <p role="alert" className="max-w-xs text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function filenameFromDisposition(disposition: string | null): string {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? "curriculum-config.csv";
}
