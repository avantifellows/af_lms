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

/** A Student on the tab's list. Carries nothing else about the Student. */
export interface TestAttendanceStudent {
  userId: string;
  name: string;
  studentId: string | null;
  grade: number;
  examPreparingFor: ExamPreparingFor | null;
}

/** `GET /api/school/[udise]/test-attendance` */
export interface TestAttendanceResponse {
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
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
  const byQuizId = new Map(papers.map((p) => [p.quizId, p]));
  const nowMs = now.getTime();
  const keys = new Set<string>();
  const tests: TestAttendanceMonthlyTest[] = [];
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
    });
  }
  return tests.sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt));
}

const IST_OFFSET_MS = 330 * 60 * 1000;
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** IST wall clock of a UTC instant, read through the UTC getters. */
const istClock = (iso: string) => new Date(Date.parse(iso) + IST_OFFSET_MS);
const istDayNumber = (iso: string) => Math.floor((Date.parse(iso) + IST_OFFSET_MS) / 86_400_000);

/**
 * When a running Monthly Test closes, in IST, relative to `now`: "today at
 * 11:55 pm", "tomorrow at 11:55 pm" or "on 21 Nov at 11:55 pm".
 */
export function closingTimeText(closesAt: string, now: string): string {
  const clock = istClock(closesAt);
  const hours = clock.getUTCHours();
  const time = `${hours % 12 || 12}:${String(clock.getUTCMinutes()).padStart(2, "0")} ${hours < 12 ? "am" : "pm"}`;
  const days = istDayNumber(closesAt) - istDayNumber(now);
  const day =
    days === 0 ? "today" : days === 1 ? "tomorrow" : `on ${clock.getUTCDate()} ${MONTH_SHORT[clock.getUTCMonth()]}`;
  return `${day} at ${time}`;
}
