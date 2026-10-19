"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card } from "@/components/ui";
import type { CurriculumPlanDisplayStatus } from "@/lib/curriculum-plan-rules";
import type { CurriculumPlanChapter } from "@/lib/curriculum-plans";
import { PLAN_STATUS_BADGE_VARIANTS, PLAN_STATUS_LABELS } from "../plan-status";

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
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  const undated = chapters.filter((chapter) => !chapter.dueDate);
  const isDraft = displayStatus === "draft";

  async function activate() {
    setError("");
    setWorking(true);
    try {
      const response = await fetch(`/api/curriculum/plans/${planId}/activate`, { method: "POST" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error ?? "Could not activate the plan");
        return;
      }
      setConfirming(null);
      setMessage("Plan activated.");
      router.refresh();
    } catch {
      setError("Could not activate the plan");
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    setError("");
    setWorking(true);
    try {
      const response = await fetch(`/api/curriculum/plans/${planId}`, { method: "DELETE" });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.error ?? "Could not delete the plan");
        return;
      }
      router.push(`/curriculum-summary/plans?academic_year=${academicYear}&grade=${grade}`);
    } catch {
      setError("Could not delete the plan");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-bold text-text-primary">Status</span>
        <Badge variant={PLAN_STATUS_BADGE_VARIANTS[displayStatus]} data-testid="plan-status">
          {PLAN_STATUS_LABELS[displayStatus]}
        </Badge>
        {isDraft ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={readOnly || working}
              onClick={() => {
                setError("");
                setConfirming("activate");
              }}
            >
              Activate plan
            </Button>
            <Button
              type="button"
              variant="danger-ghost"
              disabled={readOnly || working}
              onClick={() => {
                setError("");
                setConfirming("delete");
              }}
            >
              Delete plan
            </Button>
          </div>
        ) : null}
      </div>
      {isDraft && confirming === "activate" ? (
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
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={working} onClick={activate}>
              {undated.length > 0 ? "Activate anyway" : "Confirm activation"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {isDraft && confirming === "delete" ? (
        <div
          data-testid="plan-delete-confirm"
          className="space-y-3 rounded-md border border-danger bg-danger-bg p-4 text-sm text-danger"
        >
          <p className="font-bold">
            Delete this Draft plan? Its Chapter dates and Plan Assignments are removed too.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="danger" disabled={working} onClick={remove}>
              Confirm delete
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p data-testid="plan-lifecycle-error" className="text-sm font-bold text-danger">
          {error}
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
