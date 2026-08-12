import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getUserPermission } from "@/lib/permissions";

type AdminApiResult =
  | { ok: true; email: string }
  | { ok: false; response: NextResponse };

// Pass `forWrite: true` on mutating routes — a read-only admin (role "admin" +
// read_only) may see every admin surface but must not change anything, and the
// route guard is the enforcement point (hiding UI controls alone would leave
// the API open).
export async function requireAdminApiAccess(
  opts?: { forWrite?: boolean }
): Promise<AdminApiResult> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const permission = await getUserPermission(email);
  if (
    permission?.role !== "admin" ||
    (opts?.forWrite && permission.read_only)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  return { ok: true, email };
}
