import { SchemaUnavailableCard } from "@/app/curriculum-summary/summary-ui";

// The 503 card shown on the Curriculum Plan pages while the plan tables are missing.
export default function PlanSchemaUnavailable({
  result,
}: {
  result: { error: string; details: string[] };
}) {
  return (
    <SchemaUnavailableCard error={result.error} details={result.details}>
      <p className="text-sm text-text-secondary">
        Curriculum Plans cannot load until the Curriculum Plan tables are available.
      </p>
    </SchemaUnavailableCard>
  );
}
