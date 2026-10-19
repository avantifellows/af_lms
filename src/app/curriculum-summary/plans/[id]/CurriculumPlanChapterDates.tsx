"use client";

import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";

import { Badge, Button, Card } from "@/components/ui";
import type {
  CurriculumPlanChapter,
  CurriculumPlanError,
  CurriculumPlanWarning,
} from "@/lib/curriculum-plans";

interface Props {
  planId: number;
  chapters: CurriculumPlanChapter[];
  readOnly: boolean;
}

type ChapterDates = Record<number, { dueDate: string; testDate: string }>;

const dateInputClassName =
  "min-h-[40px] rounded-md border border-border bg-bg-card px-2 py-1 text-sm text-text-primary disabled:cursor-not-allowed disabled:opacity-60";

function storedDates(chapter: CurriculumPlanChapter) {
  return { dueDate: chapter.dueDate ?? "", testDate: chapter.testDate ?? "" };
}

function datesFromChapters(chapters: CurriculumPlanChapter[]): ChapterDates {
  return Object.fromEntries(chapters.map((chapter) => [chapter.chapterId, storedDates(chapter)]));
}

// A refresh can bring a Chapter that was not in syllabus when the grid first rendered.
function datesFor(dates: ChapterDates, chapter: CurriculumPlanChapter) {
  return dates[chapter.chapterId] ?? storedDates(chapter);
}

// Chapters arrive in syllabus order (subject, then coverage sequence); keep that order.
function groupBySubject(chapters: CurriculumPlanChapter[]) {
  const groups: Array<{ subjectId: number; subjectName: string; chapters: CurriculumPlanChapter[] }> = [];
  for (const chapter of chapters) {
    const group = groups.find((item) => item.subjectId === chapter.subjectId);
    if (group) {
      group.chapters.push(chapter);
    } else {
      groups.push({
        subjectId: chapter.subjectId,
        subjectName: chapter.subjectName,
        chapters: [chapter],
      });
    }
  }
  return groups;
}

export default function CurriculumPlanChapterDates({ planId, chapters, readOnly }: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState(() => datesFromChapters(chapters));
  const [values, setValues] = useState(saved);
  const [errors, setErrors] = useState<CurriculumPlanError[]>([]);
  const [warnings, setWarnings] = useState<CurriculumPlanWarning[]>([]);
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => groupBySubject(chapters), [chapters]);

  function setDate(chapter: CurriculumPlanChapter, field: "dueDate" | "testDate", value: string) {
    setValues((current) => ({
      ...current,
      [chapter.chapterId]: { ...datesFor(current, chapter), [field]: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const changed = chapters
      .filter((chapter) => {
        const before = datesFor(saved, chapter);
        const after = datesFor(values, chapter);
        return before.dueDate !== after.dueDate || before.testDate !== after.testDate;
      })
      .map((chapter) => ({
        chapter_id: chapter.chapterId,
        due_date: datesFor(values, chapter).dueDate || null,
        test_date: datesFor(values, chapter).testDate || null,
      }));

    setErrors([]);
    setWarnings([]);
    setSavedMessage("");
    if (changed.length === 0) {
      setSavedMessage("No date changes to save.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/curriculum/plans/${planId}/chapters`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapters: changed }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrors(
          Array.isArray(json.errors) && json.errors.length > 0
            ? json.errors
            : [{ field: "form", message: json.error ?? "Could not save Chapter dates" }]
        );
        return;
      }
      setSaved(values);
      setWarnings(Array.isArray(json.warnings) ? json.warnings : []);
      setSavedMessage("Chapter dates saved.");
      router.refresh();
    } catch {
      setErrors([{ field: "form", message: "Could not save Chapter dates" }]);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {chapters.length === 0 ? (
        <Card className="p-6 text-sm text-text-secondary">
          No in-syllabus Chapters for this plan&apos;s Grade and Exam Tracks.
        </Card>
      ) : null}
      {groups.map((group) => {
        const headingId = `plan-subject-${group.subjectId}`;
        return (
          <section key={group.subjectId} aria-labelledby={headingId}>
            <Card className="overflow-x-auto">
              <h2
                id={headingId}
                className="border-b border-border px-4 py-3 text-lg font-bold text-text-primary"
              >
                {group.subjectName}
              </h2>
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="bg-bg-muted">
                  <tr>
                    {["Chapter", "Chapter Due Date", "Chapter Test Date", "Plan"].map((header) => (
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
                  {group.chapters.map((chapter) => {
                    const dates = datesFor(values, chapter);
                    return (
                      <tr key={chapter.chapterId} data-plan-chapter-row>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs text-text-muted">
                            {chapter.chapterCode}
                          </span>{" "}
                          <span className="font-bold text-text-primary">{chapter.chapterName}</span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="date"
                            aria-label={`Due date for ${chapter.chapterName}`}
                            value={dates.dueDate}
                            onChange={(event) =>
                              setDate(chapter, "dueDate", event.target.value)
                            }
                            disabled={readOnly}
                            className={dateInputClassName}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="date"
                            aria-label={`Test date for ${chapter.chapterName}`}
                            value={dates.testDate}
                            onChange={(event) =>
                              setDate(chapter, "testDate", event.target.value)
                            }
                            disabled={readOnly}
                            className={dateInputClassName}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {datesFor(saved, chapter).dueDate ? (
                            <Badge variant="info">Dated</Badge>
                          ) : (
                            <Badge>Not in plan</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </section>
        );
      })}
      {errors.length > 0 ? (
        <div
          role="alert"
          data-testid="plan-date-errors"
          className="rounded-md border border-danger bg-danger-bg p-4 text-sm text-danger"
        >
          <p className="font-bold">Chapter dates were not saved.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {errors.map((error) => (
              <li key={`${error.chapterId ?? error.field}-${error.message}`}>
                {error.chapterName ? `${error.chapterName}: ` : ""}
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div
          data-testid="plan-date-warnings"
          className="rounded-md border border-warning-border bg-warning-bg p-4 text-sm text-warning-text"
        >
          <ul className="list-disc space-y-1 pl-5">
            {warnings.map((warning) => (
              <li key={`${warning.chapterId}-${warning.message}`}>
                {warning.chapterName}: {warning.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {savedMessage ? (
        <p role="status" className="text-sm font-bold text-success">
          {savedMessage}
        </p>
      ) : null}
      {chapters.length > 0 ? (
        <Button type="submit" disabled={readOnly || saving}>
          Save Chapter dates
        </Button>
      ) : null}
    </form>
  );
}
