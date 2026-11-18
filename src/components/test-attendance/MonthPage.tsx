"use client";

// A Monthly Test's page on the Test Attendance tab (#517): four tiles, the
// "By grade and Exam Preparing For" block and the Students list with its
// "Previous 3 tests" note. Every number comes from the client-safe rules module, from
// the response the tab already loaded.
import { useState } from "react";

import { Button, Card } from "@/components/ui";
import StudentListHeader from "@/components/test-attendance/StudentListHeader";
import type {
  MonthListFilter,
  TestAttendanceMonthlyTest,
  TestAttendanceStudent,
} from "@/types/test-attendance";
import {
  attendanceStatus,
  DEFAULT_MONTH_FILTER,
  monthGroupRows,
  monthStudents,
  monthTiles,
  percentText,
  type MonthGroupRow,
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

function CountTile({ name, x, y }: { name: string; x: number; y: number }) {
  return (
    <Tile name={name}>
      <p className="mt-1 text-2xl font-bold text-text-primary">
        {x} <span className="text-sm font-medium text-text-muted">of {y}</span>
      </p>
      <p className="text-xs text-text-secondary">{percentText(x, y)}</p>
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

/** One row per grade and Exam Preparing For, so a principal sees which group is behind. Rows add up to the tiles. */
function GroupBlock({ rows, label }: { rows: MonthGroupRow[]; label: (mark: "opened" | "not_opened") => TestAttendanceStatus }) {
  return (
    <Card elevation="sm" className="space-y-3 p-4">
      <h3 className="text-sm font-bold text-text-primary">By grade and Exam Preparing For</h3>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-text-muted">No Students in this list.</p>
      ) : (
        <div className="overflow-x-auto">
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
                const name = `Grade ${row.grade} · ${row.examPreparingFor}`;
                return (
                  <tr key={name} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-medium text-text-primary">{name}</th>
                    <td className="py-2 pr-4 text-text-primary">
                      <span>
                        {row.submitted} of {row.counted} ({percentText(row.submitted, row.counted)})
                      </span>
                      <span
                        role="img"
                        aria-label={`${name}: ${row.submitted} submitted, ${row.opened} ${label("opened").toLowerCase()}, of ${row.counted}`}
                        className="mt-1 flex h-2 w-40 overflow-hidden rounded-full bg-border"
                      >
                        <span className="bg-success" style={{ width: `${(row.submitted / row.counted) * 100}%` }} />
                        <span className="bg-warning-border" style={{ width: `${(row.opened / row.counted) * 100}%` }} />
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">{row.opened}</td>
                    <td className="py-2 text-text-secondary">{row.notOpened}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
  /** Downloads the list as it is on screen, under this list filter. */
  onDownload: (list: MonthListFilter) => void;
}) {
  const [filter, setFilter] = useState<MonthListFilter>(DEFAULT_MONTH_FILTER);
  const [showAll, setShowAll] = useState(false);

  const tiles = monthTiles(students, test.key);
  const groups = monthGroupRows(students, test.key);
  const rows = monthStudents(students, test, filter, monthlyTests);
  const shown = showAll ? rows : rows.slice(0, PAGE_SIZE);
  const label = (mark: "not_opened" | "opened" | "submitted") => attendanceStatus(test.state, mark);
  const filters: { value: MonthListFilter; label: string }[] = [
    { value: "not_opened", label: label("not_opened") },
    { value: "opened", label: label("opened") },
    { value: "submitted", label: label("submitted") },
    { value: "all", label: "All" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile name="Enrolled">
          <p className="mt-1 text-2xl font-bold text-text-primary">{tiles.counted}</p>
          <p className="text-xs text-text-secondary">
            Attended {tiles.attended} of {tiles.counted} ({percentText(tiles.attended, tiles.counted)})
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
          <div className="overflow-x-auto">
            <table aria-label="Students" className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
                  <th scope="col" className="py-2 pr-4 font-medium">Student</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Grade</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Exam Preparing For</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                  <th scope="col" className="py-2 font-medium">Previous 3 tests</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ student, status, previous }) => (
                  <tr key={student.userId} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary">{student.name}</td>
                    <td className="py-2 pr-4 text-text-secondary">{student.grade}</td>
                    <td className="py-2 pr-4 text-text-secondary">{student.examPreparingFor ?? "Not set"}</td>
                    <td className={`py-2 pr-4 font-medium ${statusTone[status]}`}>{status}</td>
                    <td className="py-2">
                      {previous.note && (
                        <span className={`text-xs font-medium ${previous.tone === "red" ? "text-danger" : "text-warning-text"}`}>
                          {previous.note}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
