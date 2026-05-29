"use client";

import { useCallback, useEffect, useState } from "react";
import { DocumentCard } from "./DocumentCard";
import type { LmsStudentDocumentRow } from "@/lib/db-service-documents";

interface DocumentsListProps {
  studentId: number;
  /**
   * When this value changes the list refetches. Parent should bump it after
   * a successful upload so the new doc appears without remounting.
   */
  refreshNonce?: number | string;
  canDelete?: boolean;
}

export function DocumentsList({
  studentId,
  refreshNonce,
  canDelete = true,
}: DocumentsListProps) {
  const [docs, setDocs] = useState<LmsStudentDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/students/${studentId}/documents`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(`Failed to load documents (${res.status})`);
        setDocs([]);
        return;
      }
      const data: LmsStudentDocumentRow[] = await res.json();
      // Newest first. Server doesn't guarantee order.
      data.sort((a, b) => (a.inserted_at < b.inserted_at ? 1 : -1));
      setDocs(data);
    } catch (err) {
      console.error("DocumentsList fetch failed:", err);
      setError("Network error while loading documents.");
      setDocs([]);
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load, refreshNonce]);

  const handleDelete = useCallback(
    async (docId: number) => {
      const res = await fetch(`/api/students/${studentId}/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        throw new Error(`Delete failed (${res.status})`);
      }
      // Optimistic refresh — refetch to stay in sync with anything else.
      await load();
    },
    [studentId, load],
  );

  if (loading && docs === null) {
    return (
      <p className="font-mono text-xs text-text-muted" role="status">
        Loading documents…
      </p>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-danger-bg p-3 text-sm text-danger">
        {error}
      </div>
    );
  }

  if (!docs || docs.length === 0) {
    return (
      <p className="font-mono text-xs text-text-muted">
        No documents uploaded yet.
      </p>
    );
  }

  return (
    <div className="space-y-2" aria-label="Documents list">
      {docs.map((doc) => (
        <DocumentCard
          key={doc.id}
          doc={doc}
          onDelete={canDelete ? handleDelete : undefined}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}
