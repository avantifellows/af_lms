import { Card } from "@/components/ui";
import type { CurriculumSchemaUnavailable } from "@/lib/curriculum-schema";

export default function PlanSchemaUnavailable({
  result,
}: {
  result: CurriculumSchemaUnavailable;
}) {
  return (
    <Card className="border-l-4 border-l-warning-border p-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
          Schema unavailable
        </p>
        <h2 className="text-lg font-bold text-text-primary">{result.error}</h2>
        <p className="text-sm text-text-secondary">
          Curriculum Plans cannot load until the Curriculum Plan tables are
          available.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-sm font-mono text-text-secondary">
          {result.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
