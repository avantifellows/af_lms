"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import LoadingLink from "@/components/LoadingLink";
import {
  getAccurateLocation,
  getAccuracyStatus,
  type LocationResult,
  type LocationError,
} from "@/lib/geolocation";

type GpsState =
  | { status: "idle" }
  | { status: "acquiring" }
  | { status: "acquired"; location: LocationResult }
  | { status: "error"; error: LocationError };

interface NewVisitFormProps {
  udise: string;
}

export default function NewVisitForm({ udise }: NewVisitFormProps) {
  const router = useRouter();
  const [gpsState, setGpsState] = useState<GpsState>({ status: "acquiring" });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const acquireLocation = useCallback(() => {
    setGpsState({ status: "acquiring" });
    setApiError(null);

    const handle = getAccurateLocation();
    cancelRef.current = handle.cancel;

    handle.promise
      .then((location) => {
        setGpsState({ status: "acquired", location });
      })
      .catch((err: LocationError) => {
        setGpsState({ status: "error", error: err });
      });
  }, []);

  // Start acquiring GPS on mount
  useEffect(() => {
    acquireLocation();
    return () => {
      cancelRef.current?.();
    };
  }, [acquireLocation]);

  const handleStartVisit = async () => {
    if (gpsState.status !== "acquired") return;

    setIsSubmitting(true);
    setApiError(null);

    try {
      const response = await fetch("/api/pm/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          school_code: udise,
          start_lat: gpsState.location.lat,
          start_lng: gpsState.location.lng,
          start_accuracy: gpsState.location.accuracy,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to create visit");
      }

      const data = await response.json();
      router.push(`/visits/${data.id}`);
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "An error occurred");
      setIsSubmitting(false);
    }
  };

  const accuracyStatus =
    gpsState.status === "acquired"
      ? getAccuracyStatus(gpsState.location.accuracy)
      : null;

  return (
    <main className="min-h-screen bg-bg px-4 sm:px-6 md:px-16 lg:px-32 xl:px-64 2xl:px-96 py-6 md:py-8">
      <div className="bg-bg-card border border-border p-6">
        <h1 className="text-2xl font-bold text-text-primary uppercase tracking-tight mb-6">
          Start New School Visit
        </h1>

        {/* School code display */}
        <div className="mb-6">
          <label className="block text-xs font-bold uppercase tracking-wide text-text-muted mb-1">
            School Code
          </label>
          <input
            type="text"
            value={udise}
            disabled
            className="w-full px-3 py-2 border-2 border-border bg-bg-card-alt text-text-secondary"
          />
        </div>

        {/* GPS Status */}
        <div className="mb-6">
          <label className="block text-xs font-bold uppercase tracking-wide text-text-muted mb-2">
            Location
          </label>

          {gpsState.status === "acquiring" && (
            <div className="flex items-center gap-3 p-4 bg-bg-card-alt border border-border">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <div>
                <p className="text-sm font-medium text-text-primary">
                  Getting your location...
                </p>
                <p className="text-xs text-text-secondary mt-1">
                  This may take a moment. Stay in an open area for best results.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  cancelRef.current?.();
                  setGpsState({ status: "idle" });
                }}
                className="ml-auto text-sm text-accent hover:text-accent-hover underline"
              >
                Cancel
              </button>
            </div>
          )}

          {gpsState.status === "acquired" && (
            <div
              className={`p-4 border ${
                accuracyStatus === "good"
                  ? "bg-success-bg border-border-accent"
                  : "bg-warning-bg border-warning-border"
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  accuracyStatus === "good"
                    ? "text-accent"
                    : "text-warning-text"
                }`}
              >
                {accuracyStatus === "good"
                  ? "Location acquired"
                  : "Location acquired (moderate accuracy)"}
              </p>
              <p
                className={`text-xs mt-1 font-mono ${
                  accuracyStatus === "good"
                    ? "text-text-secondary"
                    : "text-warning-text"
                }`}
              >
                Accuracy: ~{Math.round(gpsState.location.accuracy)}m
                {accuracyStatus === "moderate" &&
                  " — Reading accepted, but may be imprecise."}
              </p>
            </div>
          )}

          {gpsState.status === "error" && (
            <div className="p-4 bg-danger-bg border border-danger/20">
              <p className="text-sm font-medium text-danger">
                {gpsState.error.message}
              </p>
              {gpsState.error.code === "PERMISSION_DENIED" ? (
                <div className="mt-3 text-sm text-danger space-y-2">
                  <p className="font-medium">How to enable location:</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs">
                    <li>Tap the lock/settings icon in your browser&apos;s address bar</li>
                    <li>Find &quot;Location&quot; and set it to &quot;Allow&quot;</li>
                    <li>Reload the page</li>
                  </ol>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={acquireLocation}
                  className="mt-2 text-sm text-accent hover:text-accent-hover underline"
                >
                  Try again
                </button>
              )}
            </div>
          )}

          {gpsState.status === "idle" && (
            <button
              type="button"
              onClick={acquireLocation}
              className="w-full p-4 border-2 border-dashed border-border text-sm text-text-secondary hover:border-border-accent hover:text-text-primary"
            >
              Tap to get location
            </button>
          )}
        </div>

        {/* API Error */}
        {apiError && (
          <div className="mb-6 p-3 bg-danger-bg border border-danger/20" role="alert">
            <p className="text-sm text-danger">{apiError}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleStartVisit}
            disabled={gpsState.status !== "acquired" || isSubmitting}
            className="flex-1 py-2.5 px-5 border border-transparent text-sm font-bold uppercase tracking-wide text-text-on-accent bg-accent hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Starting..." : "Start Visit"}
          </button>
          <LoadingLink
            href={`/school/${udise}`}
            loadingText="Going back..."
            className="py-2.5 px-5 border border-border text-sm font-bold text-text-secondary bg-bg-card hover:bg-hover-bg disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel and go back
          </LoadingLink>
        </div>
      </div>

      <div className="mt-6 bg-success-bg border border-border-accent p-4">
        <h3 className="font-medium text-text-primary mb-2">Visit Workflow</h3>
        <p className="text-sm text-text-secondary mb-2">
          Once you start the visit, create action points as needed and move each
          action through its lifecycle:
        </p>
        <ol className="text-sm text-text-secondary list-decimal list-inside space-y-1">
          <li>Add an action point (for example, Classroom Observation or Principal Meeting).</li>
          <li>Start an action to capture start GPS and timestamp.</li>
          <li>Open in-progress actions to fill details and save updates.</li>
          <li>End each action to capture end GPS and mark it completed.</li>
          <li>Complete the visit after at least one Classroom Observation is completed and no action is in progress.</li>
        </ol>
      </div>
    </main>
  );
}
