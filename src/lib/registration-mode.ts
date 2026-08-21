export const PHONE_REGISTRATION_MODE = "phone" as const;
export const APPROVED_REGISTRATION_MODE = "approved" as const;

export type RegistrationMode =
  | typeof PHONE_REGISTRATION_MODE
  | typeof APPROVED_REGISTRATION_MODE;

/**
 * The mode contract is code-controlled and must be changed in a coordinated
 * AF LMS + DB Service deployment. It is deliberately not database-backed or
 * user-selectable.
 */
export const ACTIVE_REGISTRATION_MODE: RegistrationMode = APPROVED_REGISTRATION_MODE;
export const REGISTRATION_MODE_VERSION = "1" as const;

export interface RegistrationModeContract {
  mode: RegistrationMode;
  version: string;
}

export interface RegistrationModeHandshake {
  registration_mode: RegistrationMode;
  registration_mode_version: string;
}

export function getRegistrationModeContract(
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
): RegistrationModeContract {
  return { mode, version: REGISTRATION_MODE_VERSION };
}

export function getRegistrationModeHandshake(
  mode: RegistrationMode = ACTIVE_REGISTRATION_MODE,
): RegistrationModeHandshake {
  const contract = getRegistrationModeContract(mode);
  return {
    registration_mode: contract.mode,
    registration_mode_version: contract.version,
  };
}

/**
 * DB Service must return this JSON shape for a coordinated deployment
 * mismatch. AF LMS treats it as a 503 and never merges upstream row results:
 * { error: { code: "registration_mode_mismatch", message: string } }
 */
export const REGISTRATION_MODE_MISMATCH_CODE = "registration_mode_mismatch" as const;
export const REGISTRATION_MODE_MISMATCH_MESSAGE =
  "Student registration is temporarily unavailable while Registration Mode is being coordinated. Please try again shortly.";

export interface RegistrationModeMismatchResponse {
  error: {
    code: typeof REGISTRATION_MODE_MISMATCH_CODE;
    message: string;
  };
}

export function isRegistrationModeMismatchResponse(
  value: unknown,
): value is RegistrationModeMismatchResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const error = (value as Record<string, unknown>).error;
  return Boolean(
    error &&
      typeof error === "object" &&
      !Array.isArray(error) &&
      (error as Record<string, unknown>).code === REGISTRATION_MODE_MISMATCH_CODE,
  );
}
