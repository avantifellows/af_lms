// Pre-launch data check for the Test Attendance tab (#517, #531). Compares,
// for every closed Monthly Test across all NVS Schools, the Students the tab's
// rules call Submitted with the Students who have a submitted result in the
// warehouse results table, an independent source. The tab's side comes from
// the tab's own loader and rules (passed in as sources), never a copy.
//
// Pure: every read is a source the caller passes in, so the comparison is
// testable without a database or the warehouse. A failed source rejects the
// whole run; it never turns into empty difference lists.
// `scripts/check-test-attendance.ts` wires the real, read-only sources.

import type {
  ListedStudentDiagnostics,
  PaperWindow,
  TestAttendanceResponse,
  TestSet,
} from "@/types/test-attendance";
import { examPreparingFor, istClock, openedMonthlyTests } from "./test-attendance-rules";

/** One submitted result in the warehouse: the Student submitted the quiz. */
export interface SubmittedResult {
  userId: string;
  quizId: string;
}

export interface CheckSources {
  /** Every NVS (JNV) School. */
  nvsSchools(): Promise<Array<{ id: string; code: string }>>;
  /** The PMU test set list. Throws when it cannot be read. */
  testSets(): Promise<TestSet[]>;
  /** Paper windows from `session` for these quiz ids. */
  paperWindows(quizIds: string[]): Promise<PaperWindow[]>;
  /**
   * One School, from a single read of its roster and joining dates: the tab's
   * data (the tab's own loader) and, for the same listed Students, their raw
   * Exam Preparing For and whether they have a joining date.
   */
  school(schoolId: string, now: Date): Promise<{ data: TestAttendanceResponse; diagnostics: ListedStudentDiagnostics[] }>;
  /** Submitted results in the warehouse for these quiz ids. */
  submittedResults(quizIds: string[]): Promise<SubmittedResult[]>;
}

export interface MonthlyTestComparison {
  key: string;
  name: string;
  /** Listed Students counted for the Monthly Test. */
  counted: number;
  /** Counted Students the tab calls Submitted. */
  tabSubmitted: number;
  /** Counted Students with a submitted result for one of its Papers. */
  withResult: number;
  /** Counted Students both sides call submitted. */
  matched: number;
  /** Tab says Submitted, no submitted result for any of the Monthly Test's Papers. LMS user ids. */
  submittedWithoutResult: string[];
  /** Submitted result, tab does not say Submitted. LMS user ids. */
  resultWithoutSubmitted: string[];
  /** Students with a submitted result the tab does not count for this Monthly Test (not listed, other grade, joined later). Not compared. */
  resultsNotCounted: number;
}

export interface CheckReport {
  /** When the check ran (UTC ISO): the instant that decides which Monthly Tests have closed. */
  checkedAt: string;
  /** NVS (JNV) Schools read. */
  schools: number;
  /** Students on the tab's list across those Schools. */
  listedStudents: number;
  monthlyTests: MonthlyTestComparison[];
  /** Listed Students whose Exam Preparing For is filled in but is not one of the five (the tab shows them as "Not set"), by raw value. */
  examPreparingFor: { unrecognised: number; values: Array<{ value: string; count: number }> };
  /** Listed Students with no NVS joining date (counted for every Monthly Test of their grade). */
  noJoiningDate: number;
  /** The `session` rows of every quiz id in the test set list. */
  papers: {
    quizIds: number;
    /** Quiz ids with no `session` row, or one without a grade or a time. */
    incomplete: Array<{ quizId: string; testSet: string; missing: string[] }>;
    /** Quiz ids whose `session` rows are all switched off: the tab skips them. */
    switchedOff: Array<{ quizId: string; testSet: string }>;
  };
}

/** Schools read at once: enough to finish a few hundred Schools in minutes without crowding the database. */
const SCHOOL_BATCH = 4;

const byNumber = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b);

export async function runTestAttendanceCheck(sources: CheckSources, now: Date): Promise<CheckReport> {
  const testSets = await sources.testSets();
  const papers = await sources.paperWindows([...new Set(testSets.flatMap((set) => set.quizIds))]);
  const closed = openedMonthlyTests(testSets, papers, now).filter((test) => test.state === "closed");

  const schools = await sources.nvsSchools();
  if (schools.length === 0) throw new Error("No NVS (JNV) Schools found; is this the right database?");
  const marks = new Map<string, Record<string, string>>();
  const listing: ListedStudentDiagnostics[] = [];
  // A few Schools at a time. Each batch settles before the next starts; the
  // first failure stops the run, so it is never reported as clean.
  for (let start = 0; start < schools.length; start += SCHOOL_BATCH) {
    const batch = schools.slice(start, start + SCHOOL_BATCH);
    const read = await Promise.allSettled(batch.map((school) => sources.school(school.id, now)));
    for (const result of read) {
      if (result.status === "rejected") throw result.reason;
      for (const student of result.value.data.students) marks.set(student.userId, student.attendance);
      listing.push(...result.value.diagnostics);
    }
  }

  const results = await sources.submittedResults([...new Set(closed.flatMap((test) => test.quizIds))]);

  const monthlyTests = closed.map((test) => {
    const withResult = new Set(
      results.filter((row) => test.quizIds.includes(row.quizId)).map((row) => row.userId),
    );
    const submittedWithoutResult: string[] = [];
    const resultWithoutSubmitted: string[] = [];
    let counted = 0;
    let tabSubmitted = 0;
    let matched = 0;
    for (const [userId, attendance] of marks) {
      const mark = attendance[test.key];
      if (mark == null) continue;
      counted += 1;
      const submitted = mark === "submitted";
      const hasResult = withResult.has(userId);
      if (submitted) tabSubmitted += 1;
      if (submitted && hasResult) matched += 1;
      if (submitted && !hasResult) submittedWithoutResult.push(userId);
      if (!submitted && hasResult) resultWithoutSubmitted.push(userId);
    }
    const countedWithResult = [...withResult].filter((userId) => marks.get(userId)?.[test.key] != null).length;
    return {
      key: test.key,
      name: test.name,
      counted,
      tabSubmitted,
      withResult: countedWithResult,
      matched,
      submittedWithoutResult: submittedWithoutResult.sort(byNumber),
      resultWithoutSubmitted: resultWithoutSubmitted.sort(byNumber),
      resultsNotCounted: withResult.size - countedWithResult,
    };
  });

  return {
    checkedAt: now.toISOString(),
    schools: schools.length,
    listedStudents: listing.length,
    monthlyTests,
    examPreparingFor: unrecognisedExamPreparingFor(listing),
    noJoiningDate: listing.filter((row) => !row.hasJoiningDate).length,
    papers: paperRows(testSets, papers),
  };
}

/** What a quiz id's session row lacks for the tab: the whole row, or its grade and times. */
function missingPaperFields(paper: PaperWindow | undefined): string[] {
  if (!paper) return ["session row"];
  const missing: string[] = [];
  if (paper.grade == null) missing.push("grade");
  if (paper.opensAt == null) missing.push("opening time");
  if (paper.closesAt == null) missing.push("closing time");
  return missing;
}

/** Each quiz id once, with the label of the first test set that lists it. */
function uniqueQuizIds(testSets: TestSet[]): { quizId: string; testSet: string }[] {
  const seen = new Map<string, string>();
  for (const set of testSets) {
    for (const quizId of set.quizIds) {
      if (!seen.has(quizId)) seen.set(quizId, set.label);
    }
  }
  return [...seen].map(([quizId, testSet]) => ({ quizId, testSet }));
}

function paperRows(testSets: TestSet[], papers: PaperWindow[]): CheckReport["papers"] {
  const byQuizId = new Map(papers.map((paper) => [paper.quizId, paper]));
  const quizIds = uniqueQuizIds(testSets);
  const incomplete: CheckReport["papers"]["incomplete"] = [];
  const switchedOff: CheckReport["papers"]["switchedOff"] = [];
  for (const { quizId, testSet } of quizIds) {
    const paper = byQuizId.get(quizId);
    const missing = missingPaperFields(paper);
    if (missing.length > 0) incomplete.push({ quizId, testSet, missing });
    if (paper && !paper.switchedOn) switchedOff.push({ quizId, testSet });
  }
  return { quizIds: quizIds.length, incomplete, switchedOff };
}

function unrecognisedExamPreparingFor(listing: ListedStudentDiagnostics[]): CheckReport["examPreparingFor"] {
  const counts = new Map<string, number>();
  for (const row of listing) {
    const value = row.rawExamPreparingFor?.trim() ?? "";
    if (value === "" || examPreparingFor(value) != null) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const values = [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { unrecognised: values.reduce((sum, v) => sum + v.count, 0), values };
}

const istMinute = (iso: string) => `${istClock(iso).toISOString().slice(0, 16).replace("T", " ")} IST`;

const idList = (ids: string[]) => (ids.length > 0 ? ids.join(", ") : "none");

/**
 * The report as plain text for the operator's terminal. Students appear only
 * as LMS user ids, never by name.
 */
export function formatCheckReport(report: CheckReport): string {
  const lines = [
    `Test Attendance pre-launch check, ${istMinute(report.checkedAt)}`,
    `NVS Schools: ${report.schools} · listed Students: ${report.listedStudents}`,
    "",
  ];
  if (report.monthlyTests.length === 0) lines.push("No Monthly Test has closed yet: nothing to compare.", "");
  for (const test of report.monthlyTests) {
    lines.push(
      `${test.name} (closed)`,
      `  Counted ${test.counted} · Submitted on the tab ${test.tabSubmitted} · with a submitted result ${test.withResult} · both ${test.matched}`,
      `  Submitted on the tab, no submitted result (${test.submittedWithoutResult.length}): ${idList(test.submittedWithoutResult)}`,
      `  Submitted result, not Submitted on the tab (${test.resultWithoutSubmitted.length}): ${idList(test.resultWithoutSubmitted)}`,
      `  Submitted results from Students the tab does not count (not compared): ${test.resultsNotCounted}`,
      "",
    );
  }

  const values = report.examPreparingFor.values.map((v) => `${v.value} ${v.count}`).join(", ");
  lines.push(
    `Exam Preparing For: ${report.examPreparingFor.unrecognised} listed Students have an unrecognised value (shown as Not set)${values ? `: ${values}` : ""}`,
    `No joining date: ${report.noJoiningDate} listed Students (counted for every Monthly Test of their grade)`,
    "",
    `session rows: ${report.papers.quizIds} quiz ids in the test set list`,
  );
  if (report.papers.incomplete.length === 0) {
    lines.push("  Every one has a session row with a grade and both times.");
  } else {
    lines.push(`  Missing a session row, grade or time (${report.papers.incomplete.length}):`);
    for (const paper of report.papers.incomplete) {
      lines.push(`    ${paper.quizId} (${paper.testSet}): ${paper.missing.join(", ")}`);
    }
  }
  const switchedOff = report.papers.switchedOff.map((paper) => `${paper.quizId} (${paper.testSet})`);
  lines.push(`  Switched off, skipped by the tab (${switchedOff.length}): ${idList(switchedOff)}`, "");
  return lines.join("\n");
}
