import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import PageHeader from "@/components/PageHeader";
import { Badge, Card } from "@/components/ui";
import { getTodayIST } from "@/lib/curriculum-date-helpers";
import { formatDuration } from "@/lib/curriculum-helpers";
import {
  HOURS_WINDOWS,
  type ChapterStatus,
  type ChapterTestStatus,
  type HoursWindow,
} from "@/lib/curriculum-plan-rules";
import {
  CURRICULUM_SUMMARY_GRADES,
  defaultChapterTimelineSortDirection,
  getChapterTimeline,
  normalizeCurriculumSummarySearchParams,
  parseChapterTimelineSort,
  sortTimelineChapters,
  type ChapterTimeline,
  type ChapterTimelineResult,
  type ChapterTimelineSort,
  type ChapterTimelineSortKey,
} from "@/lib/curriculum-summary";
import ChapterLabel from "../../ChapterLabel";
import { requireCurriculumSummaryViewer } from "../../summary-access";
import {
  ApplyButton,
  AsOfField,
  CELL_CLASS_NAME,
  COMPACT_CELL_CLASS_NAME,
  COMPACT_COLUMN_CLASS_NAME,
  HeaderNumber,
  HiddenField,
  NUMBER_CELL_CLASS_NAME,
  NUMBER_COLUMN_CLASS_NAME,
  PAGE_CONTAINER_CLASS_NAME,
  SchemaUnavailableCard,
  SegmentLinks,
  SortableTableHead,
  sortableHeaders,
  TONE_BADGE_VARIANTS,
  type SortableColumn,
} from "../../summary-ui";
import UrlFilterForm from "../../UrlFilterForm";

const HOURS_WINDOW_LABELS: Record<HoursWindow, string> = {
  ay: "This AY",
  "30d": "Last 30 days",
  "7d": "Last 7 days",
};

type SearchParams = Record<string, string | string[] | undefined>;

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Grade and as-of as the Summary reads them; an unknown hours window falls back to This AY, and
// an unknown sort column to the default order.
function timelineQuery(searchParams: SearchParams) {
  const { grade, asOf } = normalizeCurriculumSummarySearchParams(searchParams, getTodayIST());
  const requestedHours = firstValue(searchParams.hours);
  return {
    grade,
    asOf,
    requestedSubject: firstValue(searchParams.subject),
    hoursWindow: HOURS_WINDOWS.find((window) => window === requestedHours) ?? HOURS_WINDOWS[0],
    sort: parseChapterTimelineSort(firstValue(searchParams.sort), firstValue(searchParams.dir)),
  };
}

type TimelineResult = Exclude<ChapterTimelineResult, { status: 404 }>;

function pageHeading(result: TimelineResult, grade: number): { title: string; subtitle?: string } {
  if (!result.ok) return { title: "Chapter timeline" };
  const { row } = result.timeline;
  return {
    title: row.centreName,
    subtitle: [row.schoolName, row.programName, row.tracksLabel, `Grade ${grade}`].join(" · "),
  };
}

export default async function ChapterTimelinePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = timelineQuery(await searchParams);
  // Same page gate as the Curriculum Summary.
  const { email, permission } = await requireCurriculumSummaryViewer();
  const result = await getChapterTimeline(permission, Number(id), {
    grade: query.grade,
    asOf: query.asOf,
    hoursWindow: query.hoursWindow,
  });
  if (!result.ok && result.status === 404) notFound();

  return (
    <div className="min-h-screen bg-bg">
      <PageHeader
        {...pageHeading(result, query.grade)}
        backHref={`/curriculum-summary?${new URLSearchParams({ grade: String(query.grade), as_of: query.asOf })}`}
        userEmail={email}
        containerClassName={PAGE_CONTAINER_CLASS_NAME}
      />
      <main className="w-full space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        {result.ok ? (
          <TimelineView
            timeline={result.timeline}
            centreId={Number(id)}
            requestedSubject={query.requestedSubject}
            sort={query.sort}
            isAdmin={permission.role === "admin"}
          />
        ) : (
          <SchemaUnavailableCard error={result.error} details={result.details} />
        )}
      </main>
    </div>
  );
}

// What every timeline link starts from: the page's Centre, timeline and column sort.
interface TimelineLinks {
  centreId: number;
  timeline: ChapterTimeline;
  sort: ChapterTimelineSort | null;
}

// Links keep the hours window and the column sort; the subject only when given.
function timelineHref(
  { centreId, timeline, sort: currentSort }: TimelineLinks,
  overrides: { grade?: number; subject?: string | null; hours?: HoursWindow; sort?: ChapterTimelineSort } = {}
): string {
  const search = new URLSearchParams({
    grade: String(overrides.grade ?? timeline.grade),
    as_of: timeline.asOf,
  });
  // This AY is the default, so it stays out of the URL.
  const hours = overrides.hours ?? timeline.hoursWindow;
  if (hours !== "ay") search.set("hours", hours);
  if (overrides.subject) search.set("subject", overrides.subject);
  const sort = overrides.sort ?? currentSort;
  if (sort) {
    search.set("sort", sort.key);
    search.set("dir", sort.dir);
  }
  return `/curriculum-summary/centres/${centreId}?${search.toString()}`;
}

function TimelineFilters({ links, subject }: { links: TimelineLinks; subject: string | null }) {
  const { centreId, timeline, sort } = links;
  return (
    <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-end">
      {/* Another Grade may have other subjects, so switching Grade starts at All. A Grade the
          Centre has no class for has no timeline, so it is shown but not linked. */}
      <SegmentLinks
        label="Grade"
        navLabel="Grade"
        links={CURRICULUM_SUMMARY_GRADES.map((grade) => ({
          key: String(grade),
          label: `Grade ${grade}`,
          href: timelineHref(links, { grade }),
          active: timeline.grade === grade,
          disabledTitle: timeline.grades.includes(grade)
            ? undefined
            : `No Grade ${grade} class at this Centre`,
        }))}
      />
      <SegmentLinks
        label="Hours"
        navLabel="Hours window"
        links={HOURS_WINDOWS.map((hours) => ({
          key: hours,
          label: HOURS_WINDOW_LABELS[hours],
          href: timelineHref(links, { hours, subject }),
          active: timeline.hoursWindow === hours,
        }))}
      />
      <UrlFilterForm
        key={timelineHref(links, { subject })}
        action={`/curriculum-summary/centres/${centreId}`}
        className="flex flex-wrap items-end gap-2"
      >
        <input type="hidden" name="grade" value={timeline.grade} />
        <HiddenField name="hours" value={timeline.hoursWindow !== "ay" ? timeline.hoursWindow : null} />
        <HiddenField name="subject" value={subject} />
        <HiddenField name="sort" value={sort?.key ?? null} />
        <HiddenField name="dir" value={sort?.dir ?? null} />
        <AsOfField asOf={timeline.asOf} />
        <ApplyButton />
      </UrlFilterForm>
    </Card>
  );
}

function TimelineView({
  timeline,
  centreId,
  requestedSubject,
  sort,
  isAdmin,
}: {
  timeline: ChapterTimeline;
  centreId: number;
  requestedSubject: string | undefined;
  sort: ChapterTimelineSort | null;
  isAdmin: boolean;
}) {
  const links: TimelineLinks = { centreId, timeline, sort };
  if (timeline.row.kind !== "plan" && timeline.row.kind !== "no_plan") {
    return (
      <>
        <TimelineFilters links={links} subject={null} />
        <Card className="border-l-4 border-l-warning-border p-6">
          <p data-testid="timeline-explanation" className="font-bold text-warning-text">
            {timeline.row.explanation}
          </p>
        </Card>
      </>
    );
  }
  const subject = timeline.subjects.find((tab) => tab.subject === requestedSubject)?.subject ?? null;
  const chapters = sortTimelineChapters(
    subject ? timeline.chapters.filter((chapter) => chapter.subject === subject) : timeline.chapters,
    sort
  );
  return (
    <>
      <TimelineFilters links={links} subject={subject} />
      <PlanLabel timeline={timeline} isAdmin={isAdmin} />
      <TimelineHeader timeline={timeline} />
      <SubjectTabs links={links} subject={subject} />
      <TimelineTable timeline={{ ...timeline, chapters }} links={links} subject={subject} />
    </>
  );
}

function TimelineHeader({ timeline }: { timeline: ChapterTimeline }) {
  const { header } = timeline;
  // Due done and Tests overdue need plan dates.
  const measured = timeline.row.kind === "plan";
  return (
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
      <HeaderNumber label="Classes cancelled" value={String(header.cancellations)} testId="timeline-cancellations" />
      <HeaderNumber
        label="Doubt solving"
        value={formatHours(header.doubtSolvingMinutes)}
        testId="timeline-doubt-solving"
      />
    </div>
  );
}

function SubjectTabs({ links, subject }: { links: TimelineLinks; subject: string | null }) {
  const tabs: SubjectTab[] = [{ subject: null, progress: null }, ...links.timeline.subjects];
  return (
    <nav aria-label="Subject" className="flex flex-wrap gap-1">
      {tabs.map((tab) => (
        <SubjectTabLink
          key={tab.subject ?? "all"}
          tab={tab}
          href={timelineHref(links, { subject: tab.subject })}
          active={subject === tab.subject}
        />
      ))}
    </nav>
  );
}

// `subject: null` is the All tab.
type SubjectTab = { subject: string | null; progress: ChapterTimeline["subjects"][number]["progress"] };

function SubjectTabLink({ tab, href, active }: { tab: SubjectTab; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      data-subject-tab={tab.subject ?? "All"}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-bold ${
        active ? "border-accent bg-accent text-white" : "border-border text-accent hover:text-accent-hover"
      }`}
    >
      {tab.subject ?? "All"}
      {tab.progress ? <TabProgressBadge progress={tab.progress} active={active} /> : null}
    </Link>
  );
}

type TabProgress = NonNullable<SubjectTab["progress"]>;

// The selected tab is solid accent, so its badge is drawn on the card colour with the tone as
// text; the tinted Badge backgrounds would vanish into the accent.
const ACTIVE_TAB_BADGE_TEXT_CLASS_NAMES: Record<TabProgress["tone"], string> = {
  green: "text-success",
  amber: "text-warning-text",
  red: "text-danger",
};

function TabProgressBadge({ progress, active }: { progress: TabProgress; active: boolean }) {
  const text = `${progress.label} · ${progress.done}/${progress.due}`;
  if (!active) {
    return (
      <Badge variant={TONE_BADGE_VARIANTS[progress.tone]} data-tab-progress data-tone={progress.tone}>
        {text}
      </Badge>
    );
  }
  return (
    <span
      data-tab-progress
      data-tone={progress.tone}
      className={`inline-flex items-center rounded-full bg-bg-card px-2.5 py-1 text-xs font-bold ${
        ACTIVE_TAB_BADGE_TEXT_CLASS_NAMES[progress.tone]
      }`}
    >
      {text}
    </span>
  );
}

// Status and Chapter test are the key columns: wide enough that their labels never wrap, centred.
const STATUS_COLUMN_CLASS_NAME = "w-36 px-2 text-center";
const TEST_COLUMN_CLASS_NAME = "w-44 px-2 text-center";

// Column order (curriculum owner feedback): Chapter, Subject and dates, then the two statuses,
// then the hours-window numbers.
const TIMELINE_COLUMNS: SortableColumn<ChapterTimelineSortKey>[] = [
  { label: "Chapter", sortKey: "chapter" },
  { label: "Subject", sortKey: "subject", className: COMPACT_COLUMN_CLASS_NAME },
  { label: "Due", sortKey: "due", className: COMPACT_COLUMN_CLASS_NAME },
  { label: "Completed", sortKey: "completed", className: COMPACT_COLUMN_CLASS_NAME },
  { label: "Status", sortKey: "status", className: STATUS_COLUMN_CLASS_NAME },
  { label: "Chapter test", sortKey: "test", className: TEST_COLUMN_CLASS_NAME },
  { label: "Hours", sortKey: "hours", className: NUMBER_COLUMN_CLASS_NAME },
  { label: "Prescribed", sortKey: "prescribed", className: NUMBER_COLUMN_CLASS_NAME },
  { label: "Cancelled", sortKey: "cancelled", className: NUMBER_COLUMN_CLASS_NAME },
  { label: "Doubt solving", sortKey: "doubt_solving", className: NUMBER_COLUMN_CLASS_NAME },
];

// Every header links to its sort, keeping Grade, as-of, hours window and subject.
function timelineSortHeaders(links: TimelineLinks, subject: string | null) {
  return sortableHeaders(TIMELINE_COLUMNS, links.sort, defaultChapterTimelineSortDirection, (sort) =>
    timelineHref(links, { subject, sort })
  );
}

// The as-of line sits after the Chapters due on or before as-of. It only means something in the
// default due-date order, so a column sort leaves it out, as does a timeline without plan
// dates (-1).
function asOfMarkerIndex(timeline: ChapterTimeline, sorted: boolean): number {
  if (sorted || !timeline.chapters.some((chapter) => chapter.dueDate !== null)) return -1;
  const firstNotYetDue = timeline.chapters.findIndex(
    (chapter) => chapter.dueDate === null || chapter.dueDate > timeline.asOf
  );
  return firstNotYetDue === -1 ? timeline.chapters.length : firstNotYetDue;
}

function TimelineTable({
  timeline,
  links,
  subject,
}: {
  timeline: ChapterTimeline;
  links: TimelineLinks;
  subject: string | null;
}) {
  const markerIndex = asOfMarkerIndex(timeline, links.sort !== null);
  const marker = <AsOfMarker asOf={timeline.asOf} columns={TIMELINE_COLUMNS.length} />;
  return (
    <Card className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <SortableTableHead headers={timelineSortHeaders(links, subject)} />
        <tbody className="divide-y divide-border">
          {timeline.chapters.map((chapter, index) => (
            <Fragment key={chapter.chapterId}>
              {index === markerIndex ? marker : null}
              <TimelineRow chapter={chapter} />
            </Fragment>
          ))}
          {markerIndex === timeline.chapters.length ? marker : null}
        </tbody>
      </table>
    </Card>
  );
}

function TimelineRow({ chapter }: { chapter: ChapterTimeline["chapters"][number] }) {
  return (
    <tr data-timeline-row data-chapter={chapter.name}>
      <td data-chapter-label className={`${CELL_CLASS_NAME} px-4`}>
        {/* At most three lines; the full label is in the title. */}
        <span title={chapterTitle(chapter)} className="line-clamp-3 min-w-[12rem] max-w-[18rem]">
          <ChapterLabel code={chapter.code} name={chapter.name} />
        </span>
      </td>
      <td className={`${COMPACT_CELL_CLASS_NAME} whitespace-nowrap`}>{chapter.subject}</td>
      <td data-due className={`${COMPACT_CELL_CLASS_NAME} whitespace-nowrap`}>
        {formatOptionalDate(chapter.dueDate)}
      </td>
      <td data-completed-on className={`${COMPACT_CELL_CLASS_NAME} whitespace-nowrap`}>
        {formatOptionalDate(chapter.completedOn)}
      </td>
      <td data-status className={`${CELL_CLASS_NAME} whitespace-nowrap px-2 text-center`}>
        {chapterStatusLabel(chapter.status)}
      </td>
      <td data-test-status className={`${CELL_CLASS_NAME} whitespace-nowrap px-2 text-center`}>
        {chapterTestStatusLabel(chapter.testStatus)}
      </td>
      <td data-hours className={NUMBER_CELL_CLASS_NAME}>
        {formatHours(chapter.taughtMinutes)}
      </td>
      <td data-prescribed className={NUMBER_CELL_CLASS_NAME}>
        {formatHours(chapter.prescribedMinutes)}
      </td>
      <td data-cancellations className={NUMBER_CELL_CLASS_NAME}>
        {chapter.cancellations}
      </td>
      <td data-doubt-solving className={NUMBER_CELL_CLASS_NAME}>
        {formatHours(chapter.doubtSolvingMinutes)}
      </td>
    </tr>
  );
}

function chapterTitle(chapter: ChapterTimeline["chapters"][number]): string {
  return chapter.code ? `${chapter.code} ${chapter.name}` : chapter.name;
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
        <PlanName plan={plan} isAdmin={isAdmin} />
      </span>
      {plan?.closed ? (
        <Badge className="ml-2" data-timeline-plan-closed>
          Closed
        </Badge>
      ) : null}
    </p>
  );
}

function PlanName({ plan, isAdmin }: { plan: ChapterTimeline["row"]["plan"]; isAdmin: boolean }) {
  if (!plan) return "No plan";
  if (!isAdmin) return plan.title;
  return (
    <Link href={`/curriculum-summary/plans/${plan.id}`} className="text-accent hover:text-accent-hover">
      {plan.title}
    </Link>
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

function formatOptionalDate(date: string | null): string {
  return date ? formatDate(date) : "—";
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
