// The AI Test Insights Student page's one read of a Student's sessions route
// (#576): the Session Notes form's draft and access, and the History
// timeline, come from the same answer. Client-safe.
import { useFetchWithRetry, type FetchWithRetryState } from "@/hooks/use-fetch-with-retry";
import type { AiTestInsightsSessionsResponse } from "@/lib/ai-test-insights-session-notes-rules";

type SessionsLoaded = { status: "loaded"; sessions: AiTestInsightsSessionsResponse };

/** The page's read of the sessions route, and a way to read it again. */
export interface SessionsRead {
  state: FetchWithRetryState<SessionsLoaded>;
  /** Reads again (the state shows `loading` first). */
  reload: () => void;
}

/** The read is fresh each time, never from the browser's cache. */
const READ_INIT: RequestInit = { cache: "no-store" };

async function readSessions(response: Response): Promise<SessionsLoaded | { status: "failed" }> {
  const body = (await response.json().catch(() => null)) as AiTestInsightsSessionsResponse | null;
  if (response.ok && body && typeof body.notesAccess === "string" && Array.isArray(body.timeline)) {
    return { status: "loaded", sessions: body };
  }
  return { status: "failed" };
}

/** Reads the sessions route once, and again on each `reload`; a newer read drops an older answer. */
export function useAiTestInsightsSessions(sessionsUrl: string): SessionsRead {
  const { state, retry } = useFetchWithRetry(sessionsUrl, readSessions, READ_INIT);
  return { state, reload: retry };
}
