"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@/components/ui";
import type {
  EligibleCentre,
  PlanAssignmentPreview,
} from "@/lib/curriculum-plan-assignments";
import { formatExamTrack } from "@/lib/exam-tracks";

interface Props {
  planId: number;
  centres: EligibleCentre[];
  readOnly: boolean;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

// Assign by plan: tick the eligible Centres (grouped by region) that should be on this plan.
// The server previews moves and uncovered tracks for the ticked set before Save, and
// recomputes them on Save.
export default function CurriculumPlanAssignForm({ planId, centres, readOnly }: Props) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<number>>(
    () =>
      new Set(
        centres.filter((centre) => centre.currentPlan?.id === planId).map((centre) => centre.centreId)
      )
  );
  const [preview, setPreview] = useState<PlanAssignmentPreview | null>(null);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const regions = useMemo(() => {
    const groups = new Map<string, EligibleCentre[]>();
    for (const centre of centres) {
      const region = centre.region || "No region";
      groups.set(region, [...(groups.get(region) ?? []), centre]);
    }
    return [...groups.entries()];
  }, [centres]);

  useEffect(() => {
    const controller = new AbortController();
    setPreview(null);
    fetch(`/api/curriculum/plans/${planId}/assignments/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centre_ids: [...ticked] }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = await response.json().catch(() => ({}));
        if (response.ok) setPreview(json.preview);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [planId, ticked, previewVersion]);

  const previewById = new Map(preview?.centres.map((centre) => [centre.centreId, centre]));

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
    try {
      const response = await fetch(`/api/curriculum/plans/${planId}/assignments`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ centre_ids: [...ticked] }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.errors?.[0]?.message ?? json.error ?? "Could not save the assignments");
        return;
      }
      setSavedMessage("Assignments saved.");
      setPreviewVersion((version) => version + 1);
      router.refresh();
    } catch {
      setError("Could not save the assignments");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div data-testid="assign-summary" className="text-sm text-text-primary">
          <p className="font-bold">{plural(ticked.size, "Centre", "Centres")} ticked</p>
          {preview ? (
            <p data-testid="assign-move-count">
              {preview.moveCount === 0
                ? "No Centres move from another plan"
                : `${plural(preview.moveCount, "Centre moves", "Centres move")} from another plan`}
              {preview.removeCount > 0
                ? ` · ${plural(preview.removeCount, "assignment", "assignments")} removed`
                : ""}
            </p>
          ) : (
            <p className="text-text-muted">Checking moves…</p>
          )}
        </div>
        <div className="ml-auto">
          <Button type="button" disabled={readOnly || saving} onClick={save}>
            Save assignments
          </Button>
        </div>
        {error ? (
          <p data-testid="assign-error" className="w-full text-sm font-bold text-danger">
            {error}
          </p>
        ) : null}
        {savedMessage ? (
          <p role="status" className="w-full text-sm font-bold text-success">
            {savedMessage}
          </p>
        ) : null}
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
            {regionCentres.map((centre) => {
              const isTicked = ticked.has(centre.centreId);
              const centrePreview = isTicked ? previewById.get(centre.centreId) : undefined;
              return (
                <div
                  key={centre.centreId}
                  data-assign-centre-row
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 text-sm last:border-b-0"
                >
                  <label className="flex items-center gap-2 font-bold text-text-primary">
                    <input
                      type="checkbox"
                      checked={isTicked}
                      onChange={(event) => toggle(centre.centreId, event.target.checked)}
                    />
                    {centre.centreName}
                  </label>
                  <span className="text-text-secondary">
                    {centre.schoolName}
                    {centre.programName ? ` · ${centre.programName}` : ""} ·{" "}
                    {centre.mappedTracks.map(formatExamTrack).join(", ")}
                  </span>
                  {centre.currentPlan && centre.currentPlan.id !== planId && !centrePreview?.moves ? (
                    <span className="text-text-muted">On {centre.currentPlan.title}</span>
                  ) : null}
                  {centrePreview?.moves && centrePreview.currentPlan ? (
                    <span className="font-bold text-warning-text">
                      Moves from {centrePreview.currentPlan.title}
                    </span>
                  ) : null}
                  {centrePreview && centrePreview.uncoveredTracks.length > 0 ? (
                    <span className="font-bold text-warning-text">
                      ⚠ not covered: {centrePreview.uncoveredTracks.map(formatExamTrack).join(", ")}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
        </Card>
      ))}
    </div>
  );
}
