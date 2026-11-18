"use client";

// A Monthly Test's page on the Test Attendance tab (#517): four tiles and the
// Students list. Every number comes from the client-safe rules module, from
// the response the tab already loaded.
import { useState } from "react";

import { Button, Card } from "@/components/ui";
import {
  attendanceStatus,
  DEFAULT_MONTH_FILTER,
  monthStudents,
  monthTiles,
  percentText,
  type MonthListFilter,
  type TestAttendanceMonthlyTest,
  type TestAttendanceStatus,
  type TestAttendanceStudent,
} from "@/lib/test-attendance-rules";

const PAGE_SIZE = 25;

function Tile({ name, children }: { name: string; children: React.ReactNode }) {
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
  "In progress": "text-warning",
  "Opened, not submitted": "text-warning",
  "Yet to start": "text-text-secondary",
  Absent: "text-danger",
};

export default function MonthPage({
  test,
  students,
}: {
  test: TestAttendanceMonthlyTest;
  students: TestAttendanceStudent[];
}) {
  const [filter, setFilter] = useState<MonthListFilter>(DEFAULT_MONTH_FILTER);
  const [showAll, setShowAll] = useState(false);

  const tiles = monthTiles(students, test.key);
  const rows = monthStudents(students, test, filter);
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

      <Card elevation="sm" className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-text-primary">Students</h3>
          <div role="group" aria-label="Show Students" className="inline-flex flex-wrap gap-1">
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => {
                  setFilter(option.value);
                  setShowAll(false);
                }}
                className={`min-h-[36px] rounded-md border px-3 text-xs font-bold transition-colors ${
                  filter === option.value
                    ? "border-accent bg-accent text-text-on-accent"
                    : "border-border text-text-secondary hover:bg-hover-bg hover:text-text-primary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

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
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(({ student, status }) => (
                  <tr key={student.userId} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4 text-text-primary">{student.name}</td>
                    <td className="py-2 pr-4 text-text-secondary">{student.grade}</td>
                    <td className="py-2 pr-4 text-text-secondary">{student.examPreparingFor ?? "Not set"}</td>
                    <td className={`py-2 font-medium ${statusTone[status]}`}>{status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!showAll && rows.length > PAGE_SIZE && (
          <Button variant="secondary" size="sm" onClick={() => setShowAll(true)}>
            Show all
          </Button>
        )}
      </Card>
    </div>
  );
}
