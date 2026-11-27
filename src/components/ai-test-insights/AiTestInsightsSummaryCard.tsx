// The AI Summary card on the AI Test Insights Student page (#550, physical
// centres only). This slice gives it the test picker: the Student's submitted
// Major, Full Syllabus and Mock tests of this year, newest first, with the
// newest ticked. A Teacher ticks the tests the conversation is about, and at
// least one stays ticked; a viewer sees the list read-only. The tests come
// from the page's one read of the picker route, which the Student card's
// newest test line shares. A client component: rendered inside
// AiTestInsightsStudentSections, which holds that read.
//
// Generate (#560) records an Insight Request for the ticked tests, sent in
// the picker's order (newest first). The card shows one request: the
// Student's latest, read by the page on the server, or the one Generate
// returned. While it is `queued` or `running` the card says so with the
// elapsed time, the picker is locked and Generate is gone. A request in a
// final state shows the picker and Generate, as if there were none. Viewers
// see the request's state and never Generate; the create route refuses them
// anyway.
//
// A request that ended `no_data` or `failed` (#561) shows why, in the plain
// words of `@/lib/ai-test-insights-outcomes`, and for an editor "Try again",
// which posts that request's tests again with `generateAgain: true` and no
// confirmation, so it always makes one new request (never the `existing`
// answer); the picker and Generate stay usable beneath it.
//
// Generate delivers the request to AI Mentorship Guide (#562). A request the
// generator refused comes back `failed` (`enqueue_rejected`) and shows as any
// failed request. An environment without the delivery settings answers 503
// `not_configured`, and the card says so in plain words.
//
// The card follows its request by itself (#563): while the request is
// `queued` or `running` it polls the status route every 10 seconds and shows
// each answer, so it moves from waiting to writing to a final state with no
// reload, and stops on any final state. A failed poll keeps the last state
// shown and the next tick tries again. A Teacher's poll may also re-deliver a
// request the generator missed; the route decides that, not the card.
//
// A `completed` request (#564) shows its AI Summary: the text, read once from
// the summary route and rendered as formatted Markdown, the tests it was made
// from (named from the picker list; an id the list does not hold reads "an
// earlier test"), who asked for it and when. A failed text read shows an
// error with Retry. Reading it makes no status poll, so no wake or enqueue
// call. Viewers read it too. The picker and Generate stay under it.
//
// It also offers "Download PDF" (#565): a link to the PDF route, which
// answers with the PDF the generator made. The link stays whether the text
// loads, is loading or failed. Viewers download it too. A click asks the
// route first, so a route that cannot redirect (404, 502, 503) leaves the
// Student page in place with a message and Retry.
//
// The same tests again (#567): while the ticked tests are the shown
// completed request's tests, Generate reads "Generate again" and opens a
// confirmation (it keeps the earlier AI Summary, writes a new one and takes
// about 4 minutes); Cancel sends nothing, Confirm sends `generateAgain: true`.
// Other tests are sent with no confirmation. When the create route answers
// `existing` (a completed request of these tests is already there), the card
// shows that request with the note "An AI Summary for these tests already
// exists", and the ticked tests now match it, so "Generate again" is offered.
// Viewers never see Generate or "Generate again".
import { useEffect, useState, useSyncExternalStore, type MouseEvent } from "react";

import TestInsightText from "@/components/ai-test-insights/TestInsightText";
import { Button, Card, Modal } from "@/components/ui";
import { RetryAlert } from "@/components/ui/RetryAlert";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";
import {
  aiTestInsightsRequestPdfUrl,
  aiTestInsightsRequestStatusUrl,
  aiTestInsightsRequestSummaryUrl,
  formatInsightRequestTime,
  formatInsightSessionDate,
  isInsightRequestInProgress,
  NO_LINKED_USER_CODE,
  NOT_CONFIGURED_CODE,
  type AiTestInsightsCreateRequestResponse,
  type AiTestInsightsRequestStatusResponse,
  type AiTestInsightsSummaryResponse,
  type AiTestInsightsTest,
  type AiTestInsightsTestFormat,
  type AiTestInsightsTestsState,
  type InsightRequestView,
} from "@/lib/ai-test-insights-shared";
import { outcomeMessage } from "@/lib/ai-test-insights-outcomes";

const FORMAT_LABELS: Record<AiTestInsightsTestFormat, string> = {
  major_test: "Major test",
  full_syllabus_test: "Full Syllabus test",
  mock_test: "Mock test",
};

const LAST_TICK_HINT_ID = "ai-test-insights-last-tick-hint";

const IN_PROGRESS_MESSAGES = {
  queued: "Waiting to start. This can take about 2 minutes if the server was asleep.",
  running: "Writing the AI Summary. This usually takes about 4 minutes.",
} as const;

const NO_LINKED_USER_MESSAGE = "Your login is not linked to a user record. Contact your program admin.";
const NOT_CONFIGURED_MESSAGE = "AI Summary generation is not set up in this environment.";
const REQUEST_FAILED_MESSAGE = "The AI Summary could not be requested. Try again.";
const EXISTING_NOTE = "An AI Summary for these tests already exists";
const GENERATE_AGAIN_TITLE_ID = "ai-test-insights-generate-again-title";
const GENERATE_AGAIN_TEXT =
  "This keeps the earlier AI Summary and writes a new one for these tests. It takes about 4 minutes.";

/** How often the card asks for the status of a `queued` or `running` request. */
const POLL_INTERVAL_MS = 10_000;

/** `65_000` → `1 min 5 s`; under a minute, seconds only. */
function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes === 0 ? `${seconds} s` : `${minutes} min ${seconds % 60} s`;
}

/** A clock that ticks once a second, in whole seconds since the epoch. */
function subscribeToSeconds(onTick: () => void): () => void {
  const timer = setInterval(onTick, 1000);
  return () => clearInterval(timer);
}
const currentSecond = () => Math.floor(Date.now() / 1000);
/** Null on the server, so the server and the browser's first render agree. */
const noSecondOnServer = () => null;

/** Now, in milliseconds, updated once a second; null while rendering on the server. */
function useNow(): number | null {
  const second = useSyncExternalStore(subscribeToSeconds, currentSecond, noSecondOnServer);
  return second === null ? null : second * 1000;
}

/** A `queued` or `running` request: what it is doing and for how long. */
function InProgress({ request }: { request: InsightRequestView & { state: "queued" | "running" } }) {
  const now = useNow();
  return (
    <div role="status" className="mb-4 rounded-lg border border-border bg-bg p-4">
      <p className="text-sm font-medium text-text-primary">{IN_PROGRESS_MESSAGES[request.state]}</p>
      {now !== null && (
        <p className="mt-1 text-sm text-text-secondary">{formatElapsed(now - Date.parse(request.requestedAt))} elapsed</p>
      )}
      <p className="mt-1 text-xs text-text-muted">You can leave this page and come back.</p>
    </div>
  );
}

/**
 * A request that ended `no_data` or `failed`: why, in plain words, and for an
 * editor "Try again", which sends the same tests again.
 */
function NoSummary({
  request,
  canEdit,
  submitting,
  onTryAgain,
}: {
  request: InsightRequestView & { state: "no_data" | "failed" };
  canEdit: boolean;
  submitting: boolean;
  onTryAgain: () => void;
}) {
  return (
    <div role="status" className="mb-4 flex flex-col items-start gap-3 rounded-lg border border-border bg-bg p-4">
      <div>
        {request.state === "no_data" && (
          <p className="text-sm font-medium text-text-primary">No AI Summary could be made</p>
        )}
        <p className="text-sm text-text-secondary">{outcomeMessage(request.outcomeCode)}</p>
      </div>
      {canEdit && (
        <Button variant="secondary" onClick={onTryAgain} disabled={submitting}>
          Try again
        </Button>
      )}
    </div>
  );
}

type SummaryTextState = { status: "loading" } | { status: "failed" } | { status: "loaded"; markdown: string };

/** The AI Summary text is read fresh each time, never from the browser's cache. */
const SUMMARY_TEXT_FETCH: RequestInit = { cache: "no-store" };

async function readSummaryText(response: Response): Promise<SummaryTextState> {
  const body = (await response.json().catch(() => null)) as Partial<AiTestInsightsSummaryResponse> | null;
  return response.ok && typeof body?.markdown === "string"
    ? { status: "loaded", markdown: body.markdown }
    : { status: "failed" };
}

/** The tests an AI Summary was made from, by name from the picker; an id the picker does not hold is "an earlier test". */
function madeFrom(selectedTestIds: string[], tests: AiTestInsightsTestsState): string {
  if (tests.status !== "loaded") {
    return selectedTestIds.length === 1 ? "1 test" : `${selectedTestIds.length} tests`;
  }
  const names = new Map(tests.tests.map((test) => [test.id, test.name]));
  return selectedTestIds.map((id) => names.get(id) ?? "an earlier test").join(", ");
}

const PDF_NOT_CONFIGURED_MESSAGE =
  "The PDF can't be downloaded here: AI Summary reading is not set up in this environment.";
const PDF_NOT_FOUND_MESSAGE = "The PDF of this AI Summary could not be found.";
const PDF_FAILED_MESSAGE = "The PDF could not be downloaded. Please try again.";

/**
 * Asks the PDF route without following its redirect. A redirect (an opaque
 * one, as `redirect: "manual"` gives it) means the PDF is there; otherwise
 * the message to show: the route answers JSON for 404 (no PDF), 503 (reading
 * not set up) and 502 (unreadable).
 */
async function askForPdf(url: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { redirect: "manual", cache: "no-store" });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) return { ok: true };
    const body = (await response.json().catch(() => null)) as { code?: string } | null;
    if (response.status === 503 && body?.code === NOT_CONFIGURED_CODE) return { ok: false, message: PDF_NOT_CONFIGURED_MESSAGE };
    if (response.status === 404) return { ok: false, message: PDF_NOT_FOUND_MESSAGE };
  } catch {
    // A network failure reads as any other failure.
  }
  return { ok: false, message: PDF_FAILED_MESSAGE };
}

/**
 * "Download PDF" (#565). A plain click asks the route first, so an answer
 * that is not a redirect keeps the Student page and shows a message with
 * Retry (PR #573 review: the bare link replaced the page with the JSON). On a
 * redirect the browser goes to the route itself, which redirects again to a
 * fresh 60-second URL that the store answers as a download (named
 * `ai-summary-<student.id>-<date>.pdf`), so the page stays. Each ask signs a
 * URL; nothing is written. A click that opens a new tab or window is left to
 * the browser.
 */
function DownloadPdf({ url }: { url: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (asking) return;
    setAsking(true);
    setError(null);
    const result = await askForPdf(url);
    setAsking(false);
    if (result.ok) window.location.assign(url);
    else setError(result.message);
  }

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void download();
  }

  return (
    <>
      <a
        href={url}
        onClick={onClick}
        aria-busy={asking || undefined}
        className="inline-flex text-sm font-medium text-accent underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Download PDF
      </a>
      {error && <RetryAlert onRetry={() => void download()}>{error}</RetryAlert>}
    </>
  );
}

/** A `completed` request: its AI Summary text, its PDF, the tests it was made from, who asked for it and when. */
function CompletedSummary({
  request,
  tests,
  requestsUrl,
}: {
  request: InsightRequestView;
  tests: AiTestInsightsTestsState;
  requestsUrl: string;
}) {
  // Read once, and again on each Retry; an unmount or a newer read drops an older answer.
  const { state, retry } = useFetchWithRetry(
    aiTestInsightsRequestSummaryUrl(requestsUrl, request.requestKey),
    readSummaryText,
    SUMMARY_TEXT_FETCH,
  );
  return (
    <div className="mb-6 space-y-4 border-b border-border pb-6">
      {state.status === "loading" && (
        <p className="py-6 text-center text-sm text-text-muted">Loading the AI Summary…</p>
      )}
      {state.status === "failed" && <RetryAlert onRetry={retry}>The AI Summary could not be loaded</RetryAlert>}
      {state.status === "loaded" && <TestInsightText markdown={state.markdown} />}
      <DownloadPdf url={aiTestInsightsRequestPdfUrl(requestsUrl, request.requestKey)} />
      <div className="space-y-1 text-xs text-text-muted">
        <p>Made from: {madeFrom(request.selectedTestIds, tests)}</p>
        <p>
          Asked for by {request.requestedByName} on {formatInsightRequestTime(request.requestedAt)}
        </p>
      </div>
    </div>
  );
}

/** The tests, newest first; `locked` while a request is in progress or for viewers. */
function TestPicker({
  tests,
  ticked,
  canEdit,
  locked,
  onToggle,
}: {
  tests: AiTestInsightsTest[];
  ticked: ReadonlySet<string>;
  canEdit: boolean;
  locked: boolean;
  onToggle: (id: string) => void;
}) {
  const showLastTickHint = canEdit && !locked && ticked.size === 1;
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-text-primary">
        {canEdit ? "Tests this AI Summary covers" : "Tests"}
      </legend>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {tests.map((test) => {
          const isTicked = ticked.has(test.id);
          const isLastTick = isTicked && ticked.size === 1;
          return (
            <li key={test.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 has-[:disabled]:cursor-default">
                <input
                  type="checkbox"
                  value={test.id}
                  checked={isTicked}
                  disabled={!canEdit || locked || isLastTick}
                  aria-describedby={showLastTickHint && isLastTick ? LAST_TICK_HINT_ID : undefined}
                  onChange={() => onToggle(test.id)}
                  className="h-4 w-4 shrink-0 accent-accent"
                />
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium text-text-primary">{test.name}</span>
                  <span className="block text-xs text-text-muted">
                    {formatInsightSessionDate(test.date)} · {FORMAT_LABELS[test.format]}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {showLastTickHint && (
        <p id={LAST_TICK_HINT_ID} className="mt-2 text-xs text-text-muted">
          At least one test stays ticked.
        </p>
      )}
    </fieldset>
  );
}

/**
 * The loaded picker and Generate. Mounted once per load, so a reload (Retry)
 * starts again from the newest test ticked. While a request is in progress the
 * picker shows that request's tests, locked.
 */
function PickerAndGenerate({
  tests,
  canEdit,
  request,
  submitting,
  onGenerate,
}: {
  tests: AiTestInsightsTest[];
  canEdit: boolean;
  request: InsightRequestView | null;
  submitting: boolean;
  onGenerate: (selectedTestIds: string[], generateAgain?: boolean) => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set([tests[0].id]));
  const [confirming, setConfirming] = useState(false);
  const inProgress = isInsightRequestInProgress(request);
  // The picker's order: newest first.
  const tickedIds = tests.filter((test) => ticked.has(test.id)).map((test) => test.id);
  const again = request?.state === "completed" && sameTests(request.selectedTestIds, ticked);

  function toggle(id: string) {
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        if (next.size === 1) return current;
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <>
      <TestPicker
        tests={tests}
        ticked={inProgress && request ? new Set(request.selectedTestIds) : ticked}
        canEdit={canEdit}
        locked={inProgress}
        onToggle={toggle}
      />
      {canEdit && !inProgress && (
        <GenerateButton
          disabled={submitting}
          label={again ? "Generate again" : "Generate"}
          onClick={() => (again ? setConfirming(true) : onGenerate(tickedIds))}
        />
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        aria-labelledby={GENERATE_AGAIN_TITLE_ID}
        className="p-6"
      >
        <h3 id={GENERATE_AGAIN_TITLE_ID} className="text-lg font-bold text-text-primary">
          Generate again?
        </h3>
        <p className="mt-2 text-sm text-text-secondary">{GENERATE_AGAIN_TEXT}</p>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setConfirming(false);
              onGenerate(tickedIds, true);
            }}
          >
            Generate again
          </Button>
        </div>
      </Modal>
    </>
  );
}

/** The ticked tests are exactly a request's tests. */
function sameTests(selectedTestIds: string[], ticked: ReadonlySet<string>): boolean {
  return selectedTestIds.length === ticked.size && selectedTestIds.every((id) => ticked.has(id));
}

function GenerateButton({
  disabled,
  label = "Generate",
  onClick,
}: {
  disabled: boolean;
  label?: "Generate" | "Generate again";
  onClick?: () => void;
}) {
  return (
    <div className="mt-4">
      <Button onClick={onClick} disabled={disabled}>
        {label}
      </Button>
    </div>
  );
}

function CardBody({
  tests,
  canEdit,
  onRetry,
  request,
  submitting,
  onGenerate,
}: {
  tests: AiTestInsightsTestsState;
  canEdit: boolean;
  onRetry: () => void;
  request: InsightRequestView | null;
  submitting: boolean;
  onGenerate: (selectedTestIds: string[], generateAgain?: boolean) => void;
}) {
  // No tests to send: Generate is shown off, unless a request is in progress.
  const generateOff = canEdit && !isInsightRequestInProgress(request) && <GenerateButton disabled />;
  if (tests.status === "loading") {
    return (
      <>
        <p className="py-6 text-center text-sm text-text-muted">Loading tests…</p>
        {generateOff}
      </>
    );
  }
  if (tests.status === "failed") {
    return (
      <>
        <RetryAlert onRetry={onRetry}>Tests could not be loaded</RetryAlert>
        {generateOff}
      </>
    );
  }
  if (tests.tests.length === 0) {
    return (
      <>
        <p className="py-6 text-center text-sm text-text-muted">
          This student has no submitted Major, Full Syllabus or Mock test this year.
        </p>
        {generateOff}
      </>
    );
  }
  return (
    <PickerAndGenerate
      tests={tests.tests}
      canEdit={canEdit}
      request={request}
      submitting={submitting}
      onGenerate={onGenerate}
    />
  );
}

/** Posts Generate; returns the request to show and whether it already existed, or the message to show instead. */
async function postGenerate(
  url: string,
  selectedTestIds: string[],
  generateAgain: boolean,
): Promise<{ request: InsightRequestView; existing: boolean } | { error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(generateAgain ? { selectedTestIds, generateAgain: true } : { selectedTestIds }),
    });
    const body = (await response.json().catch(() => null)) as
      | (Partial<AiTestInsightsCreateRequestResponse> & { code?: string })
      | null;
    if (response.ok && body?.request) return { request: body.request, existing: body.outcome === "existing" };
    if (response.status === 409 && body?.code === NO_LINKED_USER_CODE) return { error: NO_LINKED_USER_MESSAGE };
    if (response.status === 503 && body?.code === NOT_CONFIGURED_CODE) return { error: NOT_CONFIGURED_MESSAGE };
  } catch {
    // A network failure reads as any other failure.
  }
  return { error: REQUEST_FAILED_MESSAGE };
}

/** The request as the status route reads it now; null when the poll failed. */
async function pollRequest(url: string): Promise<InsightRequestView | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json().catch(() => null)) as Partial<AiTestInsightsRequestStatusResponse> | null;
    return body?.request ?? null;
  } catch {
    return null;
  }
}

/**
 * Polls the shown request every 10 seconds while it is `queued` or `running`
 * and hands each answer for the same request to `onUpdate`. Stops when the
 * request reaches a final state, another request is shown or the card goes.
 * A failed poll changes nothing; the next tick tries again. One poll at a time.
 */
function useRequestPolling(
  requestsUrl: string,
  request: InsightRequestView | null,
  onUpdate: (request: InsightRequestView) => void,
) {
  const inProgress = isInsightRequestInProgress(request);
  const requestKey = request?.requestKey ?? null;

  useEffect(() => {
    if (!inProgress || requestKey === null) return;
    const url = aiTestInsightsRequestStatusUrl(requestsUrl, requestKey);
    let active = true;
    let polling = false;
    const timer = setInterval(async () => {
      if (polling) return;
      polling = true;
      const next = await pollRequest(url);
      polling = false;
      if (active && next?.requestKey === requestKey) onUpdate(next);
    }, POLL_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [requestsUrl, requestKey, inProgress, onUpdate]);
}

export default function AiTestInsightsSummaryCard({
  tests,
  canEdit,
  onRetry,
  requestsUrl,
  initialRequest = null,
}: {
  /** The page's read of the test picker route. */
  tests: AiTestInsightsTestsState;
  /** Feature access is `edit`; otherwise the picker is read-only and there is no Generate. */
  canEdit: boolean;
  /** Reads the tests again. */
  onRetry: () => void;
  /** The create route for this Student. */
  requestsUrl: string;
  /** The Student's latest request, read by the page on the server. */
  initialRequest?: InsightRequestView | null;
}) {
  const [request, setRequest] = useState<InsightRequestView | null>(initialRequest);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The shown request is the `existing` answer to the last Generate. */
  const [existing, setExisting] = useState(false);
  useRequestPolling(requestsUrl, request, setRequest);

  async function generate(selectedTestIds: string[], generateAgain = false) {
    setSubmitting(true);
    setError(null);
    const result = await postGenerate(requestsUrl, selectedTestIds, generateAgain);
    if ("request" in result) {
      setRequest(result.request);
      setExisting(result.existing);
    } else {
      setError(result.error);
    }
    setSubmitting(false);
  }

  return (
    <section aria-label="AI Summary">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-text-primary">AI Summary</h2>
        {request && (request.state === "queued" || request.state === "running") && (
          <InProgress request={{ ...request, state: request.state }} />
        )}
        {existing && request?.state === "completed" && (
          <p role="status" className="mb-3 text-sm font-medium text-text-primary">
            {EXISTING_NOTE}
          </p>
        )}
        {request?.state === "completed" && (
          <CompletedSummary key={request.requestKey} request={request} tests={tests} requestsUrl={requestsUrl} />
        )}
        {request && (request.state === "no_data" || request.state === "failed") && (
          <NoSummary
            request={{ ...request, state: request.state }}
            canEdit={canEdit}
            submitting={submitting}
            // Always a new request: `generateAgain` stops the create route from
            // answering with an earlier completed AI Summary of the same tests,
            // and the new insert closes a stalled request in the same transaction.
            onTryAgain={() => generate(request.selectedTestIds, true)}
          />
        )}
        <CardBody
          tests={tests}
          canEdit={canEdit}
          onRetry={onRetry}
          request={request}
          submitting={submitting}
          onGenerate={generate}
        />
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </Card>
    </section>
  );
}
