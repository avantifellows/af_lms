// Client-side calls to the Curriculum Plan APIs and how their errors are shown. Client-safe:
// only types come from the server modules.

import { useState } from "react";

import type { CurriculumPlanError } from "@/lib/curriculum-plans";

export interface PlanResponseBody {
  error?: string;
  errors?: CurriculumPlanError[];
  [key: string]: unknown;
}

export interface PlanResponse {
  ok: boolean;
  body: PlanResponseBody;
}

// Sends `body` as JSON when given; an unreadable response body reads as {}. Network failures
// throw, as fetch does.
export async function planRequest(url: string, method: string, body?: unknown): Promise<PlanResponse> {
  const response = await fetch(
    url,
    body === undefined
      ? { method }
      : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  const parsed = (await response.json().catch(() => ({}))) as PlanResponseBody;
  return { ok: response.ok, body: parsed };
}

// The per-field / per-Chapter errors of a rejected save, or one form-level error.
export function planErrors(body: PlanResponseBody, fallback: string): CurriculumPlanError[] {
  return Array.isArray(body.errors) && body.errors.length > 0
    ? body.errors
    : [{ field: "form", message: body.error ?? fallback }];
}

// The first error of a rejected save, as one line.
export function firstErrorMessage(body: PlanResponseBody, fallback: string): string {
  return body.errors?.[0]?.message ?? body.error ?? fallback;
}

// One in-flight request at a time with a single error line. `run` resolves to the response body
// on success and null on failure (the error is then set).
export function usePlanAction() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  async function run(
    request: () => Promise<PlanResponse>,
    fallback: string,
    errorOf: (body: PlanResponseBody) => string = (body) => body.error ?? fallback
  ): Promise<PlanResponseBody | null> {
    setError("");
    setWorking(true);
    try {
      const response = await request();
      if (response.ok) return response.body;
      setError(errorOf(response.body));
      return null;
    } catch {
      setError(fallback);
      return null;
    } finally {
      setWorking(false);
    }
  }

  return { working, error, setError, run };
}
