"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";

interface LinkedBatch {
  id: number;
  batch_pk: number;
  batch_id: string;
  name: string;
}

interface BatchSearchResult {
  id: number;
  batch_id: string;
  name: string;
}

interface Props {
  centreId: number;
  centreName: string;
  onClose: () => void;
  /** Called after a successful link/unlink so the grid can refresh its count. */
  onChanged?: (linkedCount: number) => void;
}

export default function ManageBatchesModal({
  centreId,
  centreName,
  onClose,
  onChanged,
}: Props) {
  const [linked, setLinked] = useState<LinkedBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<BatchSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const linkedIds = new Set(linked.map((b) => b.batch_id));

  const loadLinked = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/centres/${centreId}/batches`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to load batches");
        return;
      }
      setLinked(data.batches ?? []);
      onChanged?.((data.batches ?? []).length);
    } catch {
      setError("Failed to load batches");
    } finally {
      setLoading(false);
    }
  }, [centreId, onChanged]);

  useEffect(() => {
    void loadLinked();
  }, [loadLinked]);

  // Debounced batch search.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = search.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/batches/search?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        if (res.ok) setResults(data.batches ?? []);
      } catch {
        // leave prior results; the input still works
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  const link = async (batchId: string) => {
    setBusyBatchId(batchId);
    setError("");
    try {
      const res = await fetch(`/api/admin/centres/${centreId}/batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to link batch");
        return;
      }
      setLinked(data.batches ?? []);
      onChanged?.((data.batches ?? []).length);
    } catch {
      setError("Failed to link batch");
    } finally {
      setBusyBatchId(null);
    }
  };

  const unlink = async (batchId: string) => {
    setBusyBatchId(batchId);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/centres/${centreId}/batches/${encodeURIComponent(batchId)}`,
        { method: "DELETE" }
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to unlink batch");
        return;
      }
      setLinked(data.batches ?? []);
      onChanged?.((data.batches ?? []).length);
    } catch {
      setError("Failed to unlink batch");
    } finally {
      setBusyBatchId(null);
    }
  };

  const addable = results.filter((r) => !linkedIds.has(r.batch_id));

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-text-primary/35" onClick={onClose} aria-hidden="true" />
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Manage batches for ${centreName}`}
          className="relative w-full max-w-lg rounded-lg border border-border bg-bg-card shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-base font-semibold text-text-primary">
              Manage Batches — {centreName}
            </h3>
            <Button variant="icon" aria-label="Close" onClick={onClose}>
              ✕
            </Button>
          </div>

          <div className="space-y-4 px-4 py-4">
            {error && (
              <p className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger-text">
                {error}
              </p>
            )}

            {/* Search + add */}
            <div>
              <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-text-muted">
                Add a batch
              </label>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or batch id…"
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text-primary"
              />
              {search.trim().length >= 2 && (
                <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border">
                  {searching && addable.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-text-muted">Searching…</p>
                  ) : addable.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-text-muted">
                      No unlinked batches match.
                    </p>
                  ) : (
                    addable.map((b) => (
                      <button
                        key={b.batch_id}
                        type="button"
                        onClick={() => link(b.batch_id)}
                        disabled={busyBatchId === b.batch_id}
                        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-hover-bg disabled:opacity-50"
                      >
                        <span>
                          <span className="text-text-primary">{b.name}</span>{" "}
                          <span className="text-xs text-text-muted">{b.batch_id}</span>
                        </span>
                        <span className="text-xs font-semibold text-accent">+ Add</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Linked list */}
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-text-muted">
                Linked batches ({linked.length})
              </p>
              {loading ? (
                <p className="text-sm text-text-muted">Loading…</p>
              ) : linked.length === 0 ? (
                <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-text-muted">
                  No batches linked yet.
                </p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {linked.map((b) => (
                    <li
                      key={b.batch_id}
                      className="flex items-center justify-between px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="text-text-primary">{b.name}</span>{" "}
                        <span className="text-xs text-text-muted">{b.batch_id}</span>
                      </span>
                      <Button
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => unlink(b.batch_id)}
                        disabled={busyBatchId === b.batch_id}
                      >
                        Remove
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex justify-end border-t border-border px-4 py-3">
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
