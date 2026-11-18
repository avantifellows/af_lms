// Test Attendance rules (#517): the pure rules both the server and the
// browser apply to the tab's data (its shapes live in `@/types/test-attendance`).
// Client-safe: no database, permission or network imports here.

import {
  EXAM_PREPARING_FOR,
  EXAM_PREPARING_FOR_GROUPS,
  TEST_ATTENDANCE_GRADES,
  type AllYearListFilter,
  type AttendanceMark,
  type ExamPreparingFor,
  type ExamPreparingForGroup,
  type FollowUpTag,
  type ListedStudent,
  type MonthListFilter,
  type PaperAttendance,
  type PaperWindow,
  type TestAttendanceGrade,
  type TestAttendanceMonthlyTest,
  type TestAttendanceResponse,
  type TestAttendanceStudent,
  type TestSet,
} from "@/types/test-attendance";

import { PMU_PROGRAM_ID } from "./constants";
import { studentHasCurrentProgram } from "./enrollment-stats";

const BY_KEY = new Map<string, ExamPreparingFor>(
  EXAM_PREPARING_FOR.map((value) => [value.toLowerCase(), value]),
);

/**
 * A Student's Exam Preparing For, matched without regard to case. A blank or
 * unrecognised value is none (shown as "Not set").
 */
export function examPreparingFor(raw: string | null | undefined): ExamPreparingFor | null {
  return BY_KEY.get(raw?.trim().toLowerCase() ?? "") ?? null;
}

/** The roster fields the listing rule reads. */
export interface ListableRosterStudent {
  status?: string | null;
  grade: number | null;
  program_id: number | null;
  student_program_ids?: Array<number | string> | null;
}

/**
 * Whether a School roster Student is on the tab's list: the Download List
 * "Active" sheet (not dropped out, a current JNV NVS batch), then grades 11
 * and 12 only. The School page uses it to decide whether the tab shows and
 * the server uses it to build the response, so the two never disagree.
 */
export function isTestAttendanceStudent(student: ListableRosterStudent): boolean {
  return (
    student.status !== "dropout" &&
    studentHasCurrentProgram(student, PMU_PROGRAM_ID) &&
    student.grade != null &&
    (TEST_ATTENDANCE_GRADES as readonly number[]).includes(Number(student.grade))
  );
}

/** The period key of the All year page; never given to a Monthly Test. */
const ALL_YEAR_KEY = "all";

/**
 * A URL-safe key from a list label; later duplicates get "-2", "-3", …. `all`
 * is reserved for All year, so a set labelled "All" gets "all-2".
 */
function keyFor(label: string, taken: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "test";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`;
  taken.add(key);
  return key;
}

function usablePapers(set: TestSet, papers: Map<string, PaperWindow>) {
  return set.quizIds
    .map((quizId) => papers.get(quizId))
    .filter(
      (p): p is PaperWindow & { opensAt: string; closesAt: string } =>
        p != null && p.switchedOn && p.opensAt != null && p.closesAt != null,
    );
}

/** The earliest of these UTC ISO times, skipping nulls; null when there is none. */
export const earliestTime = (times: (string | null)[]) =>
  times.reduce<string | null>((min, t) => (t != null && (min == null || Date.parse(t) < Date.parse(min)) ? t : min), null);

/** The latest of these UTC ISO times, skipping nulls; null when there is none. */
export const latestTime = (times: (string | null)[]) =>
  times.reduce<string | null>((max, t) => (t != null && (max == null || Date.parse(t) > Date.parse(max)) ? t : max), null);

/** An opened Monthly Test with the quiz ids of its usable Papers. */
type OpenedMonthlyTest = TestAttendanceMonthlyTest & { quizIds: string[] };

/** The Monthly Test as the response carries it: no quiz ids. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- dropped on purpose
const withoutQuizIds = ({ quizIds, ...test }: OpenedMonthlyTest): TestAttendanceMonthlyTest => test;

/**
 * The Monthly Tests that have opened by `now`, ordered by closing time, with
 * the quiz ids of their usable Papers (the Papers the tab reads attendance
 * for; the response never carries them). A Monthly Test is one test set list
 * entry with at least one usable Paper (switched on, both times known); it
 * runs from its earliest Paper opening until its latest Paper closing and is
 * closed from then on.
 */
export function openedMonthlyTests(testSets: TestSet[], papers: PaperWindow[], now: Date): OpenedMonthlyTest[] {
  const byQuizId = new Map(papers.map((p) => [p.quizId, p]));
  const nowMs = now.getTime();
  const keys = new Set<string>([ALL_YEAR_KEY]);
  const tests: OpenedMonthlyTest[] = [];
  for (const set of testSets) {
    const key = keyFor(set.label, keys);
    const usable = usablePapers(set, byQuizId);
    if (usable.length === 0) continue;
    const opensAt = earliestTime(usable.map((p) => p.opensAt))!;
    const closesAt = latestTime(usable.map((p) => p.closesAt))!;
    if (nowMs < Date.parse(opensAt)) continue;
    const grades = [...new Set(usable.flatMap((p) => (p.grade == null ? [] : [p.grade])))].sort((a, b) => a - b);
    tests.push({
      key,
      name: set.label,
      shortName: set.label.slice(0, 3),
      opensAt,
      closesAt,
      state: nowMs < Date.parse(closesAt) ? "running" : "closed",
      grades,
      quizIds: usable.map((p) => p.quizId),
    });
  }
  return tests.sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt));
}

/** The quiz ids whose attendance the tab needs: the usable Papers of the opened Monthly Tests. */
export function attendanceQuizIds(testSets: TestSet[], papers: PaperWindow[], now: Date): string[] {
  return [...new Set(openedMonthlyTests(testSets, papers, now).flatMap((test) => test.quizIds))];
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** IST wall clock of a UTC instant, read through the UTC getters (or `toISOString`). */
export const istClock = (iso: string) => new Date(Date.parse(iso) + IST_OFFSET_MS);

/** The IST calendar day of a UTC instant, as `YYYY-MM-DD`. */
const istDate = (iso: string) => istClock(iso).toISOString().slice(0, 10);

/**
 * The tab's data: the opened Monthly Tests, and each listed Student's mark for
 * every Monthly Test they are counted for. A Student is counted when their
 * grade is one of the Monthly Test's grades and they joined NVS (`joinedOn`,
 * a `YYYY-MM-DD` date by LMS user id) on or before the IST calendar day it
 * closes. A Student with no joining date is counted. Any Paper of the Monthly Test
 * counts, whatever its grade; submitting any Paper is "submitted", opening
 * any is "opened". An unknown submitted state counts as not submitted.
 */
export function testAttendanceFrom(input: {
  testSets: TestSet[];
  papers: PaperWindow[];
  students: ListedStudent[];
  attendance: PaperAttendance[];
  joinedOn?: ReadonlyMap<string, string>;
  now: Date;
}): Pick<TestAttendanceResponse, "monthlyTests" | "students"> {
  const tests = openedMonthlyTests(input.testSets, input.papers, input.now);
  const byStudent = new Map<string, PaperAttendance[]>();
  for (const row of input.attendance) {
    const rows = byStudent.get(row.userId) ?? [];
    rows.push(row);
    byStudent.set(row.userId, rows);
  }
  const students = input.students.map((student) => {
    const rows = byStudent.get(student.userId) ?? [];
    const attendance: Record<string, AttendanceMark> = {};
    const joinedOn = input.joinedOn?.get(student.userId);
    for (const test of tests) {
      if (!test.grades.includes(student.grade)) continue;
      if (joinedOn != null && joinedOn > istDate(test.closesAt)) continue;
      const papersOpened = rows.filter((row) => test.quizIds.includes(row.quizId));
      attendance[test.key] = papersOpened.some((row) => row.submitted === true)
        ? "submitted"
        : papersOpened.length > 0
          ? "opened"
          : "not_opened";
    }
    return { ...student, attendance };
  });
  return { monthlyTests: tests.map(withoutQuizIds), students };
}

/** A Student's Test Attendance Status for one Monthly Test. */
export type TestAttendanceStatus = "Yet to start" | "In progress" | "Submitted" | "Absent" | "Opened, not submitted";

const STATUS: Record<TestAttendanceMonthlyTest["state"], Record<AttendanceMark, TestAttendanceStatus>> = {
  running: { not_opened: "Yet to start", opened: "In progress", submitted: "Submitted" },
  closed: { not_opened: "Absent", opened: "Opened, not submitted", submitted: "Submitted" },
};

/** The status for a mark: the furthest state reached, read against whether the test is running or closed. */
export function attendanceStatus(state: TestAttendanceMonthlyTest["state"], mark: AttendanceMark): TestAttendanceStatus {
  return STATUS[state][mark];
}

/** A whole percentage of `x` out of `y`; a zero base is "—", never "0%". */
export function percentText(x: number, y: number): string {
  return y === 0 ? "—" : `${Math.round((x / y) * 100)}%`;
}

/** A month page's counts. Every count is out of `counted`, the Students counted for the Monthly Test. */
export interface MonthTiles {
  counted: number;
  /** Opened any Paper, submitted or not. */
  attended: number;
  submitted: number;
  /** Opened a Paper and submitted none (In progress, or Opened, not submitted). */
  opened: number;
  /** Opened no Paper (Yet to start, or Absent). */
  notOpened: number;
}

export function monthTiles(students: TestAttendanceStudent[], testKey: string): MonthTiles {
  const tiles: MonthTiles = { counted: 0, attended: 0, submitted: 0, opened: 0, notOpened: 0 };
  for (const student of students) {
    const mark = student.attendance[testKey];
    if (mark == null) continue;
    tiles.counted += 1;
    if (mark === "submitted") tiles.submitted += 1;
    else if (mark === "opened") tiles.opened += 1;
    else tiles.notOpened += 1;
  }
  tiles.attended = tiles.submitted + tiles.opened;
  return tiles;
}

/** The month list opens on the Students to chase: Yet to start, or Absent. */
export const DEFAULT_MONTH_FILTER: MonthListFilter = "not_opened";

export interface MonthStudentRow {
  student: TestAttendanceStudent;
  status: TestAttendanceStatus;
  /** The "Previous 3 tests" note and its colour; both null when blank. */
  previous: Pick<FollowUp, "note" | "tone">;
}

/** Sorted by grade, then name. */
const byGradeThenName = (a: ListedStudent, b: ListedStudent) => a.grade - b.grade || a.name.localeCompare(b.name);

/**
 * The month page's Students: those counted for the Monthly Test, filtered, by
 * grade then name. Each row's "Previous 3 tests" note is the All year
 * follow-up note over that Student's `previousTestsWindow` in `monthlyTests`
 * (every opened Monthly Test, ordered by closing time).
 */
export function monthStudents(
  students: TestAttendanceStudent[],
  test: Pick<TestAttendanceMonthlyTest, "key" | "state">,
  filter: MonthListFilter = DEFAULT_MONTH_FILTER,
  monthlyTests: TagWindowTest[] = [],
): MonthStudentRow[] {
  const index = monthlyTests.findIndex((monthlyTest) => monthlyTest.key === test.key);
  const before = index < 0 ? [] : monthlyTests.slice(0, index);
  return students
    .filter((student) => {
      const mark = student.attendance[test.key];
      return mark != null && (filter === "all" || mark === filter);
    })
    .sort(byGradeThenName)
    .map((student) => {
      const { note, tone } = followUpFor(student, studentWindow(student, before));
      return { student, status: attendanceStatus(test.state, student.attendance[test.key]), previous: { note, tone } };
    });
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const istDayNumber = (iso: string) => Math.floor((Date.parse(iso) + IST_OFFSET_MS) / 86_400_000);

/**
 * An instant in IST, relative to `now`: "today at 2:15 pm", "tomorrow at …",
 * "yesterday at …" or "on 21 Nov at …". The tab says when a running Monthly
 * Test closes and when the attendance data was last refreshed with it.
 */
export function istDayAndTime(iso: string, now: string): string {
  const clock = istClock(iso);
  const hours = clock.getUTCHours();
  const time = `${hours % 12 || 12}:${String(clock.getUTCMinutes()).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
  const days = istDayNumber(iso) - istDayNumber(now);
  const day =
    days === 0
      ? "today"
      : days === 1
        ? "tomorrow"
        : days === -1
          ? "yesterday"
          : `on ${clock.getUTCDate()} ${MONTH_SHORT[clock.getUTCMonth()]}`;
  return `${day} at ${time}`;
}

/**
 * The period the tab opens on: the running Monthly Test (the one that opened
 * last if two are running), otherwise "all" (All year).
 */
export function defaultPeriod(monthlyTests: Pick<TestAttendanceMonthlyTest, "key" | "opensAt" | "state">[]): string {
  const running = monthlyTests.filter((test) => test.state === "running");
  if (running.length === 0) return ALL_YEAR_KEY;
  return running.reduce((latest, test) => (Date.parse(test.opensAt) > Date.parse(latest.opensAt) ? test : latest)).key;
}

/** A blank or unrecognised value is "Not set", so no Student disappears from the counts. */
function examPreparingForGroup(student: Pick<ListedStudent, "examPreparingFor">): ExamPreparingForGroup {
  return examPreparingFor(student.examPreparingFor) ?? "Not set";
}

/** One row of a month page's "By grade and Exam Preparing For" block. */
export interface MonthGroupRow extends MonthTiles {
  grade: number;
  examPreparingFor: ExamPreparingForGroup;
}

/**
 * A month page's group rows: one per grade and Exam Preparing For with at
 * least one Student counted for the Monthly Test, Grade 11 first and then in
 * group order. Each Student is in exactly one row, so the rows add up to the tiles.
 */
export function monthGroupRows(students: TestAttendanceStudent[], testKey: string): MonthGroupRow[] {
  const groups = new Map<string, { grade: number; examPreparingFor: ExamPreparingForGroup; students: TestAttendanceStudent[] }>();
  for (const student of students) {
    if (student.attendance[testKey] == null) continue;
    const group = examPreparingForGroup(student);
    const id = `${student.grade}|${group}`;
    const entry = groups.get(id) ?? { grade: student.grade, examPreparingFor: group, students: [] };
    entry.students.push(student);
    groups.set(id, entry);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        a.grade - b.grade ||
        EXAM_PREPARING_FOR_GROUPS.indexOf(a.examPreparingFor) - EXAM_PREPARING_FOR_GROUPS.indexOf(b.examPreparingFor),
    )
    .map(({ grade, examPreparingFor: group, students: members }) => ({
      grade,
      examPreparingFor: group,
      ...monthTiles(members, testKey),
    }));
}

/** The tab's Grade and Exam Preparing For filters. Component state only; not in the URL. */
export interface TestAttendanceFilters {
  grade: "all" | TestAttendanceGrade;
  examPreparingFor: "all" | ExamPreparingForGroup;
}

export const ALL_STUDENTS: TestAttendanceFilters = { grade: "all", examPreparingFor: "all" };

/** The listed Students the filters keep. Every number and list on the tab is counted from these. */
export function filterStudents<S extends TestAttendanceStudent>(students: S[], filters: TestAttendanceFilters): S[] {
  return students.filter(
    (student) =>
      (filters.grade === "all" || student.grade === filters.grade) &&
      (filters.examPreparingFor === "all" || examPreparingForGroup(student) === filters.examPreparingFor),
  );
}

/** The Exam Preparing For filter's options: the five, then "Not set" only when some listed Student has none. */
export function examPreparingForOptions(students: Pick<ListedStudent, "examPreparingFor">[]): ExamPreparingForGroup[] {
  return students.some((student) => examPreparingForGroup(student) === "Not set")
    ? [...EXAM_PREPARING_FOR_GROUPS]
    : [...EXAM_PREPARING_FOR];
}

/** How many closed Monthly Tests the tags and notes look back over. */
const TAG_WINDOW_SIZE = 3;

/**
 * The School window: the last 3 closed Monthly Tests of the School's list
 * (fewer early in the year), oldest first. A running Monthly Test never
 * counts. It describes the School's tests (the All year Attendance tile);
 * tags and notes use each Student's own `studentWindow` instead.
 */
export function schoolWindow<T extends Pick<TestAttendanceMonthlyTest, "state">>(monthlyTests: T[]): T[] {
  return monthlyTests.filter((test) => test.state === "closed").slice(-TAG_WINDOW_SIZE);
}

/** A Monthly Test as the tag rules read it. */
type TagWindowTest = Pick<TestAttendanceMonthlyTest, "key" | "shortName" | "state">;

/**
 * A Student's tag window: the last 3 closed Monthly Tests of `monthlyTests`
 * that Student is counted for (fewer early in the year or for a late joiner),
 * oldest first. A running Monthly Test never counts. A month page's "Previous
 * 3 tests" is this window over the Monthly Tests before the selected one, so
 * the selected test is never in its own window.
 */
function studentWindow<T extends TagWindowTest>(student: Pick<TestAttendanceStudent, "attendance">, monthlyTests: T[]): T[] {
  return schoolWindow(monthlyTests.filter((test) => student.attendance[test.key] != null));
}

/** How many misses of one kind a tag needs. */
const TAG_THRESHOLD = 2;

/**
 * The Follow Up patterns, in list order:
 * 1. missed every counted test, or the latest two in a row;
 * 2. missed the first and the last of three;
 * 3. missed the first two and attended the latest.
 */
export type FollowUpPattern = 1 | 2 | 3;

/** A Student's standing over the tag window. */
export interface FollowUp {
  tag: FollowUpTag | null;
  /** Set only with the Follow Up Tag. */
  pattern: FollowUpPattern | null;
  /** Names the window months missed or not submitted; null when there are none. */
  note: string | null;
  /** Red when the note has a miss, amber when it has only non-submissions. */
  tone: "red" | "amber" | null;
}

type WindowTest = Pick<TestAttendanceMonthlyTest, "key" | "shortName">;

const monthList = (tests: WindowTest[]) => tests.map((test) => test.shortName).join(", ");

/** The Follow Up pattern and its note, for a Student Absent in 2 or more of their `counted` tests. */
function followUpPattern(
  counted: WindowTest[],
  absent: WindowTest[],
  notSubmitted: WindowTest[],
): { pattern: FollowUpPattern; note: string } {
  const missed = (test: WindowTest) => absent.includes(test);
  // A non-submission outside the pattern's own wording is still named.
  const withNotSubmitted = (note: string) =>
    notSubmitted.length > 0 ? `${note} · Not submitted ${monthList(notSubmitted)}` : note;
  if (absent.length === counted.length) return { pattern: 1, note: `Missed ${monthList(absent)}` };
  // Three counted tests, two missed: which one was not?
  const [first, middle, last] = counted;
  if (!missed(first)) return { pattern: 1, note: withNotSubmitted(`Missed ${monthList([middle, last])} in a row`) };
  if (!missed(middle)) return { pattern: 2, note: withNotSubmitted(`Missed ${first.shortName} and ${last.shortName}`) };
  const latest = notSubmitted.includes(last) ? `Not submitted ${last.shortName}` : `attended ${last.shortName}`;
  return { pattern: 3, note: `Missed ${monthList([first, middle])} · ${latest}` };
}

/**
 * A Student's tag and note over a window of Monthly Tests, judged only on the
 * window's tests they are counted for (all of them, for a Student's own
 * `studentWindow`). A tag always needs 2 misses of one kind, so a Student
 * counted for one test is never tagged and nobody has both tags. Any miss or non-submission gets a note, tagged or not: months in
 * calendar order, misses first. A Follow Up Tag's note names its pattern.
 */
export function followUpFor(student: Pick<TestAttendanceStudent, "attendance">, window: WindowTest[]): FollowUp {
  const counted = window.filter((test) => student.attendance[test.key] != null);
  const absent = counted.filter((test) => student.attendance[test.key] === "not_opened");
  const notSubmitted = counted.filter((test) => student.attendance[test.key] === "opened");
  const tone = absent.length > 0 ? "red" : notSubmitted.length > 0 ? "amber" : null;
  if (absent.length >= TAG_THRESHOLD) {
    return { tag: "follow_up", ...followUpPattern(counted, absent, notSubmitted), tone };
  }
  const parts = [
    ...(absent.length > 0 ? [`Missed ${monthList(absent)}`] : []),
    ...(notSubmitted.length > 0 ? [`Not submitted ${monthList(notSubmitted)}`] : []),
  ];
  return {
    tag: notSubmitted.length >= TAG_THRESHOLD ? "not_submitting" : null,
    pattern: null,
    note: parts.length > 0 ? parts.join(" · ") : null,
    tone,
  };
}

/** "2 of 3 (67%)"; "—" when the Student is counted for none of the window's tests. */
export function attendedText(attended: number, counted: number): string {
  return counted === 0 ? "—" : `${attended} of ${counted} (${percentText(attended, counted)})`;
}

export interface AllYearStudentRow {
  student: TestAttendanceStudent;
  followUp: FollowUp;
  /** The keys of the Student's own window: their last 3 closed Monthly Tests they are counted for. */
  windowKeys: string[];
  /** The window's tests the Student opened, submitted or not. */
  attended: number;
  /** The window's tests the Student is counted for: the window's size. */
  counted: number;
}

/** List order: Follow Up by pattern, then Not Submitting, then everyone else. */
function followUpRank({ tag, pattern }: FollowUp): number {
  if (tag === "follow_up") return pattern ?? 1;
  return tag === "not_submitting" ? 4 : 5;
}

/**
 * The All year page's Students, each judged over their own window (their last
 * 3 closed Monthly Tests of `monthlyTests` they are counted for): Follow Up by
 * pattern, then Not Submitting, then everyone else; grade then name within each.
 */
export function allYearStudents(
  students: TestAttendanceStudent[],
  monthlyTests: TagWindowTest[],
  filter: AllYearListFilter = "all",
): AllYearStudentRow[] {
  return students
    .map((student) => {
      const window = studentWindow(student, monthlyTests);
      return {
        student,
        followUp: followUpFor(student, window),
        windowKeys: window.map((test) => test.key),
        attended: window.filter((test) => student.attendance[test.key] !== "not_opened").length,
        counted: window.length,
      };
    })
    .filter((row) => filter === "all" || row.followUp.tag === filter)
    .sort((a, b) => followUpRank(a.followUp) - followUpRank(b.followUp) || byGradeThenName(a.student, b.student));
}

/**
 * The All year list's month columns: the Monthly Tests in at least one listed
 * row's window, in list (calendar) order. Three when every row shares the
 * School's last 3 closed tests; more when a grade had no Paper in one of them.
 */
export function allYearColumns<T extends Pick<TestAttendanceMonthlyTest, "key">>(
  monthlyTests: T[],
  rows: Pick<AllYearStudentRow, "windowKeys">[],
): T[] {
  return monthlyTests.filter((test) => rows.some((row) => row.windowKeys.includes(test.key)));
}

/** A row's mark in one column; none (an empty box, a blank cell) when the test is outside the Student's window. */
export function windowMark(
  { student, windowKeys }: Pick<AllYearStudentRow, "student" | "windowKeys">,
  testKey: string,
): AttendanceMark | undefined {
  return windowKeys.includes(testKey) ? student.attendance[testKey] : undefined;
}

/** The All year page's three tiles. */
export interface AllYearTiles {
  /** Every listed Student (after filters). */
  enrolled: number;
  /** Counted Students summed over the School window's tests. */
  sittings: number;
  /** Sittings where the Student opened a Paper, submitted or not. */
  attended: number;
  /** Of the attended sittings, those opened and not submitted. */
  openedNotSubmitted: number;
  /** Students with the Follow Up Tag (over their own window), out of `enrolled`. */
  followUp: number;
}

/**
 * The All year tiles. Attendance counts sittings over the School window (the
 * School's last 3 closed Monthly Tests); Need follow-up counts the Students
 * whose own window gives them the Follow Up Tag.
 */
export function allYearTiles(students: TestAttendanceStudent[], monthlyTests: TagWindowTest[]): AllYearTiles {
  const tiles: AllYearTiles = { enrolled: students.length, sittings: 0, attended: 0, openedNotSubmitted: 0, followUp: 0 };
  const window = schoolWindow(monthlyTests);
  for (const student of students) {
    for (const test of window) {
      const mark = student.attendance[test.key];
      if (mark == null) continue;
      tiles.sittings += 1;
      if (mark !== "not_opened") tiles.attended += 1;
      if (mark === "opened") tiles.openedNotSubmitted += 1;
    }
    if (followUpFor(student, studentWindow(student, monthlyTests)).tag === "follow_up") tiles.followUp += 1;
  }
  return tiles;
}

/**
 * The line above the All year list: that tags look at each Student's own last
 * 3 closed tests, the months shown as `columns` (from `allYearColumns`), any
 * running test that is added once it closes, and the two tag rules.
 */
export function countedTestsLine(
  monthlyTests: Pick<TestAttendanceMonthlyTest, "key" | "name" | "shortName" | "state">[],
  columns: Pick<TestAttendanceMonthlyTest, "key" | "shortName">[],
): string {
  const running = monthlyTests.filter((test) => test.state === "running").map((test) => test.name);
  const added =
    running.length === 0
      ? ""
      : running.length === 1
        ? ` ${running[0]} is added once it closes.`
        : ` ${running.slice(0, -1).join(", ")} and ${running[running.length - 1]} are added once they close.`;
  const rules = "Follow up: Absent in 2 or more of them. Not submitting: Opened, not submitted in 2 or more of them.";
  if (schoolWindow(monthlyTests).length === 0) return `Counts tests that have closed: .${added} ${rules}`;
  const shown = columns.length > 0 ? ` (shown: ${monthList(columns)})` : "";
  return `Tags look at each Student's last ${TAG_WINDOW_SIZE} closed tests they are counted for${shown}.${added} ${rules}`;
}

/** One bar of the All year chart: the attended share of the Students counted for one Monthly Test. */
export interface AttendanceChartBar {
  key: string;
  shortName: string;
  /** A running Monthly Test is drawn dashed and labelled "so far". */
  running: boolean;
  counted: number;
  attended: number;
  openedNotSubmitted: number;
  /** The attended share as text; "—" for a zero base. */
  percent: string;
  /** Bar heights, as percentages of `counted`; 0 for a zero base. */
  submittedShare: number;
  openedShare: number;
}

/**
 * The All year chart: one bar per closed Monthly Test, oldest first, then any
 * running one. Each bar counts only the Students counted for its Monthly Test,
 * out of the Students passed in (already filtered).
 */
export function attendanceChart(
  monthlyTests: Pick<TestAttendanceMonthlyTest, "key" | "shortName" | "state">[],
  students: TestAttendanceStudent[],
): AttendanceChartBar[] {
  const ordered = [
    ...monthlyTests.filter((test) => test.state === "closed"),
    ...monthlyTests.filter((test) => test.state === "running"),
  ];
  return ordered.map((test) => {
    const { counted, attended, submitted, opened } = monthTiles(students, test.key);
    const share = (n: number) => (counted === 0 ? 0 : (n / counted) * 100);
    return {
      key: test.key,
      shortName: test.shortName,
      running: test.state === "running",
      counted,
      attended,
      openedNotSubmitted: opened,
      percent: percentText(attended, counted),
      submittedShare: share(submitted),
      openedShare: share(opened),
    };
  });
}
