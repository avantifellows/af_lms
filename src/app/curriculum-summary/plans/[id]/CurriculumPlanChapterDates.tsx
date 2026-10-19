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
import ChapterLabel from "../../ChapterLabel";
import PlanErrorItems from "../PlanErrorItems";
import { planErrors, planRequest } from "../plan-requests";

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

function sameDates(a: ChapterDates[number], b: ChapterDates[number]): boolean {
  return a.dueDate === b.dueDate && a.testDate === b.testDate;
}

// Fold refreshed server dates into the grid. A Chapter whose stored dates changed on the server
// (a plan details save that cleared clashing dates) takes them as its saved dates, and as its
// shown dates too unless it has an unsaved edit. Other Chapters keep their unsaved edits.
function reconcileServerDates(
  server: ChapterDates,
  saved: ChapterDates,
  values: ChapterDates
): { saved: ChapterDates; values: ChapterDates } {
  const nextSaved = { ...saved };
  const nextValues = { ...values };
  for (const [id, serverDates] of Object.entries(server)) {
    const chapterId = Number(id);
    const before = saved[chapterId];
    if (!before || sameDates(before, serverDates)) continue;
    nextSaved[chapterId] = serverDates;
    if (!values[chapterId] || sameDates(values[chapterId], before)) nextValues[chapterId] = serverDates;
  }
  return { saved: nextSaved, values: nextValues };
}

// The saved and shown dates, kept in step with the server's after each refresh.
function useServerSyncedDates(chapters: CurriculumPlanChapter[]) {
  const serverDates = useMemo(() => datesFromChapters(chapters), [chapters]);
  const [synced, setSynced] = useState(serverDates);
  const [saved, setSaved] = useState(serverDates);
  const [values, setValues] = useState(serverDates);
  if (synced !== serverDates) {
    const next = reconcileServerDates(serverDates, saved, values);
    setSynced(serverDates);
    setSaved(next.saved);
    setValues(next.values);
  }
  return { saved, setSaved, values, setValues };
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

type ChapterDateChange = { chapter_id: number; due_date: string | null; test_date: string | null };

// The Chapters whose dates differ from the last saved ones, as the API takes them.
function changedChapterDates(
  chapters: CurriculumPlanChapter[],
  saved: ChapterDates,
  values: ChapterDates
): ChapterDateChange[] {
  return chapters
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
}

// Saves a batch of changed dates: all-or-nothing errors per Chapter, or warnings on success.
function useChapterDatesSave(planId: number) {
  const router = useRouter();
  const [errors, setErrors] = useState<CurriculumPlanError[]>([]);
  const [warnings, setWarnings] = useState<CurriculumPlanWarning[]>([]);
  const [savedMessage, setSavedMessage] = useState("");
  const [saving, setSaving] = useState(false);

  // Resolves true once the batch is saved.
  async function save(changed: ChapterDateChange[]): Promise<boolean> {
    setErrors([]);
    setWarnings([]);
    setSavedMessage("");
    if (changed.length === 0) {
      setSavedMessage("No date changes to save.");
      return false;
    }
    setSaving(true);
    try {
      const response = await planRequest(`/api/curriculum/plans/${planId}/chapters`, "PUT", {
        chapters: changed,
      });
      if (!response.ok) {
        setErrors(planErrors(response.body, "Could not save Chapter dates"));
        return false;
      }
      setWarnings(Array.isArray(response.body.warnings) ? response.body.warnings : []);
      setSavedMessage("Chapter dates saved.");
      router.refresh();
      return true;
    } catch {
      setErrors([{ field: "form", message: "Could not save Chapter dates" }]);
      return false;
    } finally {
      setSaving(false);
    }
  }

  return { errors, warnings, savedMessage, saving, save };
}

export default function CurriculumPlanChapterDates({ planId, chapters, readOnly }: Props) {
  const { saved, setSaved, values, setValues } = useServerSyncedDates(chapters);
  const groups = useMemo(() => groupBySubject(chapters), [chapters]);
  const feedback = useChapterDatesSave(planId);

  function setDate(chapter: CurriculumPlanChapter, field: "dueDate" | "testDate", value: string) {
    setValues((current) => ({
      ...current,
      [chapter.chapterId]: { ...datesFor(current, chapter), [field]: value },
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = values;
    if (await feedback.save(changedChapterDates(chapters, saved, submitted))) setSaved(submitted);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {chapters.length === 0 ? (
        <Card className="p-6 text-sm text-text-secondary">
          No in-syllabus Chapters for this plan&apos;s Grade and Exam Tracks.
        </Card>
      ) : null}
      {groups.map((group) => (
        <SubjectDates
          key={group.subjectId}
          group={group}
          values={values}
          saved={saved}
          readOnly={readOnly}
          onDate={setDate}
        />
      ))}
      <ChapterDatesFeedback
        errors={feedback.errors}
        warnings={feedback.warnings}
        savedMessage={feedback.savedMessage}
      />
      {chapters.length > 0 ? (
        <Button type="submit" disabled={readOnly || feedback.saving}>
          Save Chapter dates
        </Button>
      ) : null}
    </form>
  );
}

function SubjectDates({
  group,
  values,
  saved,
  readOnly,
  onDate,
}: {
  group: ReturnType<typeof groupBySubject>[number];
  values: ChapterDates;
  saved: ChapterDates;
  readOnly: boolean;
  onDate: (chapter: CurriculumPlanChapter, field: "dueDate" | "testDate", value: string) => void;
}) {
  const headingId = `plan-subject-${group.subjectId}`;
  return (
    <section aria-labelledby={headingId}>
      <Card className="overflow-x-auto">
        <h2 id={headingId} className="border-b border-border px-4 py-3 text-lg font-bold text-text-primary">
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
            {group.chapters.map((chapter) => (
              <ChapterDatesRow
                key={chapter.chapterId}
                chapter={chapter}
                dates={datesFor(values, chapter)}
                dated={Boolean(datesFor(saved, chapter).dueDate)}
                readOnly={readOnly}
                onDate={onDate}
              />
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

function ChapterDatesRow({
  chapter,
  dates,
  dated,
  readOnly,
  onDate,
}: {
  chapter: CurriculumPlanChapter;
  dates: { dueDate: string; testDate: string };
  dated: boolean;
  readOnly: boolean;
  onDate: (chapter: CurriculumPlanChapter, field: "dueDate" | "testDate", value: string) => void;
}) {
  return (
    <tr data-plan-chapter-row>
      <td className="px-4 py-3">
        <ChapterLabel code={chapter.chapterCode} name={chapter.chapterName} />
      </td>
      <td className="px-4 py-3">
        <input
          type="date"
          aria-label={`Due date for ${chapter.chapterName}`}
          value={dates.dueDate}
          onChange={(event) => onDate(chapter, "dueDate", event.target.value)}
          disabled={readOnly}
          className={dateInputClassName}
        />
      </td>
      <td className="px-4 py-3">
        <input
          type="date"
          aria-label={`Test date for ${chapter.chapterName}`}
          value={dates.testDate}
          onChange={(event) => onDate(chapter, "testDate", event.target.value)}
          disabled={readOnly}
          className={dateInputClassName}
        />
      </td>
      <td className="px-4 py-3">
        {dated ? <Badge variant="info">Dated</Badge> : <Badge>Not in plan</Badge>}
      </td>
    </tr>
  );
}

function ChapterDatesFeedback({
  errors,
  warnings,
  savedMessage,
}: {
  errors: CurriculumPlanError[];
  warnings: CurriculumPlanWarning[];
  savedMessage: string;
}) {
  return (
    <>
      {errors.length > 0 ? (
        <div
          role="alert"
          data-testid="plan-date-errors"
          className="rounded-md border border-danger bg-danger-bg p-4 text-sm text-danger"
        >
          <p className="font-bold">Chapter dates were not saved.</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <PlanErrorItems errors={errors} />
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
    </>
  );
}
