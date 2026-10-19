// Curriculum Plan domain rules (issue #417): academic years, Summary Class classification,
// Primary Exam Track, Chapter status, Chapter Test Status and Behind pills. Every date and
// status rule lives here so the plan editor, the Curriculum Summary and the chapter timeline
// agree. Pure functions over `YYYY-MM-DD` IST calendar dates — no server-only imports, so
// client components may use it.

import { getTodayIST } from "./curriculum-date-helpers";
import { EXAM_TRACKS, type ExamTrack } from "./exam-tracks";

// An academic year `YYYY-YYYY+1` runs 1 Apr–31 Mar.
export function academicYearForDate(date: string): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

export interface AcademicYearRange {
  startYear: number;
  endYear: number;
}

// Parse `YYYY-YYYY` where the second year directly follows the first; anything else is null.
export function parseAcademicYear(value: string): AcademicYearRange | null {
  const match = /^(\d{4})-(\d{4})$/.exec(value);
  if (!match) return null;
  const startYear = Number(match[1]);
  const endYear = Number(match[2]);
  return endYear === startYear + 1 ? { startYear, endYear } : null;
}

function requireAcademicYear(academicYear: string): AcademicYearRange {
  const range = parseAcademicYear(academicYear);
  if (!range) throw new Error(`Invalid academic year: ${academicYear}`);
  return range;
}

export function academicYearStartDate(academicYear: string): string {
  return `${requireAcademicYear(academicYear).startYear}-04-01`;
}

export function academicYearEndDate(academicYear: string): string {
  return `${requireAcademicYear(academicYear).endYear}-03-31`;
}

export function currentAcademicYearIST(): string {
  return academicYearForDate(getTodayIST());
}

// Copy-from-last-year moves every date forward one year; 29 Feb becomes 28 Feb.
export function shiftDateForwardOneYear(date: string): string {
  // The year after a leap year never has a 29 Feb.
  const monthDay = date.slice(5);
  return `${Number(date.slice(0, 4)) + 1}-${monthDay === "02-29" ? "02-28" : monthDay}`;
}

export function shiftAcademicYearForward(academicYear: string): string {
  const { startYear, endYear } = requireAcademicYear(academicYear);
  return `${startYear + 1}-${endYear + 1}`;
}

// Exam Tracks with LMS curriculum content. CET and Math Foundation have none and are
// ignored for progress.
export const CONTENT_EXAM_TRACKS: readonly ExamTrack[] = ["jee_main", "jee_advanced", "neet"];

export type SummaryClass =
  | { kind: "single"; tracks: ExamTrack[] }
  | { kind: "shared"; tracks: ExamTrack[] }
  | { kind: "setup_error" }
  | { kind: "no_content" };

// Classify a Centre + Grade from its mapped Exam Tracks and the tracks with in-syllabus
// content for the Grade (ADR 0008). Only JEE Main + NEET form one shared class; any other
// pair of content tracks is a Centre Management setup error.
export function classifySummaryClass(
  mappedTracks: readonly string[],
  tracksWithContent: readonly string[],
): SummaryClass {
  const tracks = EXAM_TRACKS.filter(
    (track) =>
      CONTENT_EXAM_TRACKS.includes(track) &&
      mappedTracks.includes(track) &&
      tracksWithContent.includes(track),
  );
  if (tracks.length === 0) return { kind: "no_content" };
  if (tracks.length === 1) return { kind: "single", tracks };
  if (tracks.length === 2 && tracks[0] === "jee_main" && tracks[1] === "neet") {
    return { kind: "shared", tracks };
  }
  return { kind: "setup_error" };
}

// The Primary Exam Track supplies prescribed lecture time: JEE Main for a shared class,
// otherwise the only track. `EXAM_TRACKS` lists JEE Main first, so curriculum order decides.
export function primaryExamTrack(classTracks: readonly ExamTrack[]): ExamTrack | null {
  return EXAM_TRACKS.find((track) => classTracks.includes(track)) ?? null;
}

// Per Chapter, the primary track if it covers the Chapter, else the next class track in
// `EXAM_TRACKS` order that does (e.g. NEET for Biology in a shared class).
export function primaryExamTrackForChapter(
  classTracks: readonly ExamTrack[],
  chapterTracks: readonly string[],
): ExamTrack | null {
  return primaryExamTrack(classTracks.filter((track) => chapterTracks.includes(track)));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dateToUtcMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
}

// Whole days from `from` to `to` (negative when `to` is earlier).
function daysBetween(from: string, to: string): number {
  return Math.round((dateToUtcMs(to) - dateToUtcMs(from)) / DAY_MS);
}

export type ChapterStatus =
  | { kind: "not_in_plan" }
  | { kind: "done" }
  | { kind: "done_late"; days: number }
  | { kind: "overdue"; days: number }
  | { kind: "not_due" };

// `completedOn` is the earliest Chapter Completion date within [1 Apr of the plan's academic
// year, as-of], or null. A Chapter due on the as-of date is due, so it is Overdue 0 days
// until completed.
export function chapterStatus(input: {
  dueDate: string | null;
  completedOn: string | null;
  asOf: string;
}): ChapterStatus {
  const { dueDate, completedOn, asOf } = input;
  if (!dueDate) return { kind: "not_in_plan" };
  if (completedOn) {
    return completedOn <= dueDate
      ? { kind: "done" }
      : { kind: "done_late", days: daysBetween(dueDate, completedOn) };
  }
  if (dueDate <= asOf) return { kind: "overdue", days: daysBetween(dueDate, asOf) };
  return { kind: "not_due" };
}

function addDays(date: string, days: number): string {
  return new Date(dateToUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

// Fixed grace period: a Chapter Test is Overdue only once the as-of date is more than this
// many days after the Chapter Test Date.
const CHAPTER_TEST_GRACE_DAYS = 7;

export type ChapterTestStatus =
  | { kind: "conducted"; conductedOn: string }
  | { kind: "scheduled" }
  | { kind: "overdue" }
  | { kind: "not_due" };

// `sessionEndTimes` are the Chapter's Chapter Test session end times as IST wall-clock
// timestamps (`YYYY-MM-DD HH:mm:ss` or ISO without offset; null = no end time). A session has
// ended when it ends by the end of the as-of day. The test date defaults to due + 1.
export function chapterTestStatus(input: {
  dueDate: string | null;
  testDate: string | null;
  sessionEndTimes: readonly (string | null)[];
  asOf: string;
}): ChapterTestStatus {
  const { dueDate, testDate, sessionEndTimes, asOf } = input;
  const endedOn = sessionEndTimes
    .map((endTime) => endTime?.slice(0, 10) ?? null)
    .filter((endDate): endDate is string => endDate !== null && endDate <= asOf)
    .sort();
  if (endedOn.length > 0) return { kind: "conducted", conductedOn: endedOn[0] };
  if (sessionEndTimes.length > 0) return { kind: "scheduled" };

  const effectiveTestDate = testDate ?? (dueDate ? addDays(dueDate, 1) : null);
  if (effectiveTestDate && asOf > addDays(effectiveTestDate, CHAPTER_TEST_GRACE_DAYS)) {
    return { kind: "overdue" };
  }
  return { kind: "not_due" };
}

// Due = Chapters with a due date on or before as-of; Done = Due Chapters with an in-window
// completion; Behind = Due − Done. Early completions of not-yet-due Chapters count in neither.
export function chapterProgress(
  chapters: readonly { dueDate: string | null; completedOn: string | null }[],
  asOf: string,
): { due: number; done: number; behind: number } {
  const dueChapters = chapters.filter((chapter) => chapter.dueDate !== null && chapter.dueDate <= asOf);
  const done = dueChapters.filter((chapter) => chapter.completedOn !== null).length;
  return { due: dueChapters.length, done, behind: dueChapters.length - done };
}

export type BehindPillTone = "green" | "amber" | "red";

export function behindPill(behind: number): { tone: BehindPillTone; label: string } {
  if (behind === 0) return { tone: "green", label: "On track" };
  return { tone: behind <= 2 ? "amber" : "red", label: `${behind} behind` };
}

// A Centre + Grade's mapped tracks that a plan cannot measure: tracks the plan doesn't serve,
// and tracks without in-syllabus content for the Grade (such as CET). Shown as "⚠ not
// covered" in the assignment preview.
export function uncoveredExamTracks(
  mappedTracks: readonly string[],
  planTracks: readonly string[],
  tracksWithContent: readonly string[],
): ExamTrack[] {
  return EXAM_TRACKS.filter(
    (track) =>
      mappedTracks.includes(track) &&
      !(CONTENT_EXAM_TRACKS.includes(track) && planTracks.includes(track) && tracksWithContent.includes(track)),
  );
}
