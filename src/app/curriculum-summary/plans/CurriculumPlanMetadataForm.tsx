"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Button, Card } from "@/components/ui";
import { CONTENT_EXAM_TRACKS } from "@/lib/curriculum-plan-rules";
import { formatExamTrack, type ExamTrack } from "@/lib/exam-tracks";
import type { CurriculumPlanError } from "@/lib/curriculum-plans";

export interface CurriculumPlanMetadataValues {
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

export default function CurriculumPlanMetadataForm({
  planId,
  initialValues,
  readOnly,
  assignmentCount = 0,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<CurriculumPlanError[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState("");
  const isNew = planId === undefined;
  const yearAndGradeLocked = assignmentCount > 0;

  function toggleTrack(track: ExamTrack, checked: boolean) {
    setValues((current) => ({
      ...current,
      examTracks: checked
        ? CONTENT_EXAM_TRACKS.filter((t) => t === track || current.examTracks.includes(t))
        : current.examTracks.filter((t) => t !== track),
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setErrors([]);
    setSavedMessage("");
    try {
      const response = await fetch(
        isNew ? "/api/curriculum/plans" : `/api/curriculum/plans/${planId}`,
        {
          method: isNew ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: values.title,
            exam_tracks: values.examTracks,
            academic_year: values.academicYear,
            grade: values.grade,
            closure_date: values.closureDate,
          }),
        }
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrors(
          Array.isArray(json.errors) && json.errors.length > 0
            ? json.errors
            : [{ field: "form", message: json.error ?? "Could not save the plan" }]
        );
        return;
      }
      if (isNew) {
        router.push(`/curriculum-summary/plans/${json.plan.id}`);
        return;
      }
      setSavedMessage("Plan details saved.");
      router.refresh();
    } catch {
      setErrors([{ field: "form", message: "Could not save the plan" }]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
        <label className={`${labelClassName} md:col-span-2`}>
          Title
          <input
            type="text"
            value={values.title}
            onChange={(event) => setValues({ ...values, title: event.target.value })}
            disabled={readOnly}
            className={fieldClassName}
          />
        </label>
        <fieldset className="flex flex-col gap-1 md:col-span-2" disabled={readOnly}>
          <legend className="text-sm font-bold text-text-primary">Served Exam Tracks</legend>
          <div className="flex flex-wrap gap-4">
            {CONTENT_EXAM_TRACKS.map((track) => (
              <label key={track} className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={values.examTracks.includes(track)}
                  onChange={(event) => toggleTrack(track, event.target.checked)}
                />
                {formatExamTrack(track)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className={labelClassName}>
          Academic year
          <input
            type="text"
            placeholder="2026-2027"
            value={values.academicYear}
            onChange={(event) => setValues({ ...values, academicYear: event.target.value })}
            disabled={readOnly || yearAndGradeLocked}
            className={fieldClassName}
          />
        </label>
        <label className={labelClassName}>
          Grade
          <select
            value={values.grade}
            onChange={(event) => setValues({ ...values, grade: Number(event.target.value) })}
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
            onChange={(event) => setValues({ ...values, closureDate: event.target.value })}
            disabled={readOnly}
            className={fieldClassName}
          />
        </label>
        {errors.length > 0 ? (
          <ul
            role="alert"
            data-testid="plan-details-errors"
            className="list-disc space-y-1 pl-5 text-sm text-danger md:col-span-2"
          >
            {errors.map((error) => (
              <li key={`${error.chapterId ?? error.field}-${error.message}`}>
                {error.chapterName ? `${error.chapterName}: ` : ""}
                {error.message}
              </li>
            ))}
          </ul>
        ) : null}
        {savedMessage ? (
          <p role="status" className="text-sm font-bold text-success md:col-span-2">
            {savedMessage}
          </p>
        ) : null}
        <div className="md:col-span-2">
          <Button type="submit" disabled={readOnly || saving}>
            {isNew ? "Create plan" : "Save plan details"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
