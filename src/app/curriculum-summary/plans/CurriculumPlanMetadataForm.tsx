"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@/components/ui";
import { PLAN_EXAM_TRACKS } from "@/lib/curriculum-plan-rules";
import { formatExamTrack, type ExamTrack } from "@/lib/exam-tracks";
import type { CurriculumPlanError } from "@/lib/curriculum-plans";
import PlanErrorItems from "./PlanErrorItems";
import { planErrors, planRequest } from "./plan-requests";

interface CurriculumPlanMetadataValues {
  title: string;
  examTracks: ExamTrack[];
  academicYear: string;
  grade: number;
  closureDate: string;
}

interface Props {
  // Absent for a new plan.
  planId?: number;
  initialValues: CurriculumPlanMetadataValues;
  readOnly: boolean;
  // Plan Assignments lock the academic year and Grade.
  assignmentCount?: number;
}

const fieldClassName =
  "min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal text-text-primary disabled:cursor-not-allowed disabled:opacity-60";
const labelClassName = "flex flex-col gap-1 text-sm font-bold text-text-primary";

// The save that clashed with stored Chapter dates, and the Chapters it named. Clearing resubmits
// exactly this, so the server clears only what the Admin was shown.
interface ClearOffer {
  values: CurriculumPlanMetadataValues;
  chapterIds: number[];
}

// Create (POST) or update (PATCH) the plan's details. A new plan opens its editor; an update
// refreshes the page. `clearOffer` consents to clearing the stored Chapter dates a previous save
// listed as clashing with the new academic year or closure date.
function usePlanDetailsSave(planId: number | undefined) {
  const router = useRouter();
  const [errors, setErrors] = useState<CurriculumPlanError[]>([]);
  const [clearOffer, setClearOffer] = useState<ClearOffer | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");

  async function save(values: CurriculumPlanMetadataValues, consent?: ClearOffer) {
    setSaving(true);
    setErrors([]);
    setClearOffer(null);
    setSavedMessage("");
    try {
      const response = await planRequest(
        planId === undefined ? "/api/curriculum/plans" : `/api/curriculum/plans/${planId}`,
        planId === undefined ? "POST" : "PATCH",
        {
          title: values.title,
          exam_tracks: values.examTracks,
          academic_year: values.academicYear,
          grade: values.grade,
          closure_date: values.closureDate,
          ...(consent
            ? { clear_conflicting_dates: true, expected_chapter_ids: consent.chapterIds }
            : {}),
        }
      );
      if (!response.ok) {
        const failed = planErrors(response.body, "Could not save the plan");
        setErrors(failed);
        const chapterIds = storedDateClashIds(failed);
        if (planId !== undefined && chapterIds.length > 0) setClearOffer({ values, chapterIds });
      } else if (planId === undefined) {
        router.push(`/curriculum-summary/plans/${(response.body.plan as { id: number }).id}`);
      } else {
        setSavedMessage("Plan details saved.");
        router.refresh();
      }
    } catch {
      setErrors([{ field: "form", message: "Could not save the plan" }]);
    } finally {
      setSaving(false);
    }
  }

  // Any edit after a clash withdraws the offer: the clashing set may no longer be what was shown.
  function withdrawClearOffer() {
    if (!clearOffer) return;
    setClearOffer(null);
    setErrors((current) => current.filter((error) => !isStoredDateClash(error)));
  }

  return { errors, clearOffer, saving, savedMessage, save, withdrawClearOffer };
}

export default function CurriculumPlanMetadataForm({
  planId,
  initialValues,
  readOnly,
  assignmentCount = 0,
}: Props) {
  const [values, setValues] = useState(initialValues);
  const { errors, clearOffer, saving, savedMessage, save, withdrawClearOffer } =
    usePlanDetailsSave(planId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(values);
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <PlanDetailsFields
          values={values}
          onChange={(changes) => {
            setValues((current) => ({ ...current, ...changes }));
            withdrawClearOffer();
          }}
          readOnly={readOnly}
          assignmentCount={assignmentCount}
        />
        {errors.length > 0 ? (
          <ul
            role="alert"
            data-testid="plan-details-errors"
            className="list-disc space-y-1 pl-5 text-sm text-danger md:col-span-2"
          >
            <PlanErrorItems errors={errors} />
          </ul>
        ) : null}
        {clearOffer ? (
          <div className="md:col-span-2">
            <Button
              type="button"
              variant="secondary"
              disabled={readOnly || saving}
              onClick={() => void save(clearOffer.values, clearOffer)}
            >
              Clear these Chapters&apos; dates and save
            </Button>
          </div>
        ) : null}
        {savedMessage ? (
          <p role="status" className="text-sm font-bold text-success md:col-span-2">
            {savedMessage}
          </p>
        ) : null}
        <div className="md:col-span-2">
          <Button type="submit" disabled={readOnly || saving}>
            {planId === undefined ? "Create plan" : "Save plan details"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// Stored Chapter dates outside the new academic year or after the new closure date. Some may be
// on hidden Chapters that the editor grid doesn't show, so the form offers to clear them.
function isStoredDateClash(error: CurriculumPlanError): boolean {
  return error.field === "closure_date" && error.chapterId !== undefined;
}

function storedDateClashIds(errors: CurriculumPlanError[]): number[] {
  return [...new Set(errors.filter(isStoredDateClash).map((error) => error.chapterId as number))];
}

function PlanDetailsFields({
  values,
  onChange,
  readOnly,
  assignmentCount,
}: {
  values: CurriculumPlanMetadataValues;
  onChange: (changes: Partial<CurriculumPlanMetadataValues>) => void;
  readOnly: boolean;
  assignmentCount: number;
}) {
  const yearAndGradeLocked = assignmentCount > 0;
  return (
    <>
      <label className={`${labelClassName} md:col-span-2`}>
        Title
        <input
          type="text"
          value={values.title}
          onChange={(event) => onChange({ title: event.target.value })}
          disabled={readOnly}
          className={fieldClassName}
        />
      </label>
      <TrackChoices
        examTracks={values.examTracks}
        onChange={(examTracks) => onChange({ examTracks })}
        readOnly={readOnly}
      />
      <label className={labelClassName}>
        Academic year
        <input
          type="text"
          placeholder="2026-2027"
          value={values.academicYear}
          onChange={(event) => onChange({ academicYear: event.target.value })}
          disabled={readOnly || yearAndGradeLocked}
          className={fieldClassName}
        />
      </label>
      <label className={labelClassName}>
        Grade
        <select
          value={values.grade}
          onChange={(event) => onChange({ grade: Number(event.target.value) })}
          disabled={readOnly || yearAndGradeLocked}
          className={fieldClassName}
        >
          <option value={11}>11</option>
          <option value={12}>12</option>
        </select>
      </label>
      {yearAndGradeLocked ? (
        <p data-testid="plan-assignment-lock" className="text-sm text-text-secondary md:col-span-2">
          Academic year and Grade are locked while{" "}
          {assignmentCount === 1 ? "1 Centre is" : `${assignmentCount} Centres are`} assigned to
          this plan.
        </p>
      ) : null}
      <label className={labelClassName}>
        Plan Closure Date
        <input
          type="date"
          value={values.closureDate}
          onChange={(event) => onChange({ closureDate: event.target.value })}
          disabled={readOnly}
          className={fieldClassName}
        />
      </label>
    </>
  );
}

// Served tracks stay in PLAN_EXAM_TRACKS order whatever order they are ticked in.
function TrackChoices({
  examTracks,
  onChange,
  readOnly,
}: {
  examTracks: ExamTrack[];
  onChange: (examTracks: ExamTrack[]) => void;
  readOnly: boolean;
}) {
  function toggle(track: ExamTrack, checked: boolean) {
    onChange(
      checked
        ? PLAN_EXAM_TRACKS.filter((t) => t === track || examTracks.includes(t))
        : examTracks.filter((t) => t !== track)
    );
  }

  return (
    <fieldset className="flex flex-col gap-1 md:col-span-2" disabled={readOnly}>
      <legend className="text-sm font-bold text-text-primary">Served Exam Tracks</legend>
      <div className="flex flex-wrap gap-4">
        {PLAN_EXAM_TRACKS.map((track) => (
          <label key={track} className="flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={examTracks.includes(track)}
              onChange={(event) => toggle(track, event.target.checked)}
            />
            {formatExamTrack(track)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
