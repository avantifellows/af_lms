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
// which posts that request's tests again with no confirmation; the picker and
// Generate stay usable beneath it.
//
// Generate delivers the request to AI Mentorship Guide (#562). A request the
// generator refused comes back `failed` (`enqueue_rejected`) and shows as any
// failed request. An environment without the delivery settings answers 503
// `not_configured`, and the card says so in plain words.
import { useState, useSyncExternalStore } from "react";

import { Button, Card } from "@/components/ui";
import {
  formatInsightSessionDate,
  isInsightRequestInProgress,
  NO_LINKED_USER_CODE,
  NOT_CONFIGURED_CODE,
  type AiTestInsightsCreateRequestResponse,
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
  onGenerate: (selectedTestIds: string[]) => void;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set([tests[0].id]));
  const inProgress = isInsightRequestInProgress(request);

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
          // The picker's order: newest first.
          onClick={() => onGenerate(tests.filter((test) => ticked.has(test.id)).map((test) => test.id))}
        />
      )}
    </>
  );
}

function GenerateButton({ disabled, onClick }: { disabled: boolean; onClick?: () => void }) {
  return (
    <div className="mt-4">
      <Button onClick={onClick} disabled={disabled}>
        Generate
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
  onGenerate: (selectedTestIds: string[]) => void;
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
        <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
          <p className="text-sm text-text-primary">Tests could not be loaded</p>
          <Button variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        </div>
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

/** Posts Generate; returns the request to show, or the message to show instead. */
async function postGenerate(
  url: string,
  selectedTestIds: string[],
): Promise<{ request: InsightRequestView } | { error: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedTestIds }),
    });
    const body = (await response.json().catch(() => null)) as
      | (Partial<AiTestInsightsCreateRequestResponse> & { code?: string })
      | null;
    if (response.ok && body?.request) return { request: body.request };
    if (response.status === 409 && body?.code === NO_LINKED_USER_CODE) return { error: NO_LINKED_USER_MESSAGE };
    if (response.status === 503 && body?.code === NOT_CONFIGURED_CODE) return { error: NOT_CONFIGURED_MESSAGE };
  } catch {
    // A network failure reads as any other failure.
  }
  return { error: REQUEST_FAILED_MESSAGE };
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

  async function generate(selectedTestIds: string[]) {
    setSubmitting(true);
    setError(null);
    const result = await postGenerate(requestsUrl, selectedTestIds);
    if ("request" in result) setRequest(result.request);
    else setError(result.error);
    setSubmitting(false);
  }

  return (
    <section aria-label="AI Summary">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-text-primary">AI Summary</h2>
        {request && (request.state === "queued" || request.state === "running") && (
          <InProgress request={{ ...request, state: request.state }} />
        )}
        {request && (request.state === "no_data" || request.state === "failed") && (
          <NoSummary
            request={{ ...request, state: request.state }}
            canEdit={canEdit}
            submitting={submitting}
            onTryAgain={() => generate(request.selectedTestIds)}
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
