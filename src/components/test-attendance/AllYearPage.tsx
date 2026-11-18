"use client";

// The Test Attendance tab's All year page (#517): three tiles over the tag
// window (the last 3 closed Monthly Tests), a month-by-month chart, and every
// listed Student, repeat absentees (Follow Up) first and repeat non-submitters
// (Not Submitting) next. Tags, notes, order, tiles and chart bars come from the
// client-safe rules module, from the response the tab already loaded.
import { useState } from "react";

import { Button, Card } from "@/components/ui";
import AttendanceChart from "@/components/test-attendance/AttendanceChart";
import { Tile } from "@/components/test-attendance/MonthPage";
import {
  allYearStudents,
  attendanceChart,
  allYearTiles,
  attendanceStatus,
  attendedText,
  countedTestsLine,
  percentText,
  tagWindow,
  type AllYearListFilter,
  type AttendanceMark,
  type FollowUp,
  type TestAttendanceMonthlyTest,
  type TestAttendanceStudent,
} from "@/lib/test-attendance-rules";

const LIST_FILTERS: { value: AllYearListFilter; label: string }[] = [
  { value: "all", label: "All students" },
  { value: "follow_up", label: "Need follow-up" },
  { value: "not_submitting", label: "Not submitting" },
];

const boxTone: Record<AttendanceMark, string> = {
  not_opened: "border-danger bg-danger",
  opened: "border-dashed border-warning-border bg-warning-bg",
  submitted: "border-success bg-success-bg",
};

/** One window test for one Student: red = Absent, dashed amber = Opened, not submitted, light green = Submitted, empty = not counted. */
function MonthBox({ test, mark }: { test: TestAttendanceMonthlyTest; mark: AttendanceMark | undefined }) {
  const label = mark == null ? "not counted" : attendanceStatus("closed", mark);
  return (
    <span
      role="img"
      aria-label={`${test.shortName}: ${label}`}
      title={`${test.name}: ${label}`}
      className={`inline-block h-5 w-5 rounded border-2 ${mark == null ? "border-border" : boxTone[mark]}`}
    />
  );
}

const rowTone: Record<NonNullable<FollowUp["tag"]>, string> = {
  follow_up: "bg-danger-bg",
  not_submitting: "bg-warning-bg",
};

function FollowUpCell({ followUp }: { followUp: FollowUp }) {
  return (
    <div className="flex flex-col items-start gap-1">
      {followUp.tag === "follow_up" && (
        <span className="whitespace-nowrap rounded-full bg-danger px-2 py-0.5 text-[11px] font-bold text-white">Follow up</span>
      )}
      {followUp.tag === "not_submitting" && (
        <span className="whitespace-nowrap rounded-full bg-warning-border px-2 py-0.5 text-[11px] font-bold text-white">
          Not submitting
        </span>
      )}
      {followUp.note && (
        <span className={`text-xs font-medium ${followUp.tone === "red" ? "text-danger" : "text-warning-text"}`}>
          {followUp.note}
        </span>
      )}
    </div>
  );
}

export default function AllYearPage({
  monthlyTests,
  students,
  onDownload,
}: {
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
  /** Downloads the list as it is on screen, under this list filter. */
  onDownload: (list: AllYearListFilter) => void;
}) {
  const [filter, setFilter] = useState<AllYearListFilter>("all");
  const windowTests = tagWindow(monthlyTests);
  const tiles = allYearTiles(students, windowTests);
  const chart = <AttendanceChart bars={attendanceChart(monthlyTests, students)} />;

  const enrolled = (
    <Tile name="Enrolled">
      <p className="mt-1 text-2xl font-bold text-text-primary">{tiles.enrolled}</p>
    </Tile>
  );

  if (windowTests.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{enrolled}</div>
        {chart}
        <Card elevation="sm" className="p-6 text-center">
          <p className="text-sm text-text-muted">Attendance and tags appear once a Monthly Test closes.</p>
        </Card>
      </div>
    );
  }

  const rows = allYearStudents(students, windowTests, filter);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {enrolled}
        <Tile name="Attendance">
          <p className="mt-1 text-2xl font-bold text-text-primary">{percentText(tiles.attended, tiles.sittings)}</p>
          <p className="text-xs text-text-secondary">
            {tiles.attended} of {tiles.sittings} sittings
          </p>
          <p className="text-xs text-text-muted">of these, {tiles.openedNotSubmitted} opened, not submitted</p>
        </Tile>
        <Tile name="Need follow-up">
          <p className="mt-1 text-2xl font-bold text-text-primary">
            {tiles.followUp} <span className="text-sm font-medium text-text-muted">of {tiles.enrolled}</span>
          </p>
          <p className="text-xs text-text-secondary">{percentText(tiles.followUp, tiles.enrolled)}</p>
        </Tile>
      </div>

      {chart}

      <Card elevation="sm" className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-text-primary">All students</h3>
          <div className="flex flex-wrap items-center gap-3">
            <div role="group" aria-label="Show Students" className="inline-flex flex-wrap gap-1">
              {LIST_FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                  className={`min-h-[44px] rounded-md border px-3 text-xs font-bold transition-colors ${
                    filter === option.value
                      ? "border-accent bg-accent text-text-on-accent"
                      : "border-border text-text-secondary hover:bg-hover-bg hover:text-text-primary"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button variant="secondary" onClick={() => onDownload(filter)}>
              Download
            </Button>
          </div>
        </div>
        <p className="text-xs text-text-muted">{countedTestsLine(monthlyTests)}</p>

        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">No Students in this list.</p>
        ) : (
          <div className="overflow-x-auto">
            <table aria-label="All students" className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Student</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Grade</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Exam Preparing For</th>
                  {windowTests.map((test) => (
                    <th key={test.key} scope="col" className="px-1 py-2 text-center font-medium">
                      {test.shortName}
                    </th>
                  ))}
                  <th scope="col" className="py-2 pl-3 pr-4 font-medium">Attended</th>
                  <th scope="col" className="py-2 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ student, followUp, attended, counted }) => (
                  <tr
                    key={student.userId}
                    className={`border-b border-border last:border-0 ${followUp.tag ? rowTone[followUp.tag] : ""}`}
                  >
                    <td className="py-2 pr-4 text-text-primary">{student.name}</td>
                    <td className="py-2 pr-4 text-text-secondary">{student.grade}</td>
                    <td className="py-2 pr-4 text-text-secondary">{student.examPreparingFor ?? "Not set"}</td>
                    {windowTests.map((test) => (
                      <td key={test.key} className="px-1 py-2 text-center">
                        <MonthBox test={test} mark={student.attendance[test.key]} />
                      </td>
                    ))}
                    <td className="py-2 pl-3 pr-4 text-text-secondary">{attendedText(attended, counted)}</td>
                    <td className="py-2">
                      <FollowUpCell followUp={followUp} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
