// The Student card on the AI Test Insights Student page (#550): who the
// Student is and how many Insight Sessions they have had. A missing value
// shows a dash.
import { Card } from "@/components/ui";
import { formatInsightSessionDate, type AiTestInsightsStudentCardData } from "@/lib/ai-test-insights-shared";

const DASH = "—";

export default function AiTestInsightsStudentCard({ student }: { student: AiTestInsightsStudentCardData }) {
  const fields: Array<[string, string]> = [
    ["Student ID", student.studentCode || DASH],
    ["Grade", String(student.grade)],
    ["Batch", student.batches.length > 0 ? student.batches.join(", ") : DASH],
    ["Gender", student.gender || DASH],
    ["Category", student.category || DASH],
    ["Stream", student.stream || DASH],
    ["Insight Sessions completed", String(student.insightSessionsCompleted)],
    ["Last Insight Session", formatInsightSessionDate(student.lastInsightSessionDate) || DASH],
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
