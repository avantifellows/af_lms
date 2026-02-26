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

export const PASSCODE_SESSION = {
  user: { email: "passcode_70705@avantifellows.org", name: "Passcode User" },
  isPasscodeUser: true,
  schoolCode: "70705",
  expires: "2099-01-01",
};

export const NO_SESSION = null;
