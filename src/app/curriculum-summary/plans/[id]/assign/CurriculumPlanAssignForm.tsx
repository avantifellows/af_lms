"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@/components/ui";
import type {
  EligibleCentre,
  PlanAssignmentPreview,
  PlanAssignmentPreviewCentre,
} from "@/lib/curriculum-plan-assignments";
import { formatExamTrack } from "@/lib/exam-tracks";

interface Props {
  planId: number;
  centres: EligibleCentre[];
  readOnly: boolean;
}

type PreviewState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; preview: PlanAssignmentPreview };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function groupByRegion(centres: EligibleCentre[]): [string, EligibleCentre[]][] {
  const groups = new Map<string, EligibleCentre[]>();
  for (const centre of centres) {
    const region = centre.region || "No region";
    groups.set(region, [...(groups.get(region) ?? []), centre]);
  }
  return [...groups.entries()];
}

// The server's preview of saving the ticked set: moves, removals and uncovered tracks. Reloads
// whenever the ticked set changes or `version` is bumped (after a save, or Retry); until the
// answer for the current request arrives the preview is loading.
function usePlanAssignmentPreview(planId: number, ticked: Set<number>, version: number): PreviewState {
  const requestKey = `${planId}:${version}:${[...ticked].join(",")}`;
  const [answer, setAnswer] = useState<{ key: string; state: PreviewState } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const settle = (state: PreviewState) => setAnswer({ key: requestKey, state });
    fetch(`/api/curriculum/plans/${planId}/assignments/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centre_ids: [...ticked] }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        settle(response.ok && json.preview ? { status: "ready", preview: json.preview } : { status: "error" });
      })
      .catch(() => {
        if (!controller.signal.aborted) settle({ status: "error" });
      });
    return () => controller.abort();
  }, [planId, ticked, requestKey]);

  return answer?.key === requestKey ? answer.state : { status: "loading" };
}

async function saveAssignments(planId: number, ticked: Set<number>): Promise<string | null> {
  try {
    const response = await fetch(`/api/curriculum/plans/${planId}/assignments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centre_ids: [...ticked] }),
    });
    if (response.ok) return null;
    const json = await response.json().catch(() => ({}));
    return json.errors?.[0]?.message ?? json.error ?? "Could not save the assignments";
  } catch {
    return "Could not save the assignments";
  }
}

// Assign by plan: tick the eligible Centres (grouped by region) that should be on this plan.
// The server previews moves, removals and uncovered tracks for the ticked set; Save waits for
// that preview, and the server recomputes everything on Save.
export default function CurriculumPlanAssignForm({ planId, centres, readOnly }: Props) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<number>>(
    () =>
      new Set(
        centres.filter((centre) => centre.currentPlan?.id === planId).map((centre) => centre.centreId)
      )
  );
  const [previewVersion, setPreviewVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const preview = usePlanAssignmentPreview(planId, ticked, previewVersion);
  const regions = useMemo(() => groupByRegion(centres), [centres]);
  const previewById = new Map(
    preview.status === "ready" ? preview.preview.centres.map((centre) => [centre.centreId, centre]) : []
  );

  function toggle(centreId: number, checked: boolean) {
    setSavedMessage("");
    setTicked((current) => {
      const next = new Set(current);
      if (checked) next.add(centreId);
      else next.delete(centreId);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError("");
    setSavedMessage("");
    const saveError = await saveAssignments(planId, ticked);
    setSaving(false);
    if (saveError) {
      setError(saveError);
      return;
    }
    setSavedMessage("Assignments saved.");
    setPreviewVersion((version) => version + 1);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div data-testid="assign-summary" className="text-sm text-text-primary">
          <p className="font-bold">{plural(ticked.size, "Centre", "Centres")} ticked</p>
          <PreviewSummary
            state={preview}
            onRetry={() => setPreviewVersion((version) => version + 1)}
          />
        </div>
        <div className="ml-auto">
          <Button
            type="button"
            disabled={readOnly || saving || preview.status !== "ready"}
            onClick={save}
          >
            Save assignments
          </Button>
        </div>
        <Message testId="assign-error" className="text-danger" text={error} />
        <Message role="status" className="text-success" text={savedMessage} />
      </Card>
      {centres.length === 0 ? (
        <Card className="p-6 text-sm text-text-secondary">
          No eligible Centres: active physical JNV Centres need a Centre Exam Track for this
          Grade.
        </Card>
      ) : null}
      {regions.map(([region, regionCentres]) => (
        <Card key={region} className="p-4">
          <fieldset disabled={readOnly} className="space-y-2">
            <legend className="text-sm font-bold uppercase tracking-wide text-text-muted">
              {region}
            </legend>
            {regionCentres.map((centre) => (
              <CentreRow
                key={centre.centreId}
                centre={centre}
                planId={planId}
                ticked={ticked.has(centre.centreId)}
                preview={ticked.has(centre.centreId) ? previewById.get(centre.centreId) : undefined}
                onToggle={toggle}
              />
            ))}
          </fieldset>
        </Card>
      ))}
    </div>
  );
}

function Message({
  text,
  className,
  testId,
  role,
}: {
  text: string;
  className: string;
  testId?: string;
  role?: string;
}) {
  if (!text) return null;
  return (
    <p data-testid={testId} role={role} className={`w-full text-sm font-bold ${className}`}>
      {text}
    </p>
  );
}

function PreviewSummary({ state, onRetry }: { state: PreviewState; onRetry: () => void }) {
  if (state.status === "loading") {
    return <p className="text-text-muted">Checking moves…</p>;
  }
  if (state.status === "error") {
    return (
      <p data-testid="assign-preview-error" className="font-bold text-danger">
        Could not check moves and removals, so saving is paused.{" "}
        <button type="button" onClick={onRetry} className="underline">
          Try again
        </button>
      </p>
    );
  }
  const { preview } = state;
  const ineligible = preview.removedCentres.filter((centre) => !centre.eligible);
  return (
    <>
      <p data-testid="assign-move-count">
        {preview.moveCount === 0
          ? "No Centres move from another plan"
          : `${plural(preview.moveCount, "Centre moves", "Centres move")} from another plan`}
        {preview.removeCount > 0
          ? ` · ${plural(preview.removeCount, "assignment", "assignments")} removed`
          : ""}
      </p>
      {ineligible.length > 0 ? (
        <p data-testid="assign-ineligible-removals" className="font-bold text-warning-text">
          Saving also removes {plural(ineligible.length, "Centre", "Centres")} no longer eligible
          for this plan: {ineligible.map((centre) => centre.centreName).join(", ")}
        </p>
      ) : null}
    </>
  );
}

function CentreRow({
  centre,
  planId,
  ticked,
  preview,
  onToggle,
}: {
  centre: EligibleCentre;
  planId: number;
  ticked: boolean;
  preview: PlanAssignmentPreviewCentre | undefined;
  onToggle: (centreId: number, checked: boolean) => void;
}) {
  const onOtherPlan = centre.currentPlan !== null && centre.currentPlan.id !== planId;
  return (
    <div
      data-assign-centre-row
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 text-sm last:border-b-0"
    >
      <label className="flex items-center gap-2 font-bold text-text-primary">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(event) => onToggle(centre.centreId, event.target.checked)}
        />
        {centre.centreName}
      </label>
      <span className="text-text-secondary">
        {centre.schoolName}
        {centre.programName ? ` · ${centre.programName}` : ""} ·{" "}
        {centre.mappedTracks.map(formatExamTrack).join(", ")}
      </span>
      <PreviewNotes centre={centre} onOtherPlan={onOtherPlan} preview={preview} />
    </div>
  );
}

function PreviewNotes({
  centre,
  onOtherPlan,
  preview,
}: {
  centre: EligibleCentre;
  onOtherPlan: boolean;
  preview: PlanAssignmentPreviewCentre | undefined;
}) {
  const moving = preview?.moves && preview.currentPlan ? preview.currentPlan : null;
  const uncovered = preview?.uncoveredTracks ?? [];
  return (
    <>
      {onOtherPlan && !preview?.moves ? (
        <span className="text-text-muted">On {centre.currentPlan?.title}</span>
      ) : null}
      {moving ? <span className="font-bold text-warning-text">Moves from {moving.title}</span> : null}
      {uncovered.length > 0 ? (
        <span className="font-bold text-warning-text">
          ⚠ not covered: {uncovered.map(formatExamTrack).join(", ")}
        </span>
      ) : null}
    </>
  );
}
