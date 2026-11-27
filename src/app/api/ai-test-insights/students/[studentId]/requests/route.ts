import { NextResponse } from "next/server";

import { createRequest } from "@/lib/ai-test-insights-requests";
import { NOT_CONFIGURED_CODE, type AiTestInsightsCreateRequestResponse } from "@/lib/ai-test-insights-shared";
import { withAiTestInsightsStudentWrite, type ParsedBody } from "@/lib/ai-test-insights-student-routes";

// Generate on the AI Summary card (#550, physical centres only): records an
// Insight Request for the Student's ticked tests. The Student route opening
// (`@/lib/ai-test-insights-student-routes`) gates first, as a write: 401 no
// session, 422 bad id, 403 no `ai_test_insights` view, 403 access not `edit`
// (before the Student lookup reveals anything), 404 Student
// missing, not listed or out of scope. Then the body (422), then the actor's
// User (409 `no_linked_user`). 201 created, 200 already running, 200
// `existing` when a completed request of the Student has the same tests and
// the body has no `generateAgain: true` (nothing written, nothing called), 503
// `not_configured` when this environment has no delivery settings (#562), with
// no row written. A created request has been delivered to AI Mentorship Guide
// and is returned as it reads after delivery: `failed` with `enqueue_rejected`
// if the generator refused it. A request still `queued` or `running` 20
// minutes after it was made has stalled: it does not count as already
// running, and this Generate closes it (`failed`, `timed_out`) in the same
// transaction as the new insert.
//
// An optional `centre` query value, as on the Student page, picks the centre
// whose School and Program the request records.

const MAX_TESTS = 50;
const TEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

type Body = { selectedTestIds: string[]; generateAgain: boolean };

/** 1 to 50 distinct ids of 1 to 64 letters, digits, `_` and `-`; `generateAgain` a boolean if present. */
function parseBody(raw: unknown): Body | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { selectedTestIds, generateAgain } = raw as Record<string, unknown>;
  if (!Array.isArray(selectedTestIds)) return null;
  if (selectedTestIds.length < 1 || selectedTestIds.length > MAX_TESTS) return null;
  if (!selectedTestIds.every((id) => typeof id === "string" && TEST_ID.test(id))) return null;
  if (new Set(selectedTestIds).size !== selectedTestIds.length) return null;
  if (generateAgain !== undefined && typeof generateAgain !== "boolean") return null;
  return { selectedTestIds: selectedTestIds as string[], generateAgain: generateAgain === true };
}

export const POST = withAiTestInsightsStudentWrite(
  { log: "AI Test Insights request create failed", message: "The AI Summary could not be requested" },
  (raw): ParsedBody<Body> => {
    const body = parseBody(raw);
    return body ? { ok: true, value: body } : { ok: false };
  },
  async ({ student, actorUserId, body }) => {
    const result = await createRequest({ student, actorUserId, ...body });
    if (result.outcome === "not_configured") {
      return NextResponse.json(
        { error: "AI Summary generation is not set up in this environment.", code: NOT_CONFIGURED_CODE },
        { status: 503 },
      );
    }
    const response: AiTestInsightsCreateRequestResponse = result;
    return NextResponse.json(response, { status: result.outcome === "created" ? 201 : 200 });
  },
);
