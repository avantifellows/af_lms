"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";

import Toast from "@/components/Toast";
import { Modal } from "@/components/ui";

interface DeleteVisitButtonProps {
  visitId: number;
  mode: "detail" | "list";
}

function parseApiError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const error = "error" in payload ? payload.error : null;
  return typeof error === "string" && error.trim().length > 0 ? error : fallback;
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function DeleteVisitButton({ visitId, mode }: DeleteVisitButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dismissError = useCallback(() => setError(null), []);

  async function handleDelete() {
    setError(null);
    setIsDeleting(true);

    try {
      const response = await fetch(`/api/pm/visits/${visitId}`, {
        method: "DELETE",
      });
      const payload = await readJsonSafely(response);

      if (!response.ok) {
        setError(parseApiError(payload, "Failed to delete visit"));
        return;
      }

      flushSync(() => {
        setIsOpen(false);
      });
      if (mode === "detail") {
        router.push("/visits");
      } else {
        router.refresh();
      }
    } catch {
      setError("Failed to delete visit");
    } finally {
      setIsDeleting(false);
    }
  }

  const triggerClassName =
    mode === "detail"
      ? "inline-flex items-center justify-center rounded-lg border-2 border-danger/40 bg-bg-card px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-danger hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50"
      : "inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border-2 border-danger/40 bg-bg-card px-4 py-2.5 text-sm font-bold uppercase tracking-wide text-danger hover:bg-danger-bg disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 sm:w-auto sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none sm:hover:bg-transparent sm:hover:text-danger/80";

  return (
    <>
      {error && (
        <Toast variant="error" message={error} onDismiss={dismissError} />
      )}

      <button
        type="button"
        onClick={() => {
          setError(null);
          setIsOpen(true);
        }}
        disabled={isDeleting}
        className={triggerClassName}
      >
        {mode === "detail" ? "Delete Visit" : "Delete"}
      </button>

      <Modal
        open={isOpen}
        onClose={isDeleting ? undefined : () => setIsOpen(false)}
        className="max-w-md"
      >
        <div role="dialog" aria-modal="true" aria-labelledby="delete-visit-title">
          <div className="border-b-4 border-danger/30 px-5 py-4">
            <h3 id="delete-visit-title" className="text-base font-bold uppercase tracking-tight text-text-primary">
              Delete Visit
            </h3>
          </div>
          <div className="px-5 py-4">
            <p className="text-sm text-text-secondary">
              This visit and all its action points will be removed. This cannot be undone.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-4">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              disabled={isDeleting}
              className="inline-flex items-center border border-border bg-bg-card px-3 py-2 text-sm font-medium text-text-secondary hover:bg-hover-bg disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                void handleDelete();
              }}
              disabled={isDeleting}
              className="inline-flex items-center bg-danger px-3 py-2 text-sm font-bold uppercase text-white hover:bg-danger/80 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
