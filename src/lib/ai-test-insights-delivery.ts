// AI Test Insights (#550): delivery of an Insight Request to AI Mentorship
// Guide, the generator. Server-only: it reads the enqueue secret.
//
// The LMS writes the request row first, then asks the generator to run it:
// it wakes the generator (`POST {wake URL}/start`, unauthenticated, failures
// ignored) and, at the same time, enqueues the request
// (`POST {enqueue URL}/{request_key}/enqueue` with the bearer secret and
// `{"environment": APP_ENV}`). Delivery may be repeated: the generator claims
// a request with its own conditional update, as Holistic Profile regeneration
// does. Local runs and e2e reach a fake generator (`e2e/helpers`) only through
// these settings; there is no test-only branch here.
//
// Logs carry the request key, the HTTP status and an error name only, never
// the secret or a URL.

/** The settings a configured environment has. Every value is trimmed. */
import { aiTestInsightsEnvironment, aiTestInsightsSetting, errorName, type AiTestInsightsEnvironment } from "@/lib/ai-test-insights-env";

export interface AiTestInsightsDeliverySettings {
  /** The collection endpoint, ending in `/api/internal/insight-requests`, no trailing slash. */
  enqueueUrl: string;
  enqueueSecret: string;
  /** The wake base URL, no trailing slash; null skips the wake call. */
  wakeUrl: string | null;
  environment: AiTestInsightsEnvironment;
}

/** How the generator answered the enqueue call. */
export type AiTestInsightsEnqueueOutcome =
  /** 202: the request waits for the generator. */
  | "accepted"
  /** 401, 404 or 422: the generator will never run it. */
  | "rejected"
  /** Anything else (503, another status, a timeout, a network error): it may still run. */
  | "unreachable";

const REJECTED_STATUSES = new Set([401, 404, 422]);

const withoutTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * The delivery settings, or null when generation is not configured: it needs
 * the enqueue URL, the enqueue secret and `APP_ENV` of `staging` or
 * `production`. A blank wake URL only skips the wake call.
 */
export function aiTestInsightsDeliverySettings(): AiTestInsightsDeliverySettings | null {
  const enqueueUrl = aiTestInsightsSetting("AI_TEST_INSIGHTS_ENQUEUE_URL");
  const enqueueSecret = aiTestInsightsSetting("AI_TEST_INSIGHTS_ENQUEUE_SECRET");
  const environment = aiTestInsightsEnvironment();
  if (!enqueueUrl || !enqueueSecret || !environment) return null;
  const wakeUrl = aiTestInsightsSetting("AI_TEST_INSIGHTS_WAKE_URL");
  return {
    enqueueUrl: withoutTrailingSlash(enqueueUrl),
    enqueueSecret,
    wakeUrl: wakeUrl ? withoutTrailingSlash(wakeUrl) : null,
    environment,
  };
}


/** Wakes the generator. Never throws; its answer does not matter. */
async function wake(settings: AiTestInsightsDeliverySettings, timeoutMs: number): Promise<void> {
  if (!settings.wakeUrl) return;
  try {
    await fetch(`${settings.wakeUrl}/start`, { method: "POST", signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    // A generator that cannot be woken still picks the request up when it next starts.
  }
}

/** Asks the generator to run the request. Never throws. */
async function enqueue(
  settings: AiTestInsightsDeliverySettings,
  requestKey: string,
  timeoutMs: number,
): Promise<AiTestInsightsEnqueueOutcome> {
  let response: Response;
  try {
    response = await fetch(`${settings.enqueueUrl}/${encodeURIComponent(requestKey)}/enqueue`, {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.enqueueSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ environment: settings.environment }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.warn(`AI Test Insights enqueue unreachable: request=${requestKey} error=${errorName(error)}`);
    return "unreachable";
  }
  if (response.status === 202) return "accepted";
  if (REJECTED_STATUSES.has(response.status)) {
    console.error(`AI Test Insights enqueue rejected: request=${requestKey} status=${response.status}`);
    return "rejected";
  }
  console.warn(`AI Test Insights enqueue unreachable: request=${requestKey} status=${response.status}`);
  return "unreachable";
}

/**
 * Wakes the generator and enqueues the request, together, each call limited
 * to `timeoutMs`. Returns how the enqueue call was answered.
 */
export async function deliverInsightRequest(
  settings: AiTestInsightsDeliverySettings,
  requestKey: string,
  timeoutMs: number,
): Promise<AiTestInsightsEnqueueOutcome> {
  const [, outcome] = await Promise.all([wake(settings, timeoutMs), enqueue(settings, requestKey, timeoutMs)]);
  return outcome;
}
