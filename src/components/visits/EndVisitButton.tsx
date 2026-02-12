"use client";

import { useState, useRef } from "react";
import {
  getAccurateLocation,
  getAccuracyStatus,
  type LocationError,
} from "@/lib/geolocation";

type EndState =
  | { status: "idle" }
  | { status: "acquiring" }
  | { status: "submitting" }
  | { status: "done" }
  | { status: "error"; message: string; code?: string };

interface EndVisitButtonProps {
  visitId: number;
  alreadyEnded: boolean;
}

export default function EndVisitButton({
  visitId,
  alreadyEnded,
}: EndVisitButtonProps) {
  const [state, setState] = useState<EndState>(
    alreadyEnded ? { status: "done" } : { status: "idle" }
  );
  const [warning, setWarning] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  if (state.status === "done") {
    return null;
  }

  const handleEnd = async () => {
    setState({ status: "acquiring" });
    setWarning(null);

    const handle = getAccurateLocation();
    cancelRef.current = handle.cancel;

    let location;
    try {
      location = await handle.promise;
    } catch (err) {
      const locErr = err as LocationError;
      setState({ status: "error", message: locErr.message, code: locErr.code });
      return;
    }

    const accuracyStatus = getAccuracyStatus(location.accuracy);
    if (accuracyStatus === "moderate") {
      setWarning(
        `GPS accuracy is moderate (~${Math.round(location.accuracy)}m). Reading accepted.`
      );
    }

    setState({ status: "submitting" });

    try {
      const response = await fetch(`/api/pm/visits/${visitId}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          end_lat: location.lat,
          end_lng: location.lng,
          end_accuracy: location.accuracy,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to end visit");
      }

      setState({ status: "done" });
      // Reload to show updated server-rendered state
      window.location.reload();
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "An error occurred",
      });
    }
  };

  return (
    <div>
      {warning && (
        <div className="mb-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
          <p className="text-sm text-yellow-800">{warning}</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-md">
          <p className="text-sm text-red-800">{state.message}</p>
          {state.code === "PERMISSION_DENIED" && (
            <div className="mt-2 text-xs text-red-700 space-y-1">
              <p className="font-medium">How to enable location:</p>
              <ol className="list-decimal list-inside">
                <li>Tap the lock/settings icon in the address bar</li>
                <li>Set Location to &quot;Allow&quot;</li>
                <li>Reload the page</li>
              </ol>
            </div>
          )}
        </div>
      )}

      {state.status === "acquiring" && (
        <div className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-md mb-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm text-blue-800">Getting your location...</p>
          <button
            type="button"
            onClick={() => {
              cancelRef.current?.();
              setState({ status: "idle" });
            }}
            className="ml-auto text-sm text-blue-700 hover:text-blue-900 underline"
          >
            Cancel
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={handleEnd}
        disabled={state.status === "acquiring" || state.status === "submitting" || (state.status === "error" && state.code === "PERMISSION_DENIED")}
        className="w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {state.status === "submitting"
          ? "Ending visit..."
          : state.status === "acquiring"
            ? "Getting location..."
            : state.status === "error"
              ? state.code === "PERMISSION_DENIED"
                ? "Location blocked"
                : "Retry End Visit"
              : "End Visit"}
      </button>
    </div>
  );
}
