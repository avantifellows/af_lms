"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@/components/ui";
import type { CurriculumPlanCopyMode } from "@/lib/curriculum-plans";

interface Props {
  planId: number;
  readOnly: boolean;
}

// Copy a plan of any status into a new Draft with no Plan Assignments: a same-year variant
// with its dates kept, or next year's starting point with every date one year later.
export default function CurriculumPlanCopy({ planId, readOnly }: Props) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  async function copy(mode: CurriculumPlanCopyMode) {
    setError("");
    setWorking(true);
    try {
      const response = await fetch(`/api/curriculum/plans/${planId}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error ?? "Could not copy the plan");
        setWorking(false);
        return;
      }
      router.push(`/curriculum-summary/plans/${json.plan.id}`);
    } catch {
      setError("Could not copy the plan");
      setWorking(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm font-bold text-text-primary">Copy</p>
          <p className="text-sm text-text-secondary">
            Copies start as a Draft with no Plan Assignments. Copy to next year moves every
            date forward one year.
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={readOnly || working}
            onClick={() => copy("same_year")}
          >
            Copy plan
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={readOnly || working}
            onClick={() => copy("next_year")}
          >
            Copy to next year
          </Button>
        </div>
      </div>
      {error ? (
        <p data-testid="plan-copy-error" className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </Card>
  );
}
