import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound, redirect } from "next/navigation";
import { Fragment } from "react";

import PageHeader from "@/components/PageHeader";
import { Badge, Card, type BadgeVariant } from "@/components/ui";
import { authOptions } from "@/lib/auth";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { formatDuration } from "@/lib/curriculum-helpers";
import {
  HOURS_WINDOWS,
  type BehindPillTone,
  type ChapterStatus,
  type ChapterTestStatus,
  type HoursWindow,
} from "@/lib/curriculum-plan-rules";
import {
  CURRICULUM_SUMMARY_GRADES,
  getChapterTimeline,
  normalizeCurriculumSummarySearchParams,
  type ChapterTimeline,
} from "@/lib/curriculum-summary";
import {
  getFeatureAccess,
  getProgramContextSync,
  getResolvedPermission,
} from "@/lib/permissions";

const HOURS_WINDOW_LABELS: Record<HoursWindow, string> = {
  ay: "This AY",
  "30d": "Last 30 days",
  "7d": "Last 7 days",
};

const TONE_BADGE_VARIANTS: Record<BehindPillTone, BadgeVariant> = {
  green: "success",
  amber: "warning",
  red: "danger",
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ChapterTimelinePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const session = await getServerSession(authOptions);

  if (!session?.user?.email) {
    redirect("/");
  }

  const email = session.user.email;
  const permission = await getResolvedPermission(email);

  // Same page gate as the Curriculum Summary.
  if (
    !permission ||
    (permission.role !== "program_manager" &&
      permission.role !== "program_admin" &&
      permission.role !== "admin") ||
    !getFeatureAccess(permission, "curriculum").canView ||
    !getProgramContextSync(permission).hasCoEOrNodal
  ) {
    redirect("/dashboard");
  }

  const { grade, asOf } = normalizeCurriculumSummarySearchParams(resolvedSearchParams, getTodayIST());
  const subjectParam = resolvedSearchParams.subject;
  const requestedSubject = Array.isArray(subjectParam) ? subjectParam[0] : subjectParam;
  const hoursParam = resolvedSearchParams.hours;
  const requestedHours = Array.isArray(hoursParam) ? hoursParam[0] : hoursParam;
  // Unknown values fall back to This AY.
  const hoursWindow =
    HOURS_WINDOWS.find((window) => window === requestedHours) ?? HOURS_WINDOWS[0];
  const result = await getChapterTimeline(permission, Number(id), { grade, asOf, hoursWindow });
  if (!result.ok && result.status === 404) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        title={result.ok ? result.timeline.row.centreName : "Chapter timeline"}
        subtitle={
          result.ok
            ? [
                result.timeline.row.schoolName,
                result.timeline.row.programName,
                result.timeline.row.tracksLabel,
                `Grade ${grade}`,
              ].join(" · ")
            : undefined
        }
        backHref={`/curriculum-summary?${new URLSearchParams({ grade: String(grade), as_of: asOf })}`}
        userEmail={email}
        containerClassName="w-full px-4 py-3 sm:px-6 lg:px-8"
      />
      <main className="w-full space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {!result.ok ? (
          <Card className="border-l-4 border-l-warning-border p-6">
            <div className="flex flex-col gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-warning-text">
                Schema unavailable
              </p>
              <h2 className="text-lg font-bold text-text-primary">{result.error}</h2>
              <ul className="list-disc space-y-1 pl-5 font-mono text-sm text-text-secondary">
                {result.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          </Card>
        ) : (
          <TimelineView
            timeline={result.timeline}
            centreId={Number(id)}
            requestedSubject={requestedSubject}
            isAdmin={permission.role === "admin"}
          />
        )}
      </main>
    </div>
  );
}

function timelineHref(
  centreId: number,
  timeline: ChapterTimeline,
  overrides: { grade?: number; subject?: string | null; hours?: HoursWindow } = {}
): string {
  const search = new URLSearchParams({
    grade: String(overrides.grade ?? timeline.grade),
    as_of: timeline.asOf,
  });
  // This AY is the default, so it stays out of the URL.
  const hours = overrides.hours ?? timeline.hoursWindow;
  if (hours !== "ay") search.set("hours", hours);
  if (overrides.subject) search.set("subject", overrides.subject);
  return `/curriculum-summary/centres/${centreId}?${search.toString()}`;
}

function TimelineFilters({
  timeline,
  centreId,
  subject,
}: {
  timeline: ChapterTimeline;
  centreId: number;
  subject: string | null;
}) {
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Grade</span>
        {/* Another Grade may have other subjects, so switching Grade starts at All. */}
        <nav aria-label="Grade" className="flex gap-1">
          {CURRICULUM_SUMMARY_GRADES.map((grade) => (
            <Link
              key={grade}
              href={timelineHref(centreId, timeline, { grade })}
              aria-current={timeline.grade === grade ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm font-bold ${
                timeline.grade === grade
                  ? "border-accent bg-accent text-white"
                  : "border-border text-accent hover:text-accent-hover"
              }`}
            >
              Grade {grade}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold uppercase tracking-wide text-text-muted">Hours</span>
        <nav aria-label="Hours window" className="flex gap-1">
          {HOURS_WINDOWS.map((hours) => (
            <Link
              key={hours}
              href={timelineHref(centreId, timeline, { hours, subject })}
              aria-current={timeline.hoursWindow === hours ? "page" : undefined}
              className={`rounded-md border px-3 py-1.5 text-sm font-bold ${
                timeline.hoursWindow === hours
                  ? "border-accent bg-accent text-white"
                  : "border-border text-accent hover:text-accent-hover"
              }`}
            >
              {HOURS_WINDOW_LABELS[hours]}
            </Link>
          ))}
        </nav>
      </div>
      <form
        action={`/curriculum-summary/centres/${centreId}`}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="grade" value={timeline.grade} />
        {timeline.hoursWindow !== "ay" ? (
          <input type="hidden" name="hours" value={timeline.hoursWindow} />
        ) : null}
        {subject ? <input type="hidden" name="subject" value={subject} /> : null}
        <label className="flex flex-col gap-1 text-xs font-bold uppercase tracking-wide text-text-muted">
          As of
          <input
            type="date"
            name="as_of"
            defaultValue={timeline.asOf}
            className="min-h-[44px] rounded-md border border-border bg-bg-card px-3 py-2 text-sm font-normal normal-case text-text-primary"
          />
        </label>
        <button
          type="submit"
          className="min-h-[44px] rounded-md border border-border px-3 py-1.5 text-sm font-bold text-accent hover:text-accent-hover"
        >
          Apply
        </button>
      </form>
    </Card>
  );
}

function TimelineView({
  timeline,
  centreId,
  requestedSubject,
  isAdmin,
}: {
  timeline: ChapterTimeline;
  centreId: number;
  requestedSubject: string | undefined;
  isAdmin: boolean;
}) {
  const subject = timeline.subjects.some((tab) => tab.subject === requestedSubject)
    ? requestedSubject
    : null;
  const measured = timeline.row.kind === "plan";
  const { header } = timeline;
  if (timeline.row.kind !== "plan" && timeline.row.kind !== "no_plan") {
    return (
      <>
        <TimelineFilters timeline={timeline} centreId={centreId} subject={null} />
        <Card className="border-l-4 border-l-warning-border p-6">
          <p data-testid="timeline-explanation" className="font-bold text-warning-text">
            {timeline.row.explanation}
          </p>
        </Card>
      </>
    );
  }
  return (
    <>
      <TimelineFilters timeline={timeline} centreId={centreId} subject={subject ?? null} />
      <PlanLabel timeline={timeline} isAdmin={isAdmin} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:max-w-3xl">
        <HeaderNumber
          label="Due done"
          value={measured ? `${header.done}/${header.due}` : "—"}
          testId="timeline-due-done"
        />
        <HeaderNumber
          label="Syllabus done"
          value={`${header.syllabusDone}/${header.syllabusTotal}`}
          testId="timeline-syllabus-done"
        />
        <HeaderNumber
          label="Tests overdue"
          value={measured ? String(header.testsOverdue) : "—"}
          testId="timeline-tests-overdue"
        />
        <HeaderNumber
          label={`Hours vs prescribed · ${HOURS_WINDOW_LABELS[timeline.hoursWindow]}`}
          value={`${formatHours(header.taughtMinutes)} / ${formatHours(header.prescribedMinutes)}`}
          testId="timeline-hours"
        />
        <HeaderNumber
          label="Classes cancelled"
          value={String(header.cancellations)}
          testId="timeline-cancellations"
        />
        <HeaderNumber
          label="Doubt solving"
          value={formatHours(header.doubtSolvingMinutes)}
          testId="timeline-doubt-solving"
        />
      </div>
      <nav aria-label="Subject" className="flex flex-wrap gap-1">
        {[{ subject: null, progress: null }, ...timeline.subjects].map((tab) => (
          <Link
            key={tab.subject ?? "all"}
            href={timelineHref(centreId, timeline, { subject: tab.subject })}
            data-subject-tab={tab.subject ?? "All"}
            aria-current={subject === tab.subject ? "page" : undefined}
            className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-bold ${
              subject === tab.subject
                ? "border-accent bg-accent text-white"
                : "border-border text-accent hover:text-accent-hover"
            }`}
          >
            {tab.subject ?? "All"}
            {tab.progress ? (
              <Badge variant={TONE_BADGE_VARIANTS[tab.progress.tone]} data-tab-progress>
                {tab.progress.label} · {tab.progress.done}/{tab.progress.due}
              </Badge>
            ) : null}
          </Link>
        ))}
      </nav>
      <TimelineTable
        timeline={{
          ...timeline,
          chapters: subject
            ? timeline.chapters.filter((chapter) => chapter.subject === subject)
            : timeline.chapters,
        }}
      />
    </>
  );
}

function HeaderNumber({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card elevation="sm" className="p-3 sm:p-4">
      <span className="block text-xs uppercase tracking-wider text-text-muted">{label}</span>
      <span data-testid={testId} className="mt-1 block font-mono text-2xl font-bold text-text-primary">
        {value}
      </span>
    </Card>
  );
}

function TimelineTable({ timeline }: { timeline: ChapterTimeline }) {
  const headers = [
    "Chapter",
    "Subject",
    "Due",
    "Status",
    "Completed",
    "Chapter test",
    "Hours",
    "Prescribed",
    "Cancelled",
    "Doubt solving",
  ];
  // The as-of line sits after the Chapters due on or before as-of; without plan dates there is
  // nothing to divide.
  const hasDueDates = timeline.chapters.some((chapter) => chapter.dueDate !== null);
  const firstNotYetDue = timeline.chapters.findIndex(
    (chapter) => chapter.dueDate === null || chapter.dueDate > timeline.asOf
  );
  const markerIndex = !hasDueDates
    ? -1
    : firstNotYetDue === -1
      ? timeline.chapters.length
      : firstNotYetDue;
  return (
    <Card className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted">
          <tr>
            {headers.map((header) => (
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
          {timeline.chapters.map((chapter, index) => (
            <Fragment key={chapter.chapterId}>
              {index === markerIndex ? <AsOfMarker asOf={timeline.asOf} columns={headers.length} /> : null}
              <tr data-timeline-row data-chapter={chapter.name}>
                <td className="px-4 py-3 font-bold text-text-primary">{chapter.name}</td>
                <td className="px-4 py-3">{chapter.subject}</td>
                <td className="px-4 py-3">{chapter.dueDate ? formatDate(chapter.dueDate) : "—"}</td>
                <td data-status className="px-4 py-3">
                  {chapterStatusLabel(chapter.status)}
                </td>
                <td data-completed-on className="px-4 py-3">
                  {chapter.completedOn ? formatDate(chapter.completedOn) : "—"}
                </td>
                <td data-test-status className="px-4 py-3">
                  {chapterTestStatusLabel(chapter.testStatus)}
                </td>
                <td data-hours className="px-4 py-3 font-mono">
                  {formatHours(chapter.taughtMinutes)}
                </td>
                <td data-prescribed className="px-4 py-3 font-mono">
                  {formatHours(chapter.prescribedMinutes)}
                </td>
                <td data-cancellations className="px-4 py-3 font-mono">
                  {chapter.cancellations}
                </td>
                <td data-doubt-solving className="px-4 py-3 font-mono">
                  {formatHours(chapter.doubtSolvingMinutes)}
                </td>
              </tr>
            </Fragment>
          ))}
          {markerIndex === timeline.chapters.length ? (
            <AsOfMarker asOf={timeline.asOf} columns={headers.length} />
          ) : null}
        </tbody>
      </table>
    </Card>
  );
}

function AsOfMarker({ asOf, columns }: { asOf: string; columns: number }) {
  return (
    <tr data-as-of-marker>
      <td
        colSpan={columns}
        className="border-y-2 border-accent px-4 py-1 text-xs font-bold uppercase tracking-wide text-accent"
      >
        As of {formatDate(asOf)}
      </td>
    </tr>
  );
}

// The plan name and Closed label are for every viewer; only Admins get the plan editor link.
function PlanLabel({ timeline, isAdmin }: { timeline: ChapterTimeline; isAdmin: boolean }) {
  const { plan } = timeline.row;
  return (
    <p className="text-sm text-text-secondary">
      Plan:{" "}
      <span data-timeline-plan className="font-bold text-text-primary">
        {!plan ? (
          "No plan"
        ) : isAdmin ? (
          <Link
            href={`/curriculum-summary/plans/${plan.id}`}
            className="text-accent hover:text-accent-hover"
          >
            {plan.title}
          </Link>
        ) : (
          plan.title
        )}
      </span>
      {plan?.closed ? (
        <Badge className="ml-2" data-timeline-plan-closed>
          Closed
        </Badge>
      ) : null}
    </p>
  );
}

// `YYYY-MM-DD` calendar date → "5 Jul 2026", independent of the server's time zone.
function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

// Minutes → "1h 30m"; nothing logged shows as "0h".
function formatHours(minutes: number): string {
  return minutes === 0 ? "0h" : formatDuration(minutes);
}

function days(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

function chapterStatusLabel(status: ChapterStatus): string {
  switch (status.kind) {
    case "done":
      return "Done";
    case "done_late":
      return `Done ${days(status.days)} late`;
    case "overdue":
      return `Overdue ${days(status.days)}`;
    case "not_due":
      return "Not due";
    case "not_in_plan":
      return "Not in plan";
  }
}

function chapterTestStatusLabel(status: ChapterTestStatus): string {
  switch (status.kind) {
    case "conducted":
      return `Conducted ${formatDate(status.conductedOn)}`;
    case "scheduled":
      return "Scheduled";
    case "overdue":
      return "Overdue";
    case "not_due":
      return "Not due";
  }
}
