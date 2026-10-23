// Server-side gate and loading helpers shared by the Curriculum Plan pages.

import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";

// Plan pages are Admin-only (read-only Admins can view): signed-out users go to sign-in,
// everyone else to the dashboard.
export async function requirePlanAdminPage() {
  const access = await requireCurriculumPlanAdmin(await getServerSession(authOptions));
  if (!access.ok) {
    redirect(access.status === 401 ? "/" : "/dashboard");
  }
  return access;
}

// A plan that does not exist is a 404 page; any other result passes through.
export function orNotFound<R extends { ok: boolean }>(result: R): Exclude<R, { status: 404 }> {
  if ((result as { status?: number }).status === 404) {
    notFound();
  }
  return result as Exclude<R, { status: 404 }>;
}
