"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Plus, X } from "lucide-react";
import { Button, FormLabel, Select } from "@/components/ui";
import { DOCUMENT_TYPES, type DocumentType } from "@/lib/document-types";

const DEFAULT_DOCUMENT_TYPE: DocumentType = DOCUMENT_TYPES[0].value;
import { downscaleImage } from "@/lib/image-resize";
import { PageThumbnail } from "./PageThumbnail";

const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10 MB raw (pre-downscale)
const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5 MB
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
const PDF_MIME = "application/pdf";

type Mode = "photos" | "pdf";

interface PhotoPage {
  // Stable id used as React key. previewUrl can collide across photos in
  // tests (mocked URL.createObjectURL returns the same string), and using
  // the array index causes preview-flicker on removal.
  id: string;
  blob: Blob;
  previewUrl: string;
}

interface UploadDocumentFormProps {
  studentId: number;
  studentName: string;
  onUploaded?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadDocumentForm({
  studentId,
  studentName,
  onUploaded,
}: UploadDocumentFormProps) {
  const [mode, setMode] = useState<Mode>("photos");
  const [documentType, setDocumentType] = useState<DocumentType>(DEFAULT_DOCUMENT_TYPE);
  const [photos, setPhotos] = useState<PhotoPage[]>([]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // Tracks every blob:* URL we created so we can revoke on unmount regardless
  // of whether photos state has changed since. (An empty-deps closure over
  // `photos` would freeze the value at first render, leaking everything added
  // later.)
  const createdUrlsRef = useRef<Set<string>>(new Set());
  // Flipped to false on unmount so async resolutions don't setState after
  // teardown.
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    // Snapshot the ref so the cleanup closure iterates whatever Set instance
    // we set up on this mount (rather than a stale read of `.current` at
    // cleanup time, per react-hooks/exhaustive-deps).
    const created = createdUrlsRef.current;
    return () => {
      isMountedRef.current = false;
      for (const url of created) {
        URL.revokeObjectURL(url);
      }
      created.clear();
    };
  }, []);

  function revokeUrl(url: string) {
    URL.revokeObjectURL(url);
    createdUrlsRef.current.delete(url);
  }

  function resetForm() {
    for (const p of photos) revokeUrl(p.previewUrl);
    setPhotos([]);
    setPdf(null);
    setError(null);
  }

  function switchMode(next: Mode) {
    if (next === mode) return;
    resetForm();
    setMode(next);
  }

  async function onAddPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setError(null);

    if (!(PHOTO_MIMES as readonly string[]).includes(file.type)) {
      setError(`Unsupported image type: ${file.type || "unknown"}`);
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setError(`Image too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_PHOTO_BYTES)}.`);
      return;
    }
    if (photos.length >= MAX_PHOTOS) {
      setError(`Maximum ${MAX_PHOTOS} pages per document.`);
      return;
    }

    try {
      const blob = await downscaleImage(file);
      const previewUrl = URL.createObjectURL(blob);
      createdUrlsRef.current.add(previewUrl);
      setPhotos((prev) => [...prev, { id: crypto.randomUUID(), blob, previewUrl }]);
    } catch (err) {
      console.error("Downscale failed:", err);
      setError(
        file.type === "image/heic"
          ? "This phone may not support HEIC decoding in the browser. Try sharing the photo as JPEG."
          : "Could not process this image.",
      );
    }
  }

  function onSelectPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);

    if (file.type !== PDF_MIME) {
      setError(`File must be a PDF (got ${file.type || "unknown"}).`);
      return;
    }
    if (file.size > MAX_PDF_BYTES) {
      setError(`PDF too large (${formatBytes(file.size)}). Max ${formatBytes(MAX_PDF_BYTES)}.`);
      return;
    }
    setPdf(file);
  }

  function removePhoto(index: number) {
    setPhotos((prev) => {
      revokeUrl(prev[index].previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }

  function clearPdf() {
    setPdf(null);
  }

  const canSubmit =
    !submitting &&
    documentType.length > 0 &&
    (mode === "photos" ? photos.length > 0 : pdf !== null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const fd = new FormData();
    fd.set("document_type", documentType);

    if (mode === "photos") {
      photos.forEach((p, i) => {
        fd.set(`page_${i + 1}`, p.blob, `page-${i + 1}.jpg`);
      });
    } else if (pdf) {
      fd.set("page_1", pdf, pdf.name || "document.pdf");
    }

    try {
      const res = await fetch(`/api/students/${studentId}/documents`, {
        method: "POST",
        body: fd,
      });
      // Component may have unmounted while the upload was in flight; bail
      // before touching state to avoid React warnings + stale UI updates.
      if (!isMountedRef.current) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (!isMountedRef.current) return;
        setError(body?.error ?? `Upload failed (${res.status})`);
        return;
      }
      resetForm();
      onUploaded?.();
    } catch (err) {
      if (!isMountedRef.current) return;
      console.error("Upload failed:", err);
      setError("Network error — please try again.");
    } finally {
      if (isMountedRef.current) setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label={`Upload document for ${studentName}`}>
      {/* Mode toggle */}
      <div role="tablist" aria-label="Upload mode" className="flex border-b border-border">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "photos"}
          onClick={() => switchMode("photos")}
          className={`min-h-[48px] px-4 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${
            mode === "photos"
              ? "border-b-2 border-accent text-text-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          Photos
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "pdf"}
          onClick={() => switchMode("pdf")}
          className={`min-h-[48px] px-4 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${
            mode === "pdf"
              ? "border-b-2 border-accent text-text-primary"
              : "text-text-muted hover:text-text-primary"
          }`}
        >
          PDF
        </button>
      </div>

      <div>
        <FormLabel htmlFor="document_type">Document Type</FormLabel>
        <Select
          id="document_type"
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
        >
          {DOCUMENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </div>

      {mode === "photos" ? (
        <div>
          <FormLabel>Pages</FormLabel>
          <div className="flex flex-wrap gap-3">
            {photos.map((p, i) => (
              <PageThumbnail
                key={p.id}
                previewUrl={p.previewUrl}
                pageNumber={i + 1}
                onRemove={() => removePhoto(i)}
              />
            ))}
            {photos.length < MAX_PHOTOS && (
              <>
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  className="inline-flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-border bg-bg-card-alt text-text-muted shadow-sm transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Add page"
                >
                  <Plus className="h-6 w-6" />
                  <span className="text-xs font-bold uppercase tracking-wide">
                    Add page
                  </span>
                </button>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={onAddPhoto}
                />
              </>
            )}
          </div>
          {photos.length > 0 && (
            <p className="mt-2 font-mono text-xs text-text-muted">
              {photos.length} / {MAX_PHOTOS} pages
            </p>
          )}
        </div>
      ) : (
        <div>
          <FormLabel>PDF File</FormLabel>
          {pdf ? (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-card-alt p-3">
              <FileText className="h-6 w-6 shrink-0 text-accent" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-text-primary">{pdf.name}</p>
                <p className="font-mono text-xs text-text-muted">{formatBytes(pdf.size)}</p>
              </div>
              <button
                type="button"
                onClick={clearPdf}
                aria-label="Remove PDF"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-hover-bg hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => pdfInputRef.current?.click()}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-lg border-2 border-dashed border-border bg-bg-card-alt px-4 py-3 text-sm font-bold uppercase tracking-wide text-text-muted shadow-sm transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                <Plus className="h-5 w-5" />
                Select PDF
              </button>
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={onSelectPdf}
              />
            </>
          )}
          <p className="mt-2 font-mono text-xs text-text-muted">
            Max {formatBytes(MAX_PDF_BYTES)}
          </p>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger-bg p-3 text-sm text-danger"
        >
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={!canSubmit}>
          {submitting
            ? "Uploading…"
            : mode === "photos"
              ? `Upload ${photos.length || ""} ${photos.length === 1 ? "page" : "pages"}`.trim()
              : "Upload PDF"}
        </Button>
      </div>
    </form>
  );
}
