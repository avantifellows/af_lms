// Client-side geolocation helper for school visit GPS capture.
// Uses watchPosition to progressively improve accuracy.

const TIMEOUT_MS = 60_000;
const MAX_ACCURACY_METERS = 500;
const GOOD_ACCURACY_METERS = 100;
const GPS_DEBUG_PARAM = "debugGps";

let gpsAttemptSequence = 0;

interface NetworkInformation {
  type?: string;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
}

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

function getConnectionDiagnostics() {
  const connection = (
    navigator as Navigator & { connection?: NetworkInformation }
  ).connection;
  if (!connection) return null;

  return {
    type: connection.type,
    effectiveType: connection.effectiveType,
    downlinkMbps: connection.downlink,
    roundTripTimeMs: connection.rtt,
    saveData: connection.saveData,
  };
}

function getDocumentDiagnostics() {
  if (typeof document === "undefined") {
    return { visibilityState: null, documentFocused: null };
  }
  return {
    visibilityState: document.visibilityState,
    documentFocused: document.hasFocus(),
  };
}

function getEnvironmentDiagnostics() {
  return {
    protocol: window.location.protocol,
    hostname: window.location.hostname,
    secureOrigin: isSecureOrigin(),
    isSecureContext: window.isSecureContext,
    topLevelContext: window.top === window.self,
    ...getDocumentDiagnostics(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    language: navigator.language,
    online: navigator.onLine,
    cookieEnabled: navigator.cookieEnabled,
    geolocationSupported: Boolean(navigator.geolocation),
    permissionsApiSupported: Boolean(navigator.permissions?.query),
    connection: getConnectionDiagnostics(),
  };
}

function createGpsDiagnostics() {
  const enabled =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get(GPS_DEBUG_PARAM) === "1";
  const startedAt = Date.now();
  const attemptId = `${startedAt.toString(36)}-${++gpsAttemptSequence}`;
  const diagnostics = {
    enabled,
    permissionState: "unknown" as PermissionState | "unknown",
    write(
      level: "info" | "warn" | "error",
      event: string,
      details: Record<string, unknown> = {}
    ) {
      if (!enabled) return;
      console[level]("[GPS diagnostics]", {
        attemptId,
        event,
        elapsedMs: Date.now() - startedAt,
        ...details,
      });
    },
  };

  if (!enabled) return diagnostics;

  diagnostics.write("info", "attempt-started", getEnvironmentDiagnostics());

  return diagnostics;
}

type GpsDiagnostics = ReturnType<typeof createGpsDiagnostics>;

function logGeolocationPermission(diagnostics: GpsDiagnostics) {
  if (!diagnostics.enabled || !navigator.permissions?.query) return;

  void navigator.permissions
    .query({ name: "geolocation" })
    .then((status) => {
      diagnostics.permissionState = status.state;
      diagnostics.write("info", "permission-state", {
        state: status.state,
      });
    })
    .catch((error: unknown) => {
      diagnostics.write("warn", "permission-query-failed", {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    });
}

function positionErrorName(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) return "PERMISSION_DENIED";
  if (error.code === error.POSITION_UNAVAILABLE) return "POSITION_UNAVAILABLE";
  if (error.code === error.TIMEOUT) return "TIMEOUT";
  return "UNKNOWN";
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
    const diagnostics = createGpsDiagnostics();
    const secureOrigin = isSecureOrigin();

    if (!secureOrigin) {
      diagnostics.write("error", "preflight-failed", {
        code: "INSECURE_ORIGIN",
      });
      reject({
        code: "INSECURE_ORIGIN",
        message: "Location requires HTTPS. Please access the app via a secure connection.",
      } satisfies LocationError);
      return;
    }

    if (!navigator.geolocation) {
      diagnostics.write("error", "preflight-failed", {
        code: "NOT_SUPPORTED",
      });
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
    let readingCount = 0;
    let errorCount = 0;

    const cleanup = () => {
      diagnostics.write("info", "cleanup", {
        watchActive: watchId !== null,
        timeoutActive: timeoutId !== null,
      });
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
      diagnostics.write(
        action === "resolve" ? "info" : "error",
        "settled",
        {
          outcome: action,
          code:
            action === "resolve"
              ? "SUCCESS"
              : (value as LocationError).code,
          accuracyMeters:
            action === "resolve"
              ? Math.round((value as LocationResult).accuracy)
              : null,
          readingCount,
          errorCount,
          bestAccuracyMeters:
            bestReading === null ? null : Math.round(bestReading.accuracy),
          permissionState: diagnostics.permissionState,
        }
      );
      cleanup();
      if (action === "resolve") {
        resolve(value as LocationResult);
      } else {
        reject(value as LocationError);
      }
    };

    cancelFn = () => {
      diagnostics.write("warn", "cancel-requested");
      settle("reject", {
        code: "TIMEOUT",
        message: "Location request was cancelled.",
      });
    };

    logGeolocationPermission(diagnostics);

    // Timeout: resolve with best reading if acceptable, otherwise reject
    timeoutId = setTimeout(() => {
      diagnostics.write("warn", "outer-timeout", {
        hasReading: bestReading !== null,
        bestAccuracyMeters:
          bestReading === null ? null : Math.round(bestReading.accuracy),
        readingCount,
        errorCount,
      });
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

    diagnostics.write("info", "watch-requested", {
      enableHighAccuracy: true,
      maximumAgeMs: 0,
      browserTimeoutMs: TIMEOUT_MS,
      appTimeoutMs: TIMEOUT_MS,
      goodAccuracyMeters: GOOD_ACCURACY_METERS,
      maximumAcceptedAccuracyMeters: MAX_ACCURACY_METERS,
    });

    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        readingCount += 1;
        const reading: LocationResult = {
          lat: latitude,
          lng: longitude,
          accuracy: accuracy,
        };

        // Keep the best (most accurate) reading
        const improvedBest =
          bestReading === null || accuracy < bestReading.accuracy;
        if (improvedBest) {
          bestReading = reading;
        }

        diagnostics.write("info", "position-received", {
          readingCount,
          coordinatesFinite:
            Number.isFinite(latitude) && Number.isFinite(longitude),
          accuracyMeters: Math.round(accuracy),
          improvedBest,
          bestAccuracyMeters: Math.round((bestReading ?? reading).accuracy),
          goodEnough: accuracy <= GOOD_ACCURACY_METERS,
          positionAgeMs:
            typeof position.timestamp === "number"
              ? Math.max(0, Date.now() - position.timestamp)
              : null,
        });

        // Good enough — resolve immediately
        if (accuracy <= GOOD_ACCURACY_METERS) {
          settle("resolve", reading);
        }
      },
      (error) => {
        errorCount += 1;
        diagnostics.write(
          error.code === error.PERMISSION_DENIED ? "error" : "warn",
          "position-error",
          {
            errorCount,
            errorCode: error.code,
            errorName: positionErrorName(error),
            browserMessage: error.message,
            permissionState: diagnostics.permissionState,
            hasReading: bestReading !== null,
            bestAccuracyMeters:
              bestReading === null ? null : Math.round(bestReading.accuracy),
          }
        );

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
    diagnostics.write("info", "watch-registered", {
      watchId,
      alreadySettled: settled,
    });
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
