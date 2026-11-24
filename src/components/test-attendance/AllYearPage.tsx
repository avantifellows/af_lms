"use client";

// The Test Attendance tab's All year page (#517): three tiles (Attendance over
// the School's last 3 closed Monthly Tests), a month-by-month chart, and every
// listed Student, each judged over their own last 3 closed Monthly Tests they
// are counted for: repeat absentees (Follow Up) first and repeat non-submitters
// (Not Submitting) next. Tags, notes, order, tiles and chart bars come from the
// client-safe rules module, from the response the tab already loaded. Below
// `sm` the list is a list of cards.
import { useState } from "react";

import { Badge, Card } from "@/components/ui";
import AttendanceChart from "@/components/test-attendance/AttendanceChart";
import StudentListHeader from "@/components/test-attendance/StudentListHeader";
import { formatStudentId, StudentIdsLine, Tile, TileNumber } from "@/components/test-attendance/MonthPage";
import {
  ALL_YEAR_LIST_FILTERS,
  type AllYearListFilter,
  type AttendanceMark,
  type TestAttendanceMonthlyTest,
  type TestAttendanceStudent,
} from "@/types/test-attendance";
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
  type AllYearStudentRow,
  type FollowUp,
} from "@/lib/test-attendance-rules";

const LIST_FILTER_LABELS: Record<AllYearListFilter, string> = {
  all: "All students",
  follow_up: "Need follow-up",
  not_submitting: "Not submitting",
};

const LIST_FILTERS = ALL_YEAR_LIST_FILTERS.map((value) => ({ value, label: LIST_FILTER_LABELS[value] }));

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

const toneOf = (followUp: FollowUp) => (followUp.tag ? rowTone[followUp.tag] : "");

/** The tag as the shared Badge: red Follow up, amber Not submitting. */
function FollowUpTag({ followUp }: { followUp: FollowUp }) {
  if (followUp.tag === "follow_up") {
    return (
      <Badge variant="danger" className="whitespace-nowrap font-bold">
        Follow up
      </Badge>
    );
  }
  if (followUp.tag === "not_submitting") {
    return (
      <Badge variant="warning" className="whitespace-nowrap font-bold">
        Not submitting
      </Badge>
    );
  }
  return null;
}

function FollowUpNote({ followUp }: { followUp: FollowUp }) {
  if (!followUp.note) return null;
  return (
    <span className={`text-xs font-medium ${followUp.tone === "red" ? "text-danger" : "text-warning-text"}`}>
      {followUp.note}
    </span>
  );
}

function StudentTable({ rows, columns }: { rows: AllYearStudentRow[]; columns: TestAttendanceMonthlyTest[] }) {
  return (
    <div className="hidden overflow-x-auto sm:block">
      <table aria-label="All students" className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Student</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Student ID</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">APAAR ID</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Grade</th>
            <th scope="col" className="py-2 pr-3 font-medium">Exam Preparing For</th>
            {columns.map((test) => (
              <th key={test.key} scope="col" className="whitespace-nowrap px-1 py-2 text-center font-medium">
                {test.shortName}
              </th>
            ))}
            <th scope="col" className="whitespace-nowrap py-2 pl-2 pr-3 font-medium">Attended</th>
            <th scope="col" className="whitespace-nowrap py-2 font-medium">Follow-up</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.student.userId} className={`border-b border-border last:border-0 ${toneOf(row.followUp)}`}>
              <td className="min-w-[8rem] py-2 pr-3 text-text-primary">{row.student.name}</td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-text-secondary">
                {formatStudentId(row.student.studentId)}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-text-secondary">
                {formatStudentId(row.student.apaarId)}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-text-secondary">{row.student.grade}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-text-secondary">{row.student.examPreparingFor ?? "Not set"}</td>
              {columns.map((test) => (
                <td key={test.key} className="px-1 py-2 text-center">
                  <MonthBox test={test} mark={windowMark(row, test.key)} />
                </td>
              ))}
              <td className="whitespace-nowrap py-2 pl-2 pr-3 font-mono text-text-secondary">
                {attendedText(row.attended, row.counted)}
              </td>
              <td className="min-w-[10rem] max-w-[14rem] py-2">
                <div className="flex flex-col items-start gap-1">
                  <FollowUpTag followUp={row.followUp} />
                  <FollowUpNote followUp={row.followUp} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The list as cards, for phones: the same rows, in the same order, with the same month boxes. */
function StudentCards({ rows, columns }: { rows: AllYearStudentRow[]; columns: TestAttendanceMonthlyTest[] }) {
  return (
    <ul aria-label="All students" className="space-y-2 sm:hidden">
      {rows.map((row) => (
        <li key={row.student.userId}>
          <Card elevation="sm" className="overflow-hidden">
            <div className={`space-y-2 p-3 ${toneOf(row.followUp)}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-text-primary">{row.student.name}</p>
                  <StudentIdsLine student={row.student} />
                  <p className="text-xs text-text-secondary">
                    Grade {row.student.grade} · {row.student.examPreparingFor ?? "Not set"}
                  </p>
                </div>
                <FollowUpTag followUp={row.followUp} />
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {columns.map((test) => (
                  <span key={test.key} className="inline-flex items-center gap-1 text-xs text-text-muted">
                    <span aria-hidden="true">{test.shortName}</span>
                    <MonthBox test={test} mark={windowMark(row, test.key)} />
                  </span>
                ))}
              </div>
              <p className="text-xs text-text-secondary">
                Attended <span className="font-mono">{attendedText(row.attended, row.counted)}</span>
              </p>
              <FollowUpNote followUp={row.followUp} />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function AllYearPage({
  monthlyTests,
  students,
  onDownload,
}: {
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
  /** Downloads the list as it is on screen, under this list filter; rejects when the file cannot be made. */
  onDownload: (list: AllYearListFilter) => Promise<void>;
}) {
  const [filter, setFilter] = useState<AllYearListFilter>("all");
  const tiles = allYearTiles(students, monthlyTests);
  const chart = <AttendanceChart bars={attendanceChart(monthlyTests, students)} />;

  const enrolled = (
    <Tile name="Enrolled">
      <TileNumber>{tiles.enrolled}</TileNumber>
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
          <TileNumber>{percentText(tiles.attended, tiles.sittings)}</TileNumber>
          <p className="text-xs text-text-secondary">
            <span className="font-mono">
              {tiles.attended} of {tiles.sittings}
            </span>{" "}
            sittings
          </p>
          <p className="text-xs text-text-muted">
            of these, <span className="font-mono">{tiles.openedNotSubmitted}</span> opened, not submitted
          </p>
        </Tile>
        <Tile name="Need follow-up">
          <TileNumber>
            {tiles.followUp} <span className="text-sm font-medium text-text-muted">of {tiles.enrolled}</span>
          </TileNumber>
          <p className="font-mono text-xs text-text-secondary">{percentText(tiles.followUp, tiles.enrolled)}</p>
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
          <>
            <StudentCards rows={rows} columns={columns} />
            <StudentTable rows={rows} columns={columns} />
          </>
        )}
      </Card>
    </div>
  );
}
