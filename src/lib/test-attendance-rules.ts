// Test Attendance rules (#517): the response shape the School page's Test
// Attendance tab reads, and the pure rules both the server and the browser
// apply to it. Client-safe: no database, permission or network imports here.

import { PMU_PROGRAM_ID } from "./constants";
import { studentHasCurrentProgram } from "./enrollment-stats";

/** The five Exam Preparing For values the tab groups by, in group order. */
const EXAM_PREPARING_FOR = ["Engineering", "Medical", "CLAT", "CA", "NDA"] as const;

export type ExamPreparingFor = (typeof EXAM_PREPARING_FOR)[number];

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

/** The grades the tab lists. Grade 13 is out of scope. */
const TEST_ATTENDANCE_GRADES: readonly number[] = [11, 12];

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
    TEST_ATTENDANCE_GRADES.includes(Number(student.grade))
  );
}

/** One Monthly Test that has opened. Times are UTC ISO strings. */
export interface TestAttendanceMonthlyTest {
  key: string;
  name: string;
  shortName: string;
  opensAt: string;
  closesAt: string;
  state: "running" | "closed";
  grades: number[];
}

/** How far a Student got in one Monthly Test, over all of its Papers. */
export type AttendanceMark = "not_opened" | "opened" | "submitted";

/** A Student on the tab's list, before any attendance. */
export interface ListedStudent {
  userId: string;
  name: string;
  studentId: string | null;
  grade: number;
  examPreparingFor: ExamPreparingFor | null;
}

/**
 * A Student on the tab's list. Carries nothing else about the Student.
 * `attendance` has one mark per Monthly Test key the Student is counted for,
 * and nothing for the others.
 */
export interface TestAttendanceStudent extends ListedStudent {
  attendance: Record<string, AttendanceMark>;
}

/** `GET /api/school/[udise]/test-attendance` */
export interface TestAttendanceResponse {
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
  /** When the warehouse attendance table was last rebuilt (UTC ISO); null when unknown. */
  lastRefreshed: string | null;
  /** When the server built the response (UTC ISO). */
  serverTime: string;
}

/** One entry of the PMU test set list: a Monthly Test's name and its Papers. */
export interface TestSet {
  label: string;
  quizIds: string[];
}

/**
 * One Paper's window from the `session` table. Times are UTC ISO strings, or
 * null when missing or unparseable. A Paper with no `session` row has none.
 */
export interface PaperWindow {
  quizId: string;
  opensAt: string | null;
  closesAt: string | null;
  grade: number | null;
  switchedOn: boolean;
}

/** A URL-safe key from a list label; later duplicates get "-2", "-3", … */
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

/** An opened Monthly Test with the quiz ids of its usable Papers. */
type OpenedMonthlyTest = TestAttendanceMonthlyTest & { quizIds: string[] };

/** The Monthly Test as the response carries it: no quiz ids. */
const withoutQuizIds = (test: OpenedMonthlyTest): TestAttendanceMonthlyTest => ({
  key: test.key,
  name: test.name,
  shortName: test.shortName,
  opensAt: test.opensAt,
  closesAt: test.closesAt,
  state: test.state,
  grades: test.grades,
});

function openedMonthlyTests(testSets: TestSet[], papers: PaperWindow[], now: Date): OpenedMonthlyTest[] {
  const byQuizId = new Map(papers.map((p) => [p.quizId, p]));
  const nowMs = now.getTime();
  const keys = new Set<string>();
  const tests: OpenedMonthlyTest[] = [];
  for (const set of testSets) {
    const key = keyFor(set.label, keys);
    const usable = usablePapers(set, byQuizId);
    if (usable.length === 0) continue;
    const opensAt = usable.reduce((min, p) => (Date.parse(p.opensAt) < Date.parse(min) ? p.opensAt : min), usable[0].opensAt);
    const closesAt = usable.reduce((max, p) => (Date.parse(p.closesAt) > Date.parse(max) ? p.closesAt : max), usable[0].closesAt);
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

/**
 * The Monthly Tests that have opened by `now`, ordered by closing time. A
 * Monthly Test is one test set list entry with at least one usable Paper
 * (switched on, both times known); it runs from its earliest Paper opening
 * until its latest Paper closing and is closed from then on.
 */
export function monthlyTestsFrom(
  testSets: TestSet[],
  papers: PaperWindow[],
  now: Date,
): TestAttendanceMonthlyTest[] {
  return openedMonthlyTests(testSets, papers, now).map(withoutQuizIds);
}

/** The quiz ids whose attendance the tab needs: the usable Papers of the opened Monthly Tests. */
export function attendanceQuizIds(testSets: TestSet[], papers: PaperWindow[], now: Date): string[] {
  return [...new Set(openedMonthlyTests(testSets, papers, now).flatMap((test) => test.quizIds))];
}

/**
 * One attendance row from the warehouse: the Student opened the Paper.
 * `submitted` is null when the warehouse does not know.
 */
export interface PaperAttendance {
  userId: string;
  quizId: string;
  submitted: boolean | null;
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The IST calendar day of a UTC instant, as `YYYY-MM-DD`. */
const istDate = (iso: string) => new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 10);

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

/** A month page's list filter: one mark, or every counted Student. */
export type MonthListFilter = AttendanceMark | "all";

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
 * grade then name. `previousWindow` (from `previousTestsWindow`) gives each
 * row its "Previous 3 tests" note: the All year follow-up note over that window.
 */
export function monthStudents(
  students: TestAttendanceStudent[],
  test: Pick<TestAttendanceMonthlyTest, "key" | "state">,
  filter: MonthListFilter = DEFAULT_MONTH_FILTER,
  previousWindow: WindowTest[] = [],
): MonthStudentRow[] {
  return students
    .filter((student) => {
      const mark = student.attendance[test.key];
      return mark != null && (filter === "all" || mark === filter);
    })
    .sort(byGradeThenName)
    .map((student) => {
      const { note, tone } = followUpFor(student, previousWindow);
      return { student, status: attendanceStatus(test.state, student.attendance[test.key]), previous: { note, tone } };
    });
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** IST wall clock of a UTC instant, read through the UTC getters. */
const istClock = (iso: string) => new Date(Date.parse(iso) + IST_OFFSET_MS);
const istDayNumber = (iso: string) => Math.floor((Date.parse(iso) + IST_OFFSET_MS) / 86_400_000);

/** An instant in IST, relative to `now`: "today at 2:15 pm", "tomorrow at …", "yesterday at …" or "on 21 Nov at …". */
function istDayAndTime(iso: string, now: string): string {
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
 * When a running Monthly Test closes, in IST, relative to `now`: "today at
 * 11:55 pm", "tomorrow at 11:55 pm" or "on 21 Nov at 11:55 pm".
 */
export function closingTimeText(closesAt: string, now: string): string {
  return istDayAndTime(closesAt, now);
}

/**
 * When the attendance data was last refreshed, in IST, relative to `now`:
 * "today at 2:15 pm", "yesterday at 11:05 pm", "on 15 Nov at 9:00 am", or
 * "unknown" when the lookup failed.
 */
export function lastRefreshedText(lastRefreshed: string | null | undefined, now: string): string {
  return lastRefreshed ? istDayAndTime(lastRefreshed, now) : "unknown";
}

/**
 * The period the tab opens on: the running Monthly Test (the one that opened
 * last if two are running), otherwise "all" (All year).
 */
export function defaultPeriod(monthlyTests: Pick<TestAttendanceMonthlyTest, "key" | "opensAt" | "state">[]): string {
  const running = monthlyTests.filter((test) => test.state === "running");
  if (running.length === 0) return "all";
  return running.reduce((latest, test) => (Date.parse(test.opensAt) > Date.parse(latest.opensAt) ? test : latest)).key;
}

/** A Student's Exam Preparing For group: one of the five, or "Not set". */
export type ExamPreparingForGroup = ExamPreparingFor | "Not set";

/** Group order: Engineering, Medical, CLAT, CA, NDA, Not set. */
const EXAM_PREPARING_FOR_GROUPS: readonly ExamPreparingForGroup[] = [...EXAM_PREPARING_FOR, "Not set"];

/** A blank or unrecognised value is "Not set", so no Student disappears from the counts. */
export function examPreparingForGroup(student: Pick<ListedStudent, "examPreparingFor">): ExamPreparingForGroup {
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
  grade: "all" | 11 | 12;
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
 * The tag window: the last 3 closed Monthly Tests of the School's list (fewer
 * early in the year), oldest first. A running Monthly Test never counts. One
 * window applies to every Student.
 */
export function tagWindow<T extends Pick<TestAttendanceMonthlyTest, "state">>(monthlyTests: T[]): T[] {
  return monthlyTests.filter((test) => test.state === "closed").slice(-TAG_WINDOW_SIZE);
}

/**
 * A month page's "Previous 3 tests" window: the tag window over the Monthly
 * Tests before the selected one, so the selected test is never in its own
 * window and a running one never counts. Empty for the first test of the year.
 */
export function previousTestsWindow<T extends Pick<TestAttendanceMonthlyTest, "key" | "state">>(
  monthlyTests: T[],
  testKey: string,
): T[] {
  const index = monthlyTests.findIndex((test) => test.key === testKey);
  return index < 0 ? [] : tagWindow(monthlyTests.slice(0, index));
}

/** Follow Up (red): Absent in 2 or more. Not Submitting (amber): Opened, not submitted in 2 or more. */
export type FollowUpTag = "follow_up" | "not_submitting";

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
 * A Student's tag and note over the tag window (from `tagWindow`), judged only
 * on the window's tests they are counted for. A tag always needs 2 misses of
 * one kind, so a Student counted for one test is never tagged and nobody has
 * both tags. Any miss or non-submission gets a note, tagged or not: months in
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

/** The All year list filter: everyone, or one tag. */
export type AllYearListFilter = "all" | FollowUpTag;

export interface AllYearStudentRow {
  student: TestAttendanceStudent;
  followUp: FollowUp;
  /** The window's tests the Student opened, submitted or not. */
  attended: number;
  /** The window's tests the Student is counted for. */
  counted: number;
}

/** List order: Follow Up by pattern, then Not Submitting, then everyone else. */
function followUpRank({ tag, pattern }: FollowUp): number {
  if (tag === "follow_up") return pattern ?? 1;
  return tag === "not_submitting" ? 4 : 5;
}

/**
 * The All year page's Students over the tag window (from `tagWindow`):
 * Follow Up by pattern, then Not Submitting, then everyone else; grade then
 * name within each.
 */
export function allYearStudents(
  students: TestAttendanceStudent[],
  window: Pick<TestAttendanceMonthlyTest, "key" | "shortName">[],
  filter: AllYearListFilter = "all",
): AllYearStudentRow[] {
  return students
    .map((student) => {
      const marks = window.flatMap((test) => (student.attendance[test.key] == null ? [] : [student.attendance[test.key]]));
      return {
        student,
        followUp: followUpFor(student, window),
        attended: marks.filter((mark) => mark !== "not_opened").length,
        counted: marks.length,
      };
    })
    .filter((row) => filter === "all" || row.followUp.tag === filter)
    .sort((a, b) => followUpRank(a.followUp) - followUpRank(b.followUp) || byGradeThenName(a.student, b.student));
}

/** The All year page's three tiles. */
export interface AllYearTiles {
  /** Every listed Student (after filters). */
  enrolled: number;
  /** Counted Students summed over the window's tests. */
  sittings: number;
  /** Sittings where the Student opened a Paper, submitted or not. */
  attended: number;
  /** Of the attended sittings, those opened and not submitted. */
  openedNotSubmitted: number;
  /** Students with the Follow Up Tag, out of `enrolled`. */
  followUp: number;
}

export function allYearTiles(
  students: TestAttendanceStudent[],
  window: Pick<TestAttendanceMonthlyTest, "key" | "shortName">[],
): AllYearTiles {
  const tiles: AllYearTiles = { enrolled: students.length, sittings: 0, attended: 0, openedNotSubmitted: 0, followUp: 0 };
  for (const student of students) {
    for (const test of window) {
      const mark = student.attendance[test.key];
      if (mark == null) continue;
      tiles.sittings += 1;
      if (mark !== "not_opened") tiles.attended += 1;
      if (mark === "opened") tiles.openedNotSubmitted += 1;
    }
    if (followUpFor(student, window).tag === "follow_up") tiles.followUp += 1;
  }
  return tiles;
}

/**
 * The line above the All year list: the counted tests (the tag window), any
 * running test that is added once it closes, and the two tag rules.
 */
export function countedTestsLine(
  monthlyTests: Pick<TestAttendanceMonthlyTest, "key" | "name" | "shortName" | "state">[],
): string {
  const running = monthlyTests.filter((test) => test.state === "running").map((test) => test.name);
  const added =
    running.length === 0
      ? ""
      : running.length === 1
        ? ` ${running[0]} is added once it closes.`
        : ` ${running.slice(0, -1).join(", ")} and ${running[running.length - 1]} are added once they close.`;
  return (
    `Counts tests that have closed: ${monthList(tagWindow(monthlyTests))}.${added} ` +
    "Follow up: Absent in 2 or more of them. Not submitting: Opened, not submitted in 2 or more of them."
  );
}

/** One bar of the All year chart: the attended share of the Students counted for one Monthly Test. */
export interface AttendanceChartBar {
  key: string;
  shortName: string;
  /** A running Monthly Test is drawn dashed and labelled "so far". */
  running: boolean;
  counted: number;
  attended: number;
  submitted: number;
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
      submitted,
      openedNotSubmitted: opened,
      percent: percentText(attended, counted),
      submittedShare: share(submitted),
      openedShare: share(opened),
    };
  });
}
