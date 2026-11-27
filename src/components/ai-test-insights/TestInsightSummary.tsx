"use client";

// One completed Test Insight (#564, #565, #577), shared by the AI Summary card
// and the History timeline: its AI Summary text, read once from part 1's
// summary route and rendered as formatted Markdown, a "Download PDF" link to
// part 1's PDF route, the tests it was made from (named from the picker list;
// an id the list does not hold reads "an earlier test") and who asked for it
// and when. Both routes are reached through `requestsUrl`, which carries the
// page's `centre`. A failed text read shows an error with Retry here; a failed
// download keeps the page and shows a message with Retry. Nothing here polls,
// wakes or enqueues. Viewers read and download too.
import { useState, type MouseEvent } from "react";

import TestInsightMadeBy from "@/components/ai-test-insights/TestInsightMadeBy";
import TestInsightText from "@/components/ai-test-insights/TestInsightText";
import { RetryAlert } from "@/components/ui/RetryAlert";
import { useFetchWithRetry } from "@/hooks/use-fetch-with-retry";
import {
  aiTestInsightsRequestPdfUrl,
  aiTestInsightsRequestSummaryUrl,
  NOT_CONFIGURED_CODE,
  type AiTestInsightsPdfResponse,
  type AiTestInsightsSummaryResponse,
  type AiTestInsightsTestsState,
  type InsightRequestView,
} from "@/lib/ai-test-insights-shared";

type SummaryTextState = { status: "loading" } | { status: "failed" } | { status: "loaded"; markdown: string };

/** The AI Summary text is read fresh each time, never from the browser's cache. */
const SUMMARY_TEXT_FETCH: RequestInit = { cache: "no-store" };

async function readSummaryText(response: Response): Promise<SummaryTextState> {
  const body = (await response.json().catch(() => null)) as Partial<AiTestInsightsSummaryResponse> | null;
  return response.ok && typeof body?.markdown === "string"
    ? { status: "loaded", markdown: body.markdown }
    : { status: "failed" };
}

const PDF_NOT_CONFIGURED_MESSAGE =
  "The PDF can't be downloaded here: AI Summary reading is not set up in this environment.";
const PDF_NOT_FOUND_MESSAGE = "The PDF of this AI Summary could not be found.";
const PDF_FAILED_MESSAGE = "The PDF could not be downloaded. Please try again.";

/**
 * Asks the PDF route for JSON: on success it answers the 60-second presigned
 * URL of the file. Otherwise the message to show: the route answers 404 (no
 * PDF), 503 (reading not set up) and 502 (unreadable).
 */
async function askForPdf(url: string): Promise<{ ok: true; fileUrl: string } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = (await response.json().catch(() => null)) as
      | (Partial<AiTestInsightsPdfResponse> & { code?: string })
      | null;
    if (response.ok && typeof body?.url === "string") return { ok: true, fileUrl: body.url };
    if (response.status === 503 && body?.code === NOT_CONFIGURED_CODE) return { ok: false, message: PDF_NOT_CONFIGURED_MESSAGE };
    if (response.status === 404) return { ok: false, message: PDF_NOT_FOUND_MESSAGE };
  } catch {
    // A network failure reads as any other failure.
  }
  return { ok: false, message: PDF_FAILED_MESSAGE };
}

/**
 * "Download PDF" (#565). A plain click asks the route for the file's
 * presigned URL and sends the browser there; the store answers it as a
 * download (named `ai-summary-<student.id>-<date>.pdf`), so the page stays.
 * Any other answer keeps the Student page and shows a message with Retry
 * (PR #573 review: the bare link replaced the page with the JSON). One call
 * to the route per click; nothing is written. A click that opens a new tab or
 * window is left to the browser, and the route answers it with its 302.
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
    if (result.ok) window.location.assign(result.fileUrl);
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
export default function TestInsightSummary({
  request,
  tests,
  requestsUrl,
}: {
  request: InsightRequestView;
  /** The page's read of the test picker route, which names the tests. */
  tests: AiTestInsightsTestsState;
  /** The Student's requests route, with the page's `centre`. */
  requestsUrl: string;
}) {
  // Read once, and again on each Retry; an unmount or a newer read drops an older answer.
  const { state, retry } = useFetchWithRetry(
    aiTestInsightsRequestSummaryUrl(requestsUrl, request.requestKey),
    readSummaryText,
    SUMMARY_TEXT_FETCH,
  );
  return (
    <div className="space-y-4">
      {state.status === "loading" && (
        <p className="py-6 text-center text-sm text-text-muted">Loading the AI Summary…</p>
      )}
      {state.status === "failed" && <RetryAlert onRetry={retry}>The AI Summary could not be loaded</RetryAlert>}
      {state.status === "loaded" && <TestInsightText markdown={state.markdown} />}
      <DownloadPdf url={aiTestInsightsRequestPdfUrl(requestsUrl, request.requestKey)} />
      <TestInsightMadeBy request={request} tests={tests} />
    </div>
  );
}
