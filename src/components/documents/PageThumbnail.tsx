"use client";

import { X } from "lucide-react";

interface PageThumbnailProps {
  previewUrl: string;
  pageNumber: number;
  onRemove?: () => void;
  alt?: string;
}

export function PageThumbnail({
  previewUrl,
  pageNumber,
  onRemove,
  alt,
}: PageThumbnailProps) {
  return (
    <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-border shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={previewUrl}
        alt={alt ?? `Page ${pageNumber} preview`}
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-0 left-0 rounded-tr-md bg-bg-card/90 px-1.5 py-0.5 font-mono text-xs font-bold text-text-primary">
        {pageNumber}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove page ${pageNumber}`}
          className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
