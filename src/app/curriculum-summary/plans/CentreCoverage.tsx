"use client";

import { useState, type ReactNode } from "react";
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
import { firstErrorMessage, planRequest, usePlanAction } from "./plan-requests";

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

type Choices = Partial<Record<CoverageGrade, string>>;

// The Grades the Centre runs, each at its current plan id ("" = No plan).
function currentChoices(centre: CentreCoverageRow): Choices {
  return Object.fromEntries(
    GRADES.filter((grade) => centre.grades[grade]).map((grade) => [
      grade,
      String(centre.grades[grade]?.plan?.id ?? ""),
    ])
  );
}

// Only the Grades whose choice differs from the current plan.
function changedAssignments(centre: CentreCoverageRow, choices: Choices) {
  const current = currentChoices(centre);
  return GRADES.filter((grade) => grade in current && choices[grade] !== current[grade]).map(
    (grade) => ({ grade, plan_id: choices[grade] ? Number(choices[grade]) : null })
  );
}

// Centre coverage for one academic year: which plan each eligible Centre + Grade is on.
// Assign by Centre: "Change plans" on a row picks a plan per Grade the Centre runs (only
// that academic year's plans for the Grade) or none; Save sends only the changed Grades.
export default function CentreCoverage({ academicYear, centres, plans, readOnly }: Props) {
  const router = useRouter();
  const [editingCentreId, setEditingCentreId] = useState<number | null>(null);
  const [choices, setChoices] = useState<Choices>({});
  const [savedMessage, setSavedMessage] = useState("");
  const action = usePlanAction();

  function startEditing(centre: CentreCoverageRow) {
    setEditingCentreId(centre.centreId);
    action.setError("");
    setSavedMessage("");
    setChoices(currentChoices(centre));
  }

  async function save(centre: CentreCoverageRow) {
    const assignments = changedAssignments(centre, choices);
    if (assignments.length === 0) {
      setEditingCentreId(null);
      return;
    }
    const done = await action.run(
      () =>
        planRequest(`/api/curriculum/plans/centres/${centre.centreId}/assignments`, "PUT", {
          academic_year: academicYear,
          assignments,
        }),
      "Could not save the plans",
      (body) => firstErrorMessage(body, "Could not save the plans")
    );
    if (!done) return;
    setEditingCentreId(null);
    setSavedMessage(`Plans saved for ${centre.centreName}.`);
    router.refresh();
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
            centres.map((centre) => (
              <CoverageRow
                key={centre.centreId}
                centre={centre}
                plans={plans}
                editing={editingCentreId === centre.centreId}
                choices={choices}
                onChoose={(grade, value) => setChoices((current) => ({ ...current, [grade]: value }))}
                actions={
                  <RowActions
                    editing={editingCentreId === centre.centreId}
                    readOnly={readOnly}
                    saving={action.working}
                    error={action.error}
                    onEdit={() => startEditing(centre)}
                    onSave={() => save(centre)}
                    onCancel={() => setEditingCentreId(null)}
                  />
                }
              />
            ))
          )}
        </tbody>
      </table>
    </Card>
  );
}

function CoverageRow({
  centre,
  plans,
  editing,
  choices,
  onChoose,
  actions,
}: {
  centre: CentreCoverageRow;
  plans: CurriculumPlanSummary[];
  editing: boolean;
  choices: Choices;
  onChoose: (grade: CoverageGrade, value: string) => void;
  actions: ReactNode;
}) {
  return (
    <tr data-coverage-row className="align-top">
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
            <GradePlanChoice
              grade={grade}
              plans={plans}
              value={choices[grade] ?? ""}
              onChange={(value) => onChoose(grade, value)}
            />
          ) : (
            <CoverageCell coverage={centre.grades[grade]} />
          )}
        </td>
      ))}
      <td className="px-4 py-3">{actions}</td>
    </tr>
  );
}

function GradePlanChoice({
  grade,
  plans,
  value,
  onChange,
}: {
  grade: CoverageGrade;
  plans: CurriculumPlanSummary[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-bold text-text-muted">
      Grade {grade} plan
      <select value={value} onChange={(event) => onChange(event.target.value)} className={selectClassName}>
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
  );
}

function RowActions({
  editing,
  readOnly,
  saving,
  error,
  onEdit,
  onSave,
  onCancel,
}: {
  editing: boolean;
  readOnly: boolean;
  saving: boolean;
  error: string;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  if (!editing) {
    return (
      <Button type="button" variant="secondary" disabled={readOnly} onClick={onEdit}>
        Change plans
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button type="button" disabled={saving} onClick={onSave}>
          Save
        </Button>
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p data-testid="coverage-error" className="text-sm font-bold text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
