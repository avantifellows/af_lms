// The AI Summary card on the AI Test Insights Student page (#550, physical
// centres only). This slice gives it the test picker: the Student's submitted
// Major, Full Syllabus and Mock tests of this year, newest first, with the
// newest ticked. A Teacher ticks the tests the conversation is about, and at
// least one stays ticked; a viewer sees the list read-only. The tests come
// from the page's one read of the picker route, which the Student card's
// newest test line shares. A client component: rendered inside
// AiTestInsightsStudentSections, which holds that read.
import { useState } from "react";

import { Button, Card } from "@/components/ui";
import {
  formatInsightSessionDate,
  type AiTestInsightsTest,
  type AiTestInsightsTestFormat,
  type AiTestInsightsTestsState,
} from "@/lib/ai-test-insights-shared";

const FORMAT_LABELS: Record<AiTestInsightsTestFormat, string> = {
  major_test: "Major test",
  full_syllabus_test: "Full Syllabus test",
  mock_test: "Mock test",
};

const LAST_TICK_HINT_ID = "ai-test-insights-last-tick-hint";

/**
 * The tests, newest first. Mounted once per load, so a reload (Retry) starts
 * again from the newest test ticked.
 */
function TestPicker({ tests, canEdit }: { tests: AiTestInsightsTest[]; canEdit: boolean }) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set([tests[0].id]));

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
                  disabled={!canEdit || isLastTick}
                  aria-describedby={canEdit && isLastTick ? LAST_TICK_HINT_ID : undefined}
                  onChange={() => toggle(test.id)}
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
      {canEdit && ticked.size === 1 && (
        <p id={LAST_TICK_HINT_ID} className="mt-2 text-xs text-text-muted">
          At least one test stays ticked.
        </p>
      )}
    </fieldset>
  );
}

function CardBody({
  tests,
  canEdit,
  onRetry,
}: {
  tests: AiTestInsightsTestsState;
  canEdit: boolean;
  onRetry: () => void;
}) {
  if (tests.status === "loading") {
    return <p className="py-6 text-center text-sm text-text-muted">Loading tests…</p>;
  }
  if (tests.status === "failed") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
        <p className="text-sm text-text-primary">Tests could not be loaded</p>
        <Button variant="secondary" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }
  if (tests.tests.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-text-muted">
        This student has no submitted Major, Full Syllabus or Mock test this year.
      </p>
    );
  }
  return <TestPicker tests={tests.tests} canEdit={canEdit} />;
}

export default function AiTestInsightsSummaryCard({
  tests,
  canEdit,
  onRetry,
}: {
  /** The page's read of the test picker route. */
  tests: AiTestInsightsTestsState;
  /** Feature access is `edit`; otherwise the picker is read-only. */
  canEdit: boolean;
  /** Reads the tests again. */
  onRetry: () => void;
}) {
  return (
    <section aria-label="AI Summary">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="mb-4 text-lg font-bold text-text-primary">AI Summary</h2>
        <CardBody tests={tests} canEdit={canEdit} onRetry={onRetry} />
      </Card>
    </section>
  );
}
