// Client-side geolocation helper for school visit GPS capture.
// Uses watchPosition to progressively improve accuracy.

const TIMEOUT_MS = 60_000;
const MAX_ACCURACY_METERS = 500;
const GOOD_ACCURACY_METERS = 100;

export interface LocationResult {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface LocationError {
  code: "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "INSECURE_ORIGIN" | "NOT_SUPPORTED";
  message: string;
}

export interface AccurateLocationHandle {
  promise: Promise<LocationResult>;
  cancel: () => void;
}

function isSecureOrigin(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol === "https:") return true;
  if (hostname === "localhost" || hostname === "127.0.0.1") return true;
  return false;
}

/**
 * Get an accurate GPS location using watchPosition.
 * Resolves when accuracy <= 100m or best reading before 60s timeout.
 * Rejects if accuracy never reaches <= 500m, or on permission error.
 *
 * Returns { promise, cancel } so the caller can abort early (e.g. unmount).
 */
export function getAccurateLocation(): AccurateLocationHandle {
  let cancelFn: () => void = () => {};

  const promise = new Promise<LocationResult>((resolve, reject) => {
    if (!isSecureOrigin()) {
      reject({
        code: "INSECURE_ORIGIN",
        message: "Location requires HTTPS. Please access the app via a secure connection.",
      } satisfies LocationError);
      return;
    }

    if (!navigator.geolocation) {
      reject({
        code: "NOT_SUPPORTED",
        message: "Geolocation is not supported by this browser.",
      } satisfies LocationError);
      return;
    }

    let watchId: number | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let bestReading: LocationResult | null = null;
    let settled = false;

    const cleanup = () => {
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    };

    const settle = (
      action: "resolve" | "reject",
      value: LocationResult | LocationError
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (action === "resolve") {
        resolve(value as LocationResult);
      } else {
        reject(value as LocationError);
      }
    };

    cancelFn = () => {
      settle("reject", {
        code: "TIMEOUT",
        message: "Location request was cancelled.",
      });
    };

    // Timeout: resolve with best reading if acceptable, otherwise reject
    timeoutId = setTimeout(() => {
      if (bestReading && bestReading.accuracy <= MAX_ACCURACY_METERS) {
        settle("resolve", bestReading);
      } else {
        settle("reject", {
          code: "TIMEOUT",
          message: bestReading
            ? `Could not get accurate location (best: ${Math.round(bestReading.accuracy)}m). Move to an open area and try again.`
            : "Could not get your location. Check that location services are enabled and try again.",
        });
      }
    }, TIMEOUT_MS);

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        const reading: LocationResult = {
          lat: latitude,
          lng: longitude,
          accuracy: accuracy,
        };

        // Keep the best (most accurate) reading
        if (!bestReading || accuracy < bestReading.accuracy) {
          bestReading = reading;
        }

        // Good enough — resolve immediately
        if (accuracy <= GOOD_ACCURACY_METERS) {
          settle("resolve", reading);
        }
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            settle("reject", {
              code: "PERMISSION_DENIED",
              message: "Location permission was denied. To fix this, tap the lock/settings icon in your browser's address bar, set Location to \"Allow\", then reload the page.",
            });
            break;
          case error.POSITION_UNAVAILABLE:
            settle("reject", {
              code: "POSITION_UNAVAILABLE",
              message: "Location information is unavailable. Please check your device settings.",
            });
            break;
          case error.TIMEOUT:
            // watchPosition timeout — let our own timeout handle fallback
            break;
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: TIMEOUT_MS,
      }
    );
  });

  return { promise, cancel: () => cancelFn() };
}

/**
 * Returns a human-readable accuracy status for UI display.
 */
export function getAccuracyStatus(accuracy: number): "good" | "moderate" | "poor" {
  if (accuracy <= GOOD_ACCURACY_METERS) return "good";
  if (accuracy <= MAX_ACCURACY_METERS) return "moderate";
  return "poor";
}
