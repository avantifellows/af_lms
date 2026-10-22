import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { authOptions } from "./auth";
import {
  canBlendedLearning,
  getBlendedLearningAccess,
  type BlendedLearningAccess,
  type BlendedLearningAction,
} from "./blended-learning-access";

// The shared gate every Blended Learning API route and page runs first
// (server-only): session → Blended Learning access → the action → the numeric
// `[id]` segment. Per-Student scope (canAccessBlendedStudent) stays with the
// use case.

const NUMERIC_ID = /^\d+$/;

type IdParams = Promise<{ id: string }>;

export type BlendedLearningGuard = { access: BlendedLearningAccess; id: number };

// API routes: 401 without a session, 403 without access or the action, 404
// for a non-numeric `[id]`. Returns the error response to send, or the access
// and id (0 when the route has no `[id]` segment).
export async function requireBlendedLearning(
  action: BlendedLearningAction,
  params?: IdParams
): Promise<BlendedLearningGuard | NextResponse> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const access = await getBlendedLearningAccess(session.user.email);
  if (!access || !canBlendedLearning(access, action)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!params) return { access, id: 0 };
  const { id } = await params;
  if (!NUMERIC_ID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return { access, id: Number(id) };
}

// An `[id]` API route handler behind requireBlendedLearning: the handler runs
// only with access, the action and a numeric id; otherwise the guard's error
// response is sent.
export function withBlendedLearning(
  action: BlendedLearningAction,
  handler: (request: Request, guard: BlendedLearningGuard) => Promise<NextResponse>
): (request: Request, context: { params: IdParams }) => Promise<NextResponse> {
  return async (request, { params }) => {
    const guard = await requireBlendedLearning(action, params);
    if (guard instanceof NextResponse) return guard;
    return handler(request, guard);
  };
}

// A JSON request body, or the 422 to send when it isn't JSON.
export async function readJsonBody(request: Request): Promise<{ body: unknown } | NextResponse> {
  try {
    return { body: await request.json() };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 422 });
  }
}

// A use case's failure as a response, with its fieldErrors when it has them.
export function failureResponse(result: {
  error: string;
  status: number;
  fieldErrors?: Record<string, string>;
}): NextResponse {
  return NextResponse.json(
    { error: result.error, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) },
    { status: result.status }
  );
}

// Pages: sign-in (`/`) without a session, `/dashboard` without access, and
// `deniedTo` (default `/dashboard`) without the action.
export async function requireBlendedLearningPage(
  action: BlendedLearningAction,
  deniedTo = "/dashboard"
): Promise<BlendedLearningAccess> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) redirect("/");

  const access = await getBlendedLearningAccess(email);
  if (!access) redirect("/dashboard");
  if (!canBlendedLearning(access, action)) redirect(deniedTo);
  return access;
}

// A page's numeric `[id]` segment as written, or the not-found page.
export async function requireNumericPageId(params: IdParams): Promise<string> {
  const { id } = await params;
  if (!NUMERIC_ID.test(id)) notFound();
  return id;
}
