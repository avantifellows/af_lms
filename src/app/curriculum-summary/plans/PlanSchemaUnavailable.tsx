import { Card } from "@/components/ui";

interface SchemaUnavailableResult {
  error: string;
  details: string[];
}

// The 503 card shown while a curriculum page's db-service schema is missing.
export function SchemaUnavailableCard({
  result,
  description,
}: {
  result: SchemaUnavailableResult;
  description: string;
}) {
  return (
    <Card className="border-l-4 border-l-warning-border p-6">
      <div className="flex flex-col gap-3">
        <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
          Schema unavailable
        </p>
        <h2 className="text-lg font-bold text-text-primary">{result.error}</h2>
        <p className="text-sm text-text-secondary">{description}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm font-mono text-text-secondary">
          {result.details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

export default function PlanSchemaUnavailable({ result }: { result: SchemaUnavailableResult }) {
  return (
    <SchemaUnavailableCard
      result={result}
      description="Curriculum Plans cannot load until the Curriculum Plan tables are available."
    />
  );
}
