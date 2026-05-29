"use client";

import { useState } from "react";
import { ExternalLink, FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { isValidDocumentType, labelFor } from "@/lib/document-types";
import type { LmsStudentDocumentRow } from "@/lib/db-service-documents";

interface DocumentCardProps {
  doc: LmsStudentDocumentRow;
  onDelete?: (id: number) => Promise<void> | void;
  canDelete?: boolean;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isPdfDoc(doc: LmsStudentDocumentRow): boolean {
  return doc.pages?.[0]?.mime_type === "application/pdf";
}

export function DocumentCard({ doc, onDelete, canDelete = true }: DocumentCardProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdf = isPdfDoc(doc);
  const typeLabel = isValidDocumentType(doc.document_type)
    ? labelFor(doc.document_type)
    : doc.document_type;
  const pageCount = doc.pages?.length ?? 0;

  async function handleDelete() {
    if (!onDelete) return;
    setError(null);
    setDeleting(true);
    try {
      await onDelete(doc.id);
    } catch (err) {
      console.error("Delete failed:", err);
      setError("Couldn't delete — please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card elevation="sm" className="p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-card-alt text-accent">
          {pdf ? <FileText className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-text-primary">{typeLabel}</h3>
            <Badge variant={pdf ? "info" : "accent"}>
              {pdf ? "PDF" : pageCount === 1 ? "1 page" : `${pageCount} pages`}
            </Badge>
          </div>
          <p className="mt-1 font-mono text-xs text-text-muted">
            {formatDate(doc.inserted_at)} · {doc.uploaded_by}
          </p>
        </div>
        {canDelete && onDelete && (
          <Button
            variant="danger-ghost"
            size="sm"
            onClick={handleDelete}
            disabled={deleting}
            aria-label={`Delete ${typeLabel}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
      {pageCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <span className="text-xs font-bold uppercase tracking-wide text-text-muted">
            View:
          </span>
          {pageCount === 1 ? (
            <a
              href={`/api/students/${doc.student_id}/documents/${doc.id}/page/${doc.pages[0].page_number}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-accent transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              Open
            </a>
          ) : (
            doc.pages.map((p) => (
              <a
                key={p.page_number}
                href={`/api/students/${doc.student_id}/documents/${doc.id}/page/${p.page_number}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open page ${p.page_number}`}
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-border bg-bg-card px-2 font-mono text-xs font-bold text-accent shadow-sm transition-colors hover:bg-hover-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {p.page_number}
              </a>
            ))
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
