/**
 * Shared test helpers for API route unit tests.
 */

/** Create a JSON Request suitable for API route handlers. */
export function jsonRequest(
  url: string,
  opts: { method?: string; body?: unknown } = {}
): Request {
  const { method = "GET", body } = opts;
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new Request(url, init);
}

/** Wrap route params in a Promise (Next.js 16 pattern). */
export function routeParams<T extends Record<string, string>>(p: T) {
  return { params: Promise.resolve(p) };
}

/** Standard mock sessions for auth-gated routes. */
export const ADMIN_SESSION = {
  user: { email: "admin@avantifellows.org", name: "Admin" },
  expires: "2099-01-01",
};

export const PM_SESSION = {
  user: { email: "pm@avantifellows.org", name: "PM User" },
  expires: "2099-01-01",
};

export const TEACHER_SESSION = {
  user: { email: "teacher@avantifellows.org", name: "Teacher" },
  expires: "2099-01-01",
};

export const PMU_MANAGER_SESSION = {
  user: { email: "pmu.manager@avantifellows.org", name: "PMU Manager" },
  expires: "2099-01-01",
};

export const PMU_GOVT_SESSION = {
  user: { email: "principal@jnv.example.org", name: "PMU Govt School User" },
  expires: "2099-01-01",
};

export const NO_SESSION = null;

/**
 * Resolved permission rows for the PMU sessions above, as
 * `authorizeSchoolAccess` returns them. Both roles are pinned to JNV NVS.
 */
export const PMU_MANAGER_PERMISSION = {
  email: "pmu.manager@avantifellows.org",
  level: 3 as const,
  role: "pmu_manager" as const,
  school_codes: null,
  regions: null,
  program_ids: [64],
  read_only: false,
};

export const PMU_GOVT_PERMISSION = {
  email: "principal@jnv.example.org",
  level: 1 as const,
  role: "pmu_govt_school_user" as const,
  school_codes: ["70705"],
  regions: null,
  program_ids: [64],
  read_only: false,
};
