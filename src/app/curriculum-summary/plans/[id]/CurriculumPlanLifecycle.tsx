"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card } from "@/components/ui";
import type { CurriculumPlanDisplayStatus } from "@/lib/curriculum-plan-rules";
import type { CurriculumPlanChapter } from "@/lib/curriculum-plans";
import { PLAN_STATUS_BADGE_VARIANTS, PLAN_STATUS_LABELS } from "../plan-status";
import { planRequest, usePlanAction } from "../plan-requests";

interface Props {
  planId: number;
  displayStatus: CurriculumPlanDisplayStatus;
  academicYear: string;
  grade: number;
  chapters: CurriculumPlanChapter[];
  readOnly: boolean;
}

type Confirming = "activate" | "delete" | null;

// Draft → Active and Draft delete. Active and Closed plans have no lifecycle controls:
// they cannot return to Draft or be deleted.
export default function CurriculumPlanLifecycle({
  planId,
  displayStatus,
  academicYear,
  grade,
  chapters,
  readOnly,
}: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Confirming>(null);
  const [message, setMessage] = useState("");
  const action = usePlanAction();
  const isDraft = displayStatus === "draft";

  function ask(next: Confirming) {
    action.setError("");
    setConfirming(next);
  }

  async function activate() {
    const done = await action.run(
      () => planRequest(`/api/curriculum/plans/${planId}/activate`, "POST"),
      "Could not activate the plan"
    );
    if (!done) return;
    setConfirming(null);
    setMessage("Plan activated.");
    router.refresh();
  }

  async function remove() {
    const done = await action.run(
      () => planRequest(`/api/curriculum/plans/${planId}`, "DELETE"),
      "Could not delete the plan"
    );
    if (done) router.push(`/curriculum-summary/plans?academic_year=${academicYear}&grade=${grade}`);
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-text-primary">Status</span>
        <Badge variant={PLAN_STATUS_BADGE_VARIANTS[displayStatus]} data-testid="plan-status">
          {PLAN_STATUS_LABELS[displayStatus]}
        </Badge>
        {isDraft ? <DraftActions disabled={readOnly || action.working} onAsk={ask} /> : null}
      </div>
      {isDraft && confirming === "activate" ? (
        <ActivateConfirm
          chapters={chapters}
          working={action.working}
          onConfirm={activate}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
      {isDraft && confirming === "delete" ? (
        <DeleteConfirm working={action.working} onConfirm={remove} onCancel={() => setConfirming(null)} />
      ) : null}
      {action.error ? (
        <p data-testid="plan-lifecycle-error" className="text-sm font-bold text-danger">
          {action.error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm font-bold text-success">
          {message}
        </p>
      ) : null}
    </Card>
  );
}

function DraftActions({ disabled, onAsk }: { disabled: boolean; onAsk: (next: Confirming) => void }) {
  return (
    <div className="ml-auto flex flex-wrap gap-2">
      <Button type="button" disabled={disabled} onClick={() => onAsk("activate")}>
        Activate plan
      </Button>
      <Button type="button" variant="danger-ghost" disabled={disabled} onClick={() => onAsk("delete")}>
        Delete plan
      </Button>
    </div>
  );
}

interface ConfirmProps {
  working: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ActivateConfirm({ chapters, working, onConfirm, onCancel }: ConfirmProps & { chapters: CurriculumPlanChapter[] }) {
  const undated = chapters.filter((chapter) => !chapter.dueDate);
  return (
    <div
      data-testid="plan-activate-confirm"
      className="space-y-3 rounded-md border border-warning-border bg-warning-bg p-4 text-sm text-warning-text"
    >
      {undated.length > 0 ? (
        <>
          <p className="font-bold">
            {undated.length} {undated.length === 1 ? "Chapter has" : "Chapters have"} no
            Chapter Due Date and will show as Not in plan:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {undated.map((chapter) => (
              <li key={chapter.chapterId}>{chapter.chapterName}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="font-bold">Every Chapter has a Chapter Due Date.</p>
      )}
      <p>An Active plan cannot go back to Draft or be deleted.</p>
      <ConfirmButtons
        label={undated.length > 0 ? "Activate anyway" : "Confirm activation"}
        working={working}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}

function DeleteConfirm({ working, onConfirm, onCancel }: ConfirmProps) {
  return (
    <div
      data-testid="plan-delete-confirm"
      className="space-y-3 rounded-md border border-danger bg-danger-bg p-4 text-sm text-danger"
    >
      <p className="font-bold">
        Delete this Draft plan? Its Chapter dates and Plan Assignments are removed too.
      </p>
      <ConfirmButtons
        label="Confirm delete"
        variant="danger"
        working={working}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    </div>
  );
}

function ConfirmButtons({
  label,
  variant,
  working,
  onConfirm,
  onCancel,
}: ConfirmProps & { label: string; variant?: "danger" }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant={variant} disabled={working} onClick={onConfirm}>
        {label}
      </Button>
      <Button type="button" variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}
