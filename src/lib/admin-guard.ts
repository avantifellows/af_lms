/**
 * Shared admin-surface helpers used by both the Centre management
 * (`centres.ts`) and Staff management (`staff-admin.ts`) domains.
 *
 * Both surfaces enforce the same admin policy (passcode users blocked, only
 * `user_permission.role === "admin"` allowed) and the same cached
 * schema-readiness degrade (503 until the migration lands). Keeping that policy
 * and the (easy-to-get-wrong) cache-reset-on-failure dance in one place stops
 * the two surfaces from drifting apart.
 */
import { getUserPermission, type UserPermission } from "./permissions";

export type AdminSession = {
  user?: { email?: string | null } | null;
  isPasscodeUser?: boolean;
} | null;

export type AdminGuardResult =
  | { ok: true; email: string; permission: UserPermission }
  | { ok: false; status: 401 | 403; error: "Unauthorized" | "Forbidden" };

// Passcode users and any non-`admin` Google role are rejected; only
// `user_permission.role === "admin"` passes.
export async function requireAdmin(
  session: AdminSession
): Promise<AdminGuardResult> {
  const email = session?.user?.email;
  if (!email) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  if (session.isPasscodeUser) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  const permission = await getUserPermission(email);
  if (permission?.role !== "admin") {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  return { ok: true, email, permission };
}

export interface SchemaChecker<S extends { ok: boolean }> {
  check: () => Promise<S>;
  reset: () => void;
}

// Wrap a schema-readiness loader with the shared cache policy: memoise on
// success, clear the cache on an unavailable result (so a missing column is
// re-checked next request once the migration lands), and clear + rethrow on any
// query error rather than caching a rejected promise.
export function makeSchemaChecker<S extends { ok: boolean }>(
  load: () => Promise<S>
): SchemaChecker<S> {
  let cached: Promise<S> | null = null;

  function check(): Promise<S> {
    cached ??= load().then(
      (status) => {
        if (!status.ok) cached = null;
        return status;
      },
      (error) => {
        cached = null;
        throw error;
      }
    );
    return cached;
  }

  function reset(): void {
    cached = null;
  }

  return { check, reset };
}
