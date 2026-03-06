"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Toast from "@/components/Toast";
import { getAccurateLocation } from "@/lib/geolocation";

type CompleteState = "idle" | "acquiring" | "submitting";

interface CompleteVisitButtonProps {
  visitId: number;
  disabled?: boolean;
}

interface StructuredError {
  message: string;
  details: string[];
}

function readErrorDetails(details: unknown): string[] {
  if (!Array.isArray(details)) {
    return [];
  }

  return details.filter((detail): detail is string => typeof detail === "string" && detail.length > 0);
}

function parseApiError(payload: unknown): StructuredError {
  if (!payload || typeof payload !== "object") {
    return { message: "Failed to complete visit", details: [] };
  }

  const maybeError = "error" in payload ? payload.error : null;
  const maybeDetails = "details" in payload ? payload.details : null;

  return {
    message: typeof maybeError === "string" ? maybeError : "Failed to complete visit",
    details: readErrorDetails(maybeDetails),
  };
}

function extractErrorState(error: unknown, fallback: string): StructuredError {
  if (error instanceof Error && error.message) {
    return { message: error.message, details: [] };
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    const details = "details" in error ? readErrorDetails(error.details) : [];
    return { message: error.message, details };
  }

  return { message: fallback, details: [] };
}

async function readJsonSafely(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export default function CompleteVisitButton({ visitId, disabled = false }: CompleteVisitButtonProps) {
  const router = useRouter();
  const cancelRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<CompleteState>("idle");
  const [error, setError] = useState<StructuredError | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const isBusy = state !== "idle";
  const dismissError = useCallback(() => setError(null), []);
  const dismissWarning = useCallback(() => setWarning(null), []);

  async function handleCompleteVisit() {
    if (disabled || isBusy) {
      return;
    }

    setError(null);
    setWarning(null);
    setState("acquiring");

    try {
      const handle = getAccurateLocation();
      cancelRef.current = handle.cancel;
      const location = await handle.promise;

      setState("submitting");

      const response = await fetch(`/api/pm/visits/${visitId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          end_lat: location.lat,
          end_lng: location.lng,
          end_accuracy: location.accuracy,
        }),
      });

      const payload = await readJsonSafely(response);
      if (!response.ok) {
        setError(parseApiError(payload));
        setState("idle");
        return;
      }

      if (
        payload &&
        typeof payload === "object" &&
        "warning" in payload &&
        typeof payload.warning === "string"
      ) {
        setWarning(payload.warning);
      }

      setState("idle");
      router.refresh();
    } catch (err) {
      setState("idle");
      setError(extractErrorState(err, "Failed to complete visit"));
    }
  }

  return (
    <div className="space-y-2">
      {warning && (
        <Toast variant="warning" message={warning} onDismiss={dismissWarning} />
      )}

      {error && (
        <Toast variant="error" message={error.message} details={error.details} onDismiss={dismissError} />
      )}

      {state === "acquiring" && (
        <div className="flex items-center justify-between gap-3 border border-border bg-bg-card-alt px-3 py-2">
          <span className="text-sm text-text-primary">Getting your location...</span>
          <button
            type="button"
            onClick={() => {
              cancelRef.current?.();
            }}
            className="text-xs font-medium text-accent underline hover:text-accent-hover"
          >
            Cancel
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handleCompleteVisit}
        disabled={disabled || isBusy}
        className="inline-flex items-center bg-accent px-5 py-2.5 text-sm font-bold uppercase tracking-wide text-text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
      >
        {state === "acquiring"
          ? "Acquiring location..."
          : state === "submitting"
            ? "Completing..."
            : "Complete Visit"}
      </button>
    </div>
  );
}
