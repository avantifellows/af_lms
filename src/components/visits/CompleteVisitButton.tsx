"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getAccurateLocation } from "@/lib/geolocation";

type CompleteState = "idle" | "acquiring" | "submitting";

interface CompleteVisitButtonProps {
  visitId: number;
  disabled?: boolean;
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message;
  }

  return fallback;
}

function parseApiError(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "Failed to complete visit";
  }

  const maybeError = "error" in payload ? payload.error : null;
  const maybeDetails = "details" in payload ? payload.details : null;

  const error = typeof maybeError === "string" ? maybeError : "Failed to complete visit";
  if (Array.isArray(maybeDetails) && maybeDetails.length > 0) {
    return `${error}: ${maybeDetails.join("; ")}`;
  }

  return error;
}

export default function CompleteVisitButton({ visitId, disabled = false }: CompleteVisitButtonProps) {
  const router = useRouter();
  const cancelRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<CompleteState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const isBusy = state !== "idle";

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

      const payload: unknown = await response.json();
      if (!response.ok) {
        throw new Error(parseApiError(payload));
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
      setError(extractErrorMessage(err, "Failed to complete visit"));
    }
  }

  return (
    <div className="space-y-2">
      {warning && (
        <p className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md px-3 py-2">
          {warning}
        </p>
      )}

      {error && (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {state === "acquiring" && (
        <div className="flex items-center justify-between gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2">
          <span className="text-sm text-blue-800">Getting your location...</span>
          <button
            type="button"
            onClick={() => {
              cancelRef.current?.();
            }}
            className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
          >
            Cancel
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handleCompleteVisit}
        disabled={disabled || isBusy}
        className="inline-flex items-center rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
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
