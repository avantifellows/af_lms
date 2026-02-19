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
    <main className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="bg-white shadow rounded-lg p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          Start New School Visit
        </h1>

        {/* School code display */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            School Code
          </label>
          <input
            type="text"
            value={udise}
            disabled
            className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-600"
          />
        </div>

        {/* GPS Status */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Location
          </label>

          {gpsState.status === "acquiring" && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-md">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <div>
                <p className="text-sm font-medium text-blue-800">
                  Getting your location...
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  This may take a moment. Stay in an open area for best results.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  cancelRef.current?.();
                  setGpsState({ status: "idle" });
                }}
                className="ml-auto text-sm text-blue-700 hover:text-blue-900 underline"
              >
                Cancel
              </button>
            </div>
          )}

          {gpsState.status === "acquired" && (
            <div
              className={`p-4 rounded-md border ${
                accuracyStatus === "good"
                  ? "bg-green-50 border-green-200"
                  : "bg-yellow-50 border-yellow-200"
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  accuracyStatus === "good"
                    ? "text-green-800"
                    : "text-yellow-800"
                }`}
              >
                {accuracyStatus === "good"
                  ? "Location acquired"
                  : "Location acquired (moderate accuracy)"}
              </p>
              <p
                className={`text-xs mt-1 ${
                  accuracyStatus === "good"
                    ? "text-green-600"
                    : "text-yellow-600"
                }`}
              >
                Accuracy: ~{Math.round(gpsState.location.accuracy)}m
                {accuracyStatus === "moderate" &&
                  " — Reading accepted, but may be imprecise."}
              </p>
            </div>
          )}

          {gpsState.status === "error" && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm font-medium text-red-800">
                {gpsState.error.message}
              </p>
              {gpsState.error.code === "PERMISSION_DENIED" ? (
                <div className="mt-3 text-sm text-red-700 space-y-2">
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
                  className="mt-2 text-sm text-red-700 hover:text-red-900 underline"
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
              className="w-full p-4 border-2 border-dashed border-gray-300 rounded-md text-sm text-gray-600 hover:border-gray-400 hover:text-gray-700"
            >
              Tap to get location
            </button>
          )}
        </div>

        {/* API Error */}
        {apiError && (
          <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-sm text-red-800">{apiError}</p>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleStartVisit}
            disabled={gpsState.status !== "acquired" || isSubmitting}
            className="flex-1 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? "Starting..." : "Start Visit"}
          </button>
          <LoadingLink
            href={`/school/${udise}`}
            loadingText="Going back..."
            className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel and go back
          </LoadingLink>
        </div>
      </div>

      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-medium text-blue-900 mb-2">Visit Workflow</h3>
        <p className="text-sm text-blue-800 mb-2">
          Once you start the visit, create action points as needed and move each
          action through its lifecycle:
        </p>
        <ol className="text-sm text-blue-800 list-decimal list-inside space-y-1">
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
