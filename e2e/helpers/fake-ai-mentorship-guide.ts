import path from "path";

import config from "./fake-ai-mentorship-guide.json";

// The fake generator (fake-ai-mentorship-guide.cjs) that stands in for AI
// Mentorship Guide in e2e: Playwright starts it beside the app server, and the
// app server's AI Test Insights settings point at it. Specs steer how it
// answers the enqueue call and what it does with an accepted request (claim
// it and hold it as running, or end it without a result), end a request it
// holds, and read back the calls it received.

export const FAKE_AI_MENTORSHIP_GUIDE_SCRIPT = path.resolve(__dirname, "fake-ai-mentorship-guide.cjs");
export const FAKE_AI_MENTORSHIP_GUIDE_PORT = config.port;
export const FAKE_AI_MENTORSHIP_GUIDE_ORIGIN = `http://127.0.0.1:${config.port}`;

/**
 * The app server's delivery settings, all at the fake. `APP_ENV` is set
 * explicitly, so a value in a developer's `.env.local` is never used.
 */
export const FAKE_AI_MENTORSHIP_GUIDE_APP_ENV = {
  AI_TEST_INSIGHTS_ENQUEUE_URL: `${FAKE_AI_MENTORSHIP_GUIDE_ORIGIN}/api/internal/insight-requests`,
  AI_TEST_INSIGHTS_ENQUEUE_SECRET: config.enqueueSecret,
  AI_TEST_INSIGHTS_WAKE_URL: `${FAKE_AI_MENTORSHIP_GUIDE_ORIGIN}/wake`,
  APP_ENV: config.environment,
};

/** One call the fake received. `body` is the raw request body. */
export interface FakeAiMentorshipGuideCall {
  kind: "wake" | "enqueue";
  /** The request key in the enqueue path; null for a wake call. */
  requestKey: string | null;
  authorization: string | null;
  body: string;
  /** The status the fake answered with. */
  status: number;
}

/** The e2e database, which the fake's database side writes request rows in. */
export const FAKE_AI_MENTORSHIP_GUIDE_DATABASE_ENV = {
  DATABASE_HOST: "localhost",
  DATABASE_PORT: "5432",
  DATABASE_USER: process.env.TEST_DB_USER || "postgres",
  DATABASE_PASSWORD: process.env.TEST_DB_PASSWORD || "postgres",
  DATABASE_NAME: "af_lms_test",
};

/** How a request ends without a result, with an outcome code. */
export type FakeAiMentorshipGuideEnd = { state: "no_data" | "failed"; outcomeCode: string };

export type FakeAiMentorshipGuideBehaviour =
  /** 202, and the request is left `queued`: the generator has not started it. */
  | { enqueue: "accept" }
  /** 202, then the fake claims the request (`running`, with `started_at`) and holds it. */
  | { enqueue: "accept"; run: "hold" }
  /** 202, then the fake claims the request and ends it without a result. */
  | { enqueue: "accept"; run: FakeAiMentorshipGuideEnd["state"]; outcomeCode: string }
  /** The generator is asleep or unreachable: every enqueue call answers 503. */
  | { enqueue: "asleep" }
  | { enqueue: "reject"; status: 401 | 404 | 422 };

async function control(method: "GET" | "POST", route: string, body?: unknown): Promise<Response> {
  const response = await fetch(`${FAKE_AI_MENTORSHIP_GUIDE_ORIGIN}/__fake/${route}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Fake AI Mentorship Guide: ${route} answered ${response.status}`);
  return response;
}

/** Sets how every following enqueue call is answered, until the next steer or reset. */
export async function steerFakeAiMentorshipGuide(behaviour: FakeAiMentorshipGuideBehaviour): Promise<void> {
  await control("POST", "steer", behaviour);
}

/** Clears the calls received and goes back to accepting every enqueue call. */
export async function resetFakeAiMentorshipGuide(): Promise<void> {
  await control("POST", "reset");
}

/** The wake and enqueue calls received since the last reset, oldest first. */
export async function fakeAiMentorshipGuideCalls(): Promise<FakeAiMentorshipGuideCall[]> {
  return (await control("GET", "calls")).json();
}

/** Ends a request the fake holds as running, `no_data` or `failed` with an outcome code, as the generator does. */
export async function endFakeAiMentorshipGuideRequest(requestKey: string, end: FakeAiMentorshipGuideEnd): Promise<void> {
  await control("POST", "end", { requestKey, ...end });
}
