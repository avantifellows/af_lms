import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { requireCurriculumPlanAdmin } from "@/lib/curriculum-plans";

type PlanRouteResult = { ok: true } | { ok: false; status: number };

interface PlanRouteContext {
  // The signed-in Admin, for audit columns.
  email: string;
  // The JSON body when the route reads one; invalid JSON reads as null, which every plan
  // normalizer treats like an empty body.
  body: unknown;
}

// Every Curriculum Plan API route: the plan Admin guard (read-only Admins pass reads; writes
// pass `forWrite`), the optional JSON body, then the action. A failed result answers with its
// own status and body; a successful one goes through `respond`.
export async function handlePlanRoute<T extends PlanRouteResult>(
  options: { forWrite?: boolean; request?: NextRequest },
  action: (context: PlanRouteContext) => Promise<T>,
  respond: (result: Extract<T, { ok: true }>) => Response
): Promise<Response> {
  const session = await getServerSession(authOptions);
  const access = await requireCurriculumPlanAdmin(
    session,
    options.forWrite ? { forWrite: true } : undefined
  );
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const body = options.request ? await options.request.json().catch(() => null) : null;
  const result = await action({ email: access.email, body });
  if (!result.ok) {
    return NextResponse.json(result, { status: (result as { status: number }).status });
  }
  return respond(result as Extract<T, { ok: true }>);
}
