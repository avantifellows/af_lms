"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Upload } from "lucide-react";
import { Button } from "@/components/ui";
import { downscaleImage } from "@/lib/image-resize";
import {
  acknowledgementLabel,
  type ExamAcknowledgement,
} from "@/lib/exam-acknowledgements";

// One file per acknowledgement: a single photo or a single PDF. Size limits
// match the server's check (`src/lib/document-upload.ts`).
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const PHOTO_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const PDF_MIME = "application/pdf";
const ACCEPT = [...PHOTO_MIMES, PDF_MIME].join(",");

interface ExamAcknowledgementSlotProps {
  studentId: number;
  recordId: number;
  examName: string;
  /** The sitting (JEE Mains Session 1 or 2), or null for an exam without sessions. */
  session: number | null;
  acknowledgement: ExamAcknowledgement | undefined;
  /** The slot's new acknowledgement after an upload, or null after a removal. */
  onChange: (acknowledgement: ExamAcknowledgement | null) => void;
}

interface Picked {
  blob: Blob;
  /** The chosen file's own name, shown before the upload. */
  name: string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

/** Turn the chosen file into what the upload sends, or say why it can't. */
async function pickFile(
  file: File,
): Promise<{ ok: true; picked: Picked } | { ok: false; error: string }> {
  if (file.type === PDF_MIME) {
    if (file.size > MAX_PDF_BYTES) {
      return { ok: false, error: `PDF too large. Max ${formatMb(MAX_PDF_BYTES)}.` };
    }
    return { ok: true, picked: { blob: file, name: file.name } };
  }
  if (!PHOTO_MIMES.includes(file.type)) {
    return { ok: false, error: "Choose a photo (JPEG, PNG, WebP, HEIC) or a PDF." };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: `Photo too large. Max ${formatMb(MAX_PHOTO_BYTES)}.` };
  }
  try {
    return { ok: true, picked: { blob: await downscaleImage(file), name: file.name } };
  } catch {
    return {
      ok: false,
      error:
        file.type === "image/heic"
          ? "This phone may not support HEIC in the browser. Try sharing the photo as JPEG."
          : "Could not process this image.",
    };
  }
}

/**
 * One acknowledgement slot under an exam on the Exams tab: the stored file
 * (one photo or PDF) to open, Replace and Remove; or, when none is stored, an
 * upload. Uploads and removals take effect immediately — they
 * don't wait for Save Exams.
 */
// fallow-ignore-next-line complexity
export function ExamAcknowledgementSlot({
  studentId,
  recordId,
  examName,
  session,
  acknowledgement,
  onChange,
}: ExamAcknowledgementSlotProps) {
  const label = acknowledgementLabel(session);
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (list.length === 0) return;
    if (list.length > 1) {
      setError("Choose one file: a photo or a PDF.");
      return;
    }
    setError(null);
    const result = await pickFile(list[0]);
    if (!mounted.current) return;
    if (result.ok) setPicked(result.picked);
    else setError(result.error);
  }

  async function upload() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    if (session !== null) form.set("exam_session", String(session));
    form.set("page_1", picked.blob, picked.name);
    try {
      const res = await fetch(
        `/api/students/${studentId}/exam-records/${recordId}/acknowledgement`,
        { method: "POST", body: form },
      );
      const data = await res.json().catch(() => ({}));
      if (!mounted.current) return;
      if (!res.ok) {
        setError(data.error || `Upload failed (${res.status})`);
        return;
      }
      setPicked(null);
      onChange(data as ExamAcknowledgement);
    } catch {
      if (mounted.current) setError("Network error — please try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  async function remove() {
    if (!acknowledgement) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/students/${studentId}/exam-records/${recordId}/acknowledgement?document_id=${acknowledgement.id}`,
        { method: "DELETE" },
      );
      if (!mounted.current) return;
      if (!res.ok && res.status !== 404) {
        const data = await res.json().catch(() => ({}));
        if (!mounted.current) return;
        setError(data.error || `Could not remove (${res.status})`);
        return;
      }
      setConfirmRemove(false);
      onChange(null);
    } catch {
      if (mounted.current) setError("Network error — please try again.");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="hidden"
      onChange={(event) => void onPick(event)}
      aria-label={`Choose ${examName} ${label.toLowerCase()} file`}
    />
  );

  return (
    <div
      className="rounded-lg border border-border bg-bg-card-alt p-3"
      data-testid={`ack-slot-${recordId}-${session ?? "single"}`}
    >
      {fileInput}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        {acknowledgement && !picked && (
          <div className="flex items-center gap-1">
            {confirmRemove ? (
              <>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void remove()}
                  aria-label={`Confirm removing ${examName} ${label.toLowerCase()}`}
                >
                  {busy ? "Removing…" : "Confirm remove"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => inputRef.current?.click()}
                  aria-label={`Replace ${examName} ${label.toLowerCase()}`}
                >
                  Replace
                </Button>
                <Button
                  variant="danger-ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmRemove(true)}
                  aria-label={`Remove ${examName} ${label.toLowerCase()}`}
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        )}
      </div>

      {acknowledgement && !picked && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {acknowledgement.pages[0]?.mime_type === PDF_MIME ? (
            <FileText className="h-4 w-4 text-accent" aria-hidden="true" />
          ) : (
            <ImageIcon className="h-4 w-4 text-accent" aria-hidden="true" />
          )}
          <span className="font-mono text-xs text-text-muted">
            {formatDate(acknowledgement.uploaded_at)} · {acknowledgement.uploaded_by}
          </span>
          <a
            href={`/api/students/${studentId}/documents/${acknowledgement.id}/page/${
              acknowledgement.pages[0]?.page_number ?? 1
            }`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${examName} ${label.toLowerCase()}`}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-border bg-bg-card px-2 text-xs font-bold text-accent hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Open
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      )}

      {!acknowledgement && !picked && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => inputRef.current?.click()}
          aria-label={`Upload ${examName} ${label.toLowerCase()}`}
        >
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Upload photo or PDF
        </Button>
      )}

      {picked && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-muted">
            {picked.name}
            {acknowledgement ? " · replaces the current one" : ""}
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            onClick={() => void upload()}
            aria-label={`Save ${examName} ${label.toLowerCase()}`}
          >
            {busy ? "Uploading…" : "Upload"}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setPicked(null)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
