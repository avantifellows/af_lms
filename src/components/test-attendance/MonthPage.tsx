"use client";

// A Monthly Test's page on the Test Attendance tab (#517): four tiles, the
// "By grade and Exam Preparing For" block and the Students list with its
// "Previous 3 tests" note. Every number comes from the client-safe rules module, from
// the response the tab already loaded. Below `sm` each table is a list of cards.
import { useState } from "react";

import { Button, Card } from "@/components/ui";
import StudentListHeader from "@/components/test-attendance/StudentListHeader";
import {
  MONTH_LIST_FILTERS,
  type MonthListFilter,
  type TestAttendanceMonthlyTest,
  type TestAttendanceStudent,
} from "@/types/test-attendance";
import {
  attendanceStatus,
  DEFAULT_MONTH_FILTER,
  monthGroupRows,
  monthStudents,
  monthTiles,
  percentText,
  type MonthGroupRow,
  type MonthStudentRow,
  type TestAttendanceStatus,
} from "@/lib/test-attendance-rules";

const PAGE_SIZE = 25;

export function Tile({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <section aria-label={name}>
      <Card elevation="sm" className="h-full p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{name}</p>
        {children}
      </Card>
    </section>
  );
}

/** A tile's big number (style guide: numbers in `font-mono`). */
export function TileNumber({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 font-mono text-2xl font-bold text-text-primary">{children}</p>;
}

function CountTile({ name, x, y }: { name: string; x: number; y: number }) {
  return (
    <Tile name={name}>
      <TileNumber>
        {x} <span className="text-sm font-medium text-text-muted">of {y}</span>
      </TileNumber>
      <p className="font-mono text-xs text-text-secondary">{percentText(x, y)}</p>
    </Tile>
  );
}

const statusTone: Record<TestAttendanceStatus, string> = {
  Submitted: "text-success",
  "In progress": "text-warning-text",
  "Opened, not submitted": "text-warning-text",
  "Yet to start": "text-text-secondary",
  Absent: "text-danger",
};

type StatusLabel = (mark: "opened" | "not_opened") => TestAttendanceStatus;

/** Submitted, then opened, as a two-part bar; its numbers are its accessible name. */
function GroupBar({ row, name, label }: { row: MonthGroupRow; name: string; label: StatusLabel }) {
  return (
    <span
      role="img"
      aria-label={`${name}: ${row.submitted} submitted, ${row.opened} ${label("opened").toLowerCase()}, of ${row.counted}`}
      className="mt-1 flex h-2 w-40 max-w-full overflow-hidden rounded-full bg-border"
    >
      <span className="bg-success" style={{ width: `${(row.submitted / row.counted) * 100}%` }} />
      <span className="bg-warning-border" style={{ width: `${(row.opened / row.counted) * 100}%` }} />
    </span>
  );
}

const groupName = (row: MonthGroupRow) => `Grade ${row.grade} · ${row.examPreparingFor}`;
const submittedText = (row: MonthGroupRow) =>
  `${row.submitted} of ${row.counted} (${percentText(row.submitted, row.counted)})`;

function GroupTable({ rows, label }: { rows: MonthGroupRow[]; label: StatusLabel }) {
  return (
    <div className="hidden overflow-x-auto sm:block">
      <table aria-label="By grade and Exam Preparing For" className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Group</th>
            <th scope="col" className="py-2 pr-4 font-medium">Submitted</th>
            <th scope="col" className="py-2 pr-4 font-medium">{label("opened")}</th>
            <th scope="col" className="py-2 font-medium">{label("not_opened")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const name = groupName(row);
            return (
              <tr key={name} className="border-b border-border last:border-0">
                <th scope="row" className="py-2 pr-4 text-left font-medium text-text-primary">{name}</th>
                <td className="py-2 pr-4 text-text-primary">
                  <span className="font-mono">{submittedText(row)}</span>
                  <GroupBar row={row} name={name} label={label} />
                </td>
                <td className="py-2 pr-4 font-mono text-text-secondary">{row.opened}</td>
                <td className="py-2 font-mono text-text-secondary">{row.notOpened}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The group rows as cards, for phones: the same rows, in the same order. */
function GroupCards({ rows, label }: { rows: MonthGroupRow[]; label: StatusLabel }) {
  return (
    <ul aria-label="By grade and Exam Preparing For" className="space-y-2 sm:hidden">
      {rows.map((row) => {
        const name = groupName(row);
        return (
          <li key={name}>
            <Card elevation="sm" className="space-y-1 p-3">
              <p className="text-sm font-medium text-text-primary">{name}</p>
              <p className="text-sm text-text-primary">
                Submitted <span className="font-mono">{submittedText(row)}</span>
              </p>
              <GroupBar row={row} name={name} label={label} />
              <p className="text-xs text-text-secondary">
                {label("opened")} <span className="font-mono">{row.opened}</span> · {label("not_opened")}{" "}
                <span className="font-mono">{row.notOpened}</span>
              </p>
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

/** One row per grade and Exam Preparing For, so a principal sees which group is behind. Rows add up to the tiles. */
function GroupBlock({ rows, label }: { rows: MonthGroupRow[]; label: StatusLabel }) {
  return (
    <Card elevation="sm" className="space-y-3 p-4">
      <h3 className="text-sm font-bold text-text-primary">By grade and Exam Preparing For</h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">No Students in this list.</p>
      ) : (
        <>
          <GroupCards rows={rows} label={label} />
          <GroupTable rows={rows} label={label} />
        </>
      )}
    </Card>
  );
}

function PreviousNote({ previous }: { previous: MonthStudentRow["previous"] }) {
  if (!previous.note) return null;
  return (
    <span className={`text-xs font-medium ${previous.tone === "red" ? "text-danger" : "text-warning-text"}`}>
      {previous.note}
    </span>
  );
}

/** A Student ID or APAAR ID cell value: "—" when missing (matches the Students tab). */
export const formatStudentId = (value: string | null) => value || "—";

/** Secondary ID line under a Student's name on phone cards; wraps between the two IDs, never mid-value. */
export function StudentIdsLine({ student }: { student: Pick<TestAttendanceStudent, "studentId" | "apaarId"> }) {
  return (
    <p className="text-xs text-text-muted">
      <span className="whitespace-nowrap">
        Student ID <span className="font-mono">{formatStudentId(student.studentId)}</span>
      </span>{" "}
      ·{" "}
      <span className="whitespace-nowrap">
        APAAR <span className="font-mono">{formatStudentId(student.apaarId)}</span>
      </span>
    </p>
  );
}

function StudentTable({ rows }: { rows: MonthStudentRow[] }) {
  return (
    <div className="hidden overflow-x-auto sm:block">
      <table aria-label="Students" className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Student</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Student ID</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">APAAR ID</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Grade</th>
            <th scope="col" className="py-2 pr-3 font-medium">Exam Preparing For</th>
            <th scope="col" className="whitespace-nowrap py-2 pr-3 font-medium">Status</th>
            <th scope="col" className="whitespace-nowrap py-2 font-medium">Previous 3 tests</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ student, status, previous }) => (
            <tr key={student.userId} className="border-b border-border last:border-0">
              <td className="min-w-[8rem] py-2 pr-3 text-text-primary">{student.name}</td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-text-secondary">
                {formatStudentId(student.studentId)}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 font-mono text-xs text-text-secondary">
                {formatStudentId(student.apaarId)}
              </td>
              <td className="whitespace-nowrap py-2 pr-3 text-text-secondary">{student.grade}</td>
              <td className="whitespace-nowrap py-2 pr-3 text-text-secondary">{student.examPreparingFor ?? "Not set"}</td>
              <td className={`whitespace-nowrap py-2 pr-3 font-medium ${statusTone[status]}`}>{status}</td>
              <td className="min-w-[10rem] max-w-[16rem] py-2">
                <PreviousNote previous={previous} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The Students list as cards, for phones: the same rows, in the same order. */
function StudentCards({ rows }: { rows: MonthStudentRow[] }) {
  return (
    <ul aria-label="Students" className="space-y-2 sm:hidden">
      {rows.map(({ student, status, previous }) => (
        <li key={student.userId}>
          <Card elevation="sm" className="space-y-1 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-text-primary">{student.name}</p>
              <p className={`text-sm font-medium ${statusTone[status]}`}>{status}</p>
            </div>
            <StudentIdsLine student={student} />
            <p className="text-xs text-text-secondary">
              Grade {student.grade} · {student.examPreparingFor ?? "Not set"}
            </p>
            {previous.note && (
              <p className="text-xs text-text-muted">
                Previous 3 tests: <PreviousNote previous={previous} />
              </p>
            )}
          </Card>
        </li>
      ))}
    </ul>
  );
}

export default function MonthPage({
  test,
  monthlyTests,
  students,
  onDownload,
}: {
  test: TestAttendanceMonthlyTest;
  /** Every opened Monthly Test, for the "Previous 3 tests" window. */
  monthlyTests: TestAttendanceMonthlyTest[];
  students: TestAttendanceStudent[];
  /** Downloads the list as it is on screen, under this list filter; rejects when the file cannot be made. */
  onDownload: (list: MonthListFilter) => Promise<void>;
}) {
  const [filter, setFilter] = useState<MonthListFilter>(DEFAULT_MONTH_FILTER);
  const [showAll, setShowAll] = useState(false);

  const tiles = monthTiles(students, test.key);
  const groups = monthGroupRows(students, test.key);
  const rows = monthStudents(students, test, filter, monthlyTests);
  const shown = showAll ? rows : rows.slice(0, PAGE_SIZE);
  const label = (mark: "not_opened" | "opened" | "submitted") => attendanceStatus(test.state, mark);
  // One button per list filter value; a mark's label depends on whether the test is running.
  const filters = MONTH_LIST_FILTERS.map((value) => ({ value, label: value === "all" ? "All" : label(value) }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile name="Enrolled">
          <TileNumber>{tiles.counted}</TileNumber>
          <p className="text-xs text-text-secondary">
            Attended{" "}
            <span className="font-mono">
              {tiles.attended} of {tiles.counted} ({percentText(tiles.attended, tiles.counted)})
            </span>
          </p>
        </Tile>
        <CountTile name="Submitted" x={tiles.submitted} y={tiles.counted} />
        <CountTile name={label("opened")} x={tiles.opened} y={tiles.counted} />
        <CountTile name={label("not_opened")} x={tiles.notOpened} y={tiles.counted} />
      </div>

      <GroupBlock rows={groups} label={label} />

      <Card elevation="sm" className="space-y-3 p-4">
        <StudentListHeader
          title="Students"
          options={filters}
          value={filter}
          onChange={(value) => {
            setFilter(value);
            setShowAll(false);
          }}
          onDownload={() => onDownload(filter)}
        />

        {rows.length === 0 ? (
          <p className="py-4 text-center text-sm text-text-muted">No Students in this list.</p>
        ) : (
          <>
            <StudentCards rows={shown} />
            <StudentTable rows={shown} />
          </>
        )}

        {!showAll && rows.length > PAGE_SIZE && (
          <Button variant="secondary" onClick={() => setShowAll(true)}>
            Show all
          </Button>
        )}
      </Card>
    </div>
  );
}
