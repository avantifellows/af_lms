// The Manage page's calls to its API routes (client-safe): JSON in, and back
// either the response body or the error to show, with any field errors.

export type ManageFailure = { error: string; fieldErrors: Record<string, string> };
export type ManageResponse<T> = { ok: true; body: T } | ({ ok: false } & ManageFailure);

export async function manageRequest<T = unknown>(
  url: string,
  init: { method: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown } = { method: "GET" }
): Promise<ManageResponse<T>> {
  try {
    const res = await fetch(url, {
      method: init.method,
      cache: "no-store",
      ...(init.body === undefined
        ? {}
        : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) }),
    });
    const json = res.status === 204 ? {} : await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, body: json as T };
    return {
      ok: false,
      error: typeof json.error === "string" ? json.error : "Something went wrong. Try again.",
      fieldErrors: json.fieldErrors && typeof json.fieldErrors === "object" ? json.fieldErrors : {},
    };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Try again.", fieldErrors: {} };
  }
}

// "1 student" / "3 students".
export function students(count: number): string {
  return `${count} ${count === 1 ? "student" : "students"}`;
}

// The verb that agrees with a count: agree(1, "has", "have") is "has".
export function agree(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}
