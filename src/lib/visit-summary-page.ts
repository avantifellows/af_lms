import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { getFeatureAccess, getResolvedPermission, type FeatureAccessResult } from "@/lib/permissions";
import { buildVisitsActor, canViewVisitSummary, type VisitsActor } from "@/lib/visits-policy";

// The gate every School Visit Summary page runs first (server-only): sign-in (`/`) without a
// session; `/dashboard` without a permission row or visits view access; then `canViewVisitSummary`,
// sending a PM without a visit-manager seat to `/visits` and anyone else to `/dashboard`.
// `visitsAccess.canEdit` is the rule the concern-events API enforces (`requireVisitsAccess(…, "edit")`).
export async function requireVisitSummaryPage(): Promise<{ actor: VisitsActor; visitsAccess: FeatureAccessResult }> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    redirect("/");
  }

  const permission = await getResolvedPermission(email);
  if (!permission) {
    redirect("/dashboard");
  }

  const visitsAccess = getFeatureAccess(permission, "visits");
  if (!visitsAccess.canView) {
    redirect("/dashboard");
  }

  const actor = buildVisitsActor(email, permission);
  if (!canViewVisitSummary(actor)) {
    redirect(actor.role === "program_manager" ? "/visits" : "/dashboard");
  }

  return { actor, visitsAccess };
}
