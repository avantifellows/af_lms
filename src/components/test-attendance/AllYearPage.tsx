"use client";

// The Test Attendance tab's All year page (#517): three tiles (Attendance over
// the School's last 3 closed Monthly Tests), a month-by-month chart, and every
// listed Student, each judged over their own last 3 closed Monthly Tests they
// are counted for: repeat absentees (Follow Up) first and repeat non-submitters
// (Not Submitting) next. Tags, notes, order, tiles and chart bars come from the
// client-safe rules module, from the response the tab already loaded.
import { useState } from "react";

import { Card } from "@/components/ui";
import AttendanceChart from "@/components/test-attendance/AttendanceChart";
import StudentListHeader from "@/components/test-attendance/StudentListHeader";
import { Tile } from "@/components/test-attendance/MonthPage";
import {
  allYearColumns,
  allYearStudents,
  attendanceChart,
  allYearTiles,
  attendanceStatus,
  attendedText,
  countedTestsLine,
  percentText,
  schoolWindow,
  windowMark,
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

/** One column test for one Student: red = Absent, dashed amber = Opened, not submitted, light green = Submitted, empty = not counted or outside the Student's window. */
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
  const tiles = allYearTiles(students, monthlyTests);
  const chart = <AttendanceChart bars={attendanceChart(monthlyTests, students)} />;

  const enrolled = (
    <Tile name="Enrolled">
      <p className="mt-1 text-2xl font-bold text-text-primary">{tiles.enrolled}</p>
    </Tile>
  );

  if (schoolWindow(monthlyTests).length === 0) {
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

  const rows = allYearStudents(students, monthlyTests, filter);
  const columns = allYearColumns(monthlyTests, rows);
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
        <StudentListHeader
          title="All students"
          options={LIST_FILTERS}
          value={filter}
          onChange={setFilter}
          onDownload={() => onDownload(filter)}
        />
        <p className="text-xs text-text-muted">{countedTestsLine(monthlyTests, columns)}</p>

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
                  {columns.map((test) => (
                    <th key={test.key} scope="col" className="px-1 py-2 text-center font-medium">
                      {test.shortName}
                    </th>
                  ))}
                  <th scope="col" className="py-2 pl-3 pr-4 font-medium">Attended</th>
                  <th scope="col" className="py-2 font-medium">Follow-up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.student.userId}
                    className={`border-b border-border last:border-0 ${row.followUp.tag ? rowTone[row.followUp.tag] : ""}`}
                  >
                    <td className="py-2 pr-4 text-text-primary">{row.student.name}</td>
                    <td className="py-2 pr-4 text-text-secondary">{row.student.grade}</td>
                    <td className="py-2 pr-4 text-text-secondary">{row.student.examPreparingFor ?? "Not set"}</td>
                    {columns.map((test) => (
                      <td key={test.key} className="px-1 py-2 text-center">
                        <MonthBox test={test} mark={windowMark(row, test.key)} />
                      </td>
                    ))}
                    <td className="py-2 pl-3 pr-4 text-text-secondary">{attendedText(row.attended, row.counted)}</td>
                    <td className="py-2">
                      <FollowUpCell followUp={row.followUp} />
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
