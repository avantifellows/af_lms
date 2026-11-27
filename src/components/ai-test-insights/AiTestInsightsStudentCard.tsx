// The Student card on the AI Test Insights Student page (#550): who the
// Student is, how many Insight Sessions they have had, and their newest test.
// A missing value shows a dash.
import { Card } from "@/components/ui";
import {
  formatInsightSessionDate,
  type AiTestInsightsStudentCardData,
  type AiTestInsightsTestsState,
} from "@/lib/ai-test-insights-shared";

const DASH = "—";

/** The newest test: the test picker's first row, from the same read as the picker. */
function newestTest(tests: AiTestInsightsTestsState): string {
  if (tests.status === "loading") return "Loading…";
  if (tests.status === "failed") return "unavailable";
  const [newest] = tests.tests;
  return newest ? `${newest.name} · ${formatInsightSessionDate(newest.date)}` : DASH;
}

export default function AiTestInsightsStudentCard({
  student,
  tests,
}: {
  student: AiTestInsightsStudentCardData;
  /** The test picker's read. */
  tests: AiTestInsightsTestsState;
}) {
  const fields: Array<[string, string]> = [
    ["Student ID", student.studentCode || DASH],
    ["Grade", String(student.grade)],
    ["Batch", student.batches.length > 0 ? student.batches.join(", ") : DASH],
    ["Gender", student.gender || DASH],
    ["Category", student.category || DASH],
    ["Stream", student.stream || DASH],
    ["Insight Sessions completed", String(student.insightSessionsCompleted)],
    ["Last Insight Session", formatInsightSessionDate(student.lastInsightSessionDate) || DASH],
    ["Newest test", newestTest(tests)],
  ];

  return (
    <section aria-label="Student">
      <Card elevation="sm" className="p-4 sm:p-6">
        <h2 className="break-words text-xl font-bold text-text-primary sm:text-2xl">{student.name}</h2>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          {fields.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</dt>
              <dd className="break-words text-sm text-text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </section>
  );
}
