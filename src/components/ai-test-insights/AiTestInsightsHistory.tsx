"use client";

// The History section of the AI Test Insights Student page (#576, physical
// centres only), for everyone who can open the page: the Student's timeline
// from the page's one read of the sessions route, in the order the server
// gave it (newest first). A session entry shows its date, its author, its
// notes, "Edited on <date>" (in India) once it has been edited, and the Test
// Insight it records; a Test Insight entry shows that Test Insight alone. A
// failed read stays inside this section, with Retry. No pagination, search or
// filter.
//
// Every Test Insight in it (by itself or the one a session records) has
// "View AI Summary" (#577), which opens the shared `TestInsightSummary` in
// place (the AI Summary card's piece: text, Download PDF, the tests and who
// asked) and closes it again. The text is read only once it is opened, through
// part 1's summary and PDF routes with the page's `centre`; nothing polls.
import { useId, useState } from "react";

import TestInsightMadeBy from "@/components/ai-test-insights/TestInsightMadeBy";
import TestInsightSummary from "@/components/ai-test-insights/TestInsightSummary";
import { Button, Card } from "@/components/ui";
import { RetryAlert } from "@/components/ui/RetryAlert";
import type { SessionsRead } from "@/hooks/use-ai-test-insights-sessions";
import { sessionNotesFieldName, SESSION_NOTES_TEXT_FIELDS } from "@/lib/ai-test-insights-session-notes-rules";
import {
  aiSummaryTitle,
  formatInsightSessionDate,
  insightRequestDateInIndia,
  type AiTestInsightsTestsState,
  type InsightRequestView,
} from "@/lib/ai-test-insights-shared";
import type { TimelineEntry } from "@/lib/ai-test-insights-timeline";

const EMPTY_MESSAGE = "No Insight Sessions or AI Summaries yet.";

interface TestInsightProps {
  request: InsightRequestView;
  tests: AiTestInsightsTestsState;
  /** The Student's requests route, with the page's `centre`. */
  requestsUrl: string;
}

/**
 * One Test Insight: its name, then the tests it was made from and who asked
 * for it and when; opened, the shared piece shows those with its text and PDF.
 */
function TestInsightLine({ request, tests, requestsUrl }: TestInsightProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text-primary">{aiSummaryTitle(request)}</p>
      {open ? (
        <div id={panelId}>
          <TestInsightSummary request={request} tests={tests} requestsUrl={requestsUrl} />
        </div>
      ) : (
        <TestInsightMadeBy request={request} tests={tests} />
      )}
      <Button variant="secondary" size="sm" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(!open)}>
        {open ? "Hide AI Summary" : "View AI Summary"}
      </Button>
    </div>
  );
}

function SessionEntry({
  entry,
  tests,
  requestsUrl,
}: {
  entry: Extract<TimelineEntry, { kind: "session" }>;
  tests: AiTestInsightsTestsState;
  requestsUrl: string;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-text-primary">{formatInsightSessionDate(entry.sessionDate)}</h3>
        <p className="text-xs text-text-secondary">Notes by {entry.authorName}</p>
        {entry.lastEditedAt && (
          <p className="text-xs text-text-muted">
            Edited on {formatInsightSessionDate(insightRequestDateInIndia(entry.lastEditedAt))}
          </p>
        )}
      </div>
      <dl className="space-y-2">
        {SESSION_NOTES_TEXT_FIELDS.map((field) => {
          const text = entry[field];
          if (text === null) return null;
          return (
            <div key={field}>
              <dt className="text-xs font-medium text-text-secondary">{sessionNotesFieldName(field)}</dt>
              <dd className="whitespace-pre-line break-words text-sm text-text-primary">{text}</dd>
            </div>
          );
        })}
      </dl>
      {entry.testInsight && <TestInsightLine request={entry.testInsight} tests={tests} requestsUrl={requestsUrl} />}
    </div>
  );
}

export default function AiTestInsightsHistory({
  sessions,
  tests,
  requestsUrl,
}: {
  /** The page's read of the sessions route. */
  sessions: SessionsRead;
  /** The page's read of the test picker route, which names the tests. */
  tests: AiTestInsightsTestsState;
  /** The Student's requests route, with the page's `centre`: View AI Summary reads its summary and PDF routes. */
  requestsUrl: string;
}) {
  const { state } = sessions;
  let body;
  if (state.status === "loading") {
    body = <p className="text-sm text-text-secondary">Loading history…</p>;
  } else if (state.status === "failed") {
    body = <RetryAlert onRetry={sessions.reload}>History could not be loaded.</RetryAlert>;
  } else if (state.sessions.timeline.length === 0) {
    body = <p className="text-sm text-text-secondary">{EMPTY_MESSAGE}</p>;
  } else {
    body = (
      <ol className="divide-y divide-border">
        {state.sessions.timeline.map((entry) => (
          <li
            key={entry.kind === "session" ? `session-${entry.sessionId}` : `insight-${entry.testInsight.requestKey}`}
            className="py-4 first:pt-0 last:pb-0"
          >
            {entry.kind === "session" ? (
              <SessionEntry entry={entry} tests={tests} requestsUrl={requestsUrl} />
            ) : (
              <TestInsightLine request={entry.testInsight} tests={tests} requestsUrl={requestsUrl} />
            )}
          </li>
        ))}
      </ol>
    );
  }

  return (
    <section aria-label="History">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-text-primary">History</h2>
        {body}
      </Card>
    </section>
  );
}
