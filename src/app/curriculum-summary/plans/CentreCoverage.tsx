"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card } from "@/components/ui";
import type {
  CentreCoverageGrade,
  CentreCoverageRow,
  CoverageGrade,
} from "@/lib/curriculum-plan-assignments";
import type { CurriculumPlanSummary } from "@/lib/curriculum-plans";
import { formatExamTrack } from "@/lib/exam-tracks";
import { PLAN_STATUS_BADGE_VARIANTS, PLAN_STATUS_LABELS } from "./plan-status";

const GRADES: CoverageGrade[] = [11, 12];

interface Props {
  academicYear: string;
  centres: CentreCoverageRow[];
  plans: CurriculumPlanSummary[];
  readOnly: boolean;
}

const selectClassName =
  "min-h-[44px] w-full rounded-md border border-border bg-bg-card px-3 py-2 text-sm text-text-primary";

function CoverageCell({ coverage }: { coverage: CentreCoverageGrade | null }) {
  if (!coverage) return <span className="text-text-muted">Not applicable</span>;
  if (!coverage.plan) return <span className="font-bold text-warning-text">No plan</span>;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-text-primary">{coverage.plan.title}</span>
        <Badge variant={PLAN_STATUS_BADGE_VARIANTS[coverage.plan.displayStatus]}>
          {PLAN_STATUS_LABELS[coverage.plan.displayStatus]}
        </Badge>
      </span>
      {coverage.uncoveredTracks.length > 0 ? (
        <span className="font-bold text-warning-text">
          ⚠ not covered: {coverage.uncoveredTracks.map(formatExamTrack).join(", ")}
        </span>
      ) : null}
    </div>
  );
}

// Centre coverage for one academic year: which plan each eligible Centre + Grade is on.
// Assign by Centre: "Change plans" on a row picks a plan per Grade the Centre runs (only
// that academic year's plans for the Grade) or none; Save sends only the changed Grades.
export default function CentreCoverage({ academicYear, centres, plans, readOnly }: Props) {
  const router = useRouter();
  const [editingCentreId, setEditingCentreId] = useState<number | null>(null);
  const [choices, setChoices] = useState<Partial<Record<CoverageGrade, string>>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  function startEditing(centre: CentreCoverageRow) {
    setEditingCentreId(centre.centreId);
    setError("");
    setSavedMessage("");
    setChoices(
      Object.fromEntries(
        GRADES.filter((grade) => centre.grades[grade]).map((grade) => [
          grade,
          String(centre.grades[grade]?.plan?.id ?? ""),
        ])
      )
    );
  }

  async function save(centre: CentreCoverageRow) {
    const assignments = GRADES.filter(
      (grade) =>
        centre.grades[grade] &&
        choices[grade] !== String(centre.grades[grade]?.plan?.id ?? "")
    ).map((grade) => ({ grade, plan_id: choices[grade] ? Number(choices[grade]) : null }));
    if (assignments.length === 0) {
      setEditingCentreId(null);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        `/api/curriculum/plans/centres/${centre.centreId}/assignments`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ academic_year: academicYear, assignments }),
        }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(json.errors?.[0]?.message ?? json.error ?? "Could not save the plans");
        return;
      }
      setEditingCentreId(null);
      setSavedMessage(`Plans saved for ${centre.centreName}.`);
      router.refresh();
    } catch {
      setError("Could not save the plans");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="overflow-x-auto">
      {savedMessage ? (
        <p role="status" className="px-4 pt-3 text-sm font-bold text-success">
          {savedMessage}
        </p>
      ) : null}
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted">
          <tr>
            {["Centre", "Region", "Grade 11", "Grade 12", "Assign"].map((header) => (
              <th
                key={header}
                scope="col"
                className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-text-muted"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {centres.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-text-secondary">
                No eligible Centres for {academicYear}: active physical JNV Centres need a
                Centre Exam Track for Grade 11 or 12.
              </td>
            </tr>
          ) : (
            centres.map((centre) => {
              const editing = editingCentreId === centre.centreId;
              return (
                <tr key={centre.centreId} data-coverage-row className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-bold text-text-primary">{centre.centreName}</p>
                    <p className="text-text-secondary">
                      {centre.schoolName}
                      {centre.programName ? ` · ${centre.programName}` : ""}
                    </p>
                  </td>
                  <td className="px-4 py-3">{centre.region || "No region"}</td>
                  {GRADES.map((grade) => (
                    <td key={grade} data-coverage-grade={grade} className="px-4 py-3">
                      {editing && centre.grades[grade] ? (
                        <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
                          Grade {grade} plan
                          <select
                            value={choices[grade] ?? ""}
                            onChange={(event) =>
                              setChoices((current) => ({ ...current, [grade]: event.target.value }))
                            }
                            className={selectClassName}
                          >
                            <option value="">No plan</option>
                            {plans
                              .filter((plan) => plan.grade === grade)
                              .map((plan) => (
                                <option key={plan.id} value={plan.id}>
                                  {plan.title} ({PLAN_STATUS_LABELS[plan.displayStatus]})
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : (
                        <CoverageCell coverage={centre.grades[grade]} />
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {editing ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex gap-2">
                          <Button type="button" disabled={saving} onClick={() => save(centre)}>
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={saving}
                            onClick={() => setEditingCentreId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                        {error ? (
                          <p data-testid="coverage-error" className="text-sm font-bold text-danger">
                            {error}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={readOnly}
                        onClick={() => startEditing(centre)}
                      >
                        Change plans
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </Card>
  );
}
