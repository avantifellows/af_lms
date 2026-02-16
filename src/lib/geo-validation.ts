// Shared GPS validation for visit start/end API routes.
// Do NOT log lat/lng values — treat as sensitive data.

export interface GpsReading {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface GpsValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
  reading?: GpsReading;
}

const MAX_ACCURACY_METERS = 500;
const WARN_ACCURACY_METERS = 100;

/**
 * Validate a GPS reading from a request body.
 * Returns a structured result with optional warning for 100-500m accuracy.
 */
export function validateGpsReading(
  body: Record<string, unknown>,
  prefix: "start" | "end"
): GpsValidationResult {
  const latKey = `${prefix}_lat`;
  const lngKey = `${prefix}_lng`;
  const accKey = `${prefix}_accuracy`;

  const lat = Number(body[latKey]);
  const lng = Number(body[lngKey]);
  const accuracy = Number(body[accKey]);

  if (isNaN(lat) || isNaN(lng) || isNaN(accuracy)) {
    return { valid: false, error: `${latKey}, ${lngKey}, and ${accKey} are required and must be numbers` };
  }

  if (lat < -90 || lat > 90) {
    return { valid: false, error: `${latKey} must be between -90 and 90` };
  }

  if (lng < -180 || lng > 180) {
    return { valid: false, error: `${lngKey} must be between -180 and 180` };
  }

  if (accuracy < 0) {
    return { valid: false, error: `${accKey} must be a positive number` };
  }

  if (accuracy > MAX_ACCURACY_METERS) {
    return {
      valid: false,
      error: `GPS accuracy too low (${Math.round(accuracy)}m). Move to an open area and try again.`,
    };
  }

  const warning =
    accuracy > WARN_ACCURACY_METERS
      ? `GPS accuracy is moderate (${Math.round(accuracy)}m). Reading accepted but may be imprecise.`
      : undefined;

  return { valid: true, warning, reading: { lat, lng, accuracy } };
}
