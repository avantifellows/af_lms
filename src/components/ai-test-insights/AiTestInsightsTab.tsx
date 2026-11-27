"use client";

// The School and Centre page's AI Test Insights Tab (#550, physical centres
// only). The roster page passes only the School code and, on a Centre page,
// the centre id; the tab loads its own list when shown. A failed load shows an
// error with Retry, never an empty list.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, Card, Input, Select } from "@/components/ui";
import {
  aiTestInsightsListUrl,
  aiTestInsightsStudentPageUrl,
  formatInsightSessionDate,
  type AiTestInsightsListResponse,
  type AiTestInsightsStudent,
} from "@/lib/ai-test-insights-shared";

type LoadState =
  | { status: "loading" }
  | { status: "failed" }
  | { status: "loaded"; students: AiTestInsightsStudent[] };

function useAiTestInsightsList(schoolCode: string, centreId: number | undefined) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  // Only the latest request may set state, and none after unmount.
  const latestRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setState({ status: "loading" });
    try {
      const response = await fetch(aiTestInsightsListUrl(schoolCode, centreId));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as AiTestInsightsListResponse;
      if (request === latestRequest.current) setState({ status: "loaded", students: data.students });
    } catch {
      if (request === latestRequest.current) setState({ status: "failed" });
    }
  }, [schoolCode, centreId]);

  useEffect(() => {
    const requests = latestRequest;
    void load();
    return () => {
      requests.current++;
    };
  }, [load]);

  return { state, retry: load };
}

function StudentTable({ students, centreId }: { students: AiTestInsightsStudent[]; centreId?: number }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="AI Test Insights students" className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
            <th scope="col" className="py-2 pr-3 font-medium">Student</th>
            <th scope="col" className="py-2 pr-3 font-medium">Grade</th>
            <th scope="col" className="py-2 pr-3 font-medium">Insight Sessions completed</th>
            <th scope="col" className="py-2 pr-3 font-medium">Test Insights generated</th>
            <th scope="col" className="py-2 pr-3 font-medium">Last Insight Session</th>
            <th scope="col" className="py-2 font-medium">Open</th>
          </tr>
        </thead>
        <tbody>
          {students.map((student) => (
            <tr key={student.studentId} className="border-b border-border last:border-0">
              <td className="py-2 pr-3">
                <div className="font-medium text-text-primary">{student.name}</div>
                <div className="font-mono text-xs text-text-secondary">{student.studentCode ?? "—"}</div>
              </td>
              <td className="py-2 pr-3 text-text-secondary">{student.grade}</td>
              <td className="py-2 pr-3 text-text-secondary">{student.insightSessionsCompleted}</td>
              <td className="py-2 pr-3 text-text-secondary">{student.testInsightsGenerated}</td>
              <td className="py-2 pr-3 text-text-secondary">{formatInsightSessionDate(student.lastInsightSessionDate)}</td>
              <td className="py-2">
                <Link
                  href={aiTestInsightsStudentPageUrl(student.studentId, centreId)}
                  aria-label={`Open ${student.name}`}
                  className="font-medium text-accent hover:text-accent-hover hover:underline"
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type GradeFilter = "all" | "11" | "12";

/** Search and filter the loaded list in the browser; no new request. */
function StudentList({ students, centreId }: { students: AiTestInsightsStudent[]; centreId?: number }) {
  const [search, setSearch] = useState("");
  const [grade, setGrade] = useState<GradeFilter>("all");

  if (students.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-text-muted">
        No JEE Students in Grade 11 or 12 are listed here.
      </p>
    );
  }

  const needle = search.trim().toLowerCase();
  const shown = students.filter(
    (student) =>
      (grade === "all" || String(student.grade) === grade) &&
      (!needle ||
        student.name.toLowerCase().includes(needle) ||
        (student.studentCode ?? "").toLowerCase().includes(needle)),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          type="search"
          aria-label="Search by name or Student ID"
          placeholder="Search by name or Student ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="sm:max-w-xs"
        />
        <Select
          aria-label="Grade"
          value={grade}
          onChange={(event) => setGrade(event.target.value as GradeFilter)}
          className="sm:w-32"
        >
          <option value="all">All</option>
          <option value="11">11</option>
          <option value="12">12</option>
        </Select>
      </div>
      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">No Students match your search.</p>
      ) : (
        <StudentTable students={shown} centreId={centreId} />
      )}
    </div>
  );
}

export default function AiTestInsightsTab({
  schoolCode,
  centreId,
}: {
  schoolCode: string;
  /** Set on a Centre page: the list narrows to that centre. */
  centreId?: number;
}) {
  const { state, retry } = useAiTestInsightsList(schoolCode, centreId);

  if (state.status === "loading") {
    return <p className="py-8 text-center text-sm text-text-muted">Loading AI Test Insights…</p>;
  }

  if (state.status === "failed") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-danger bg-danger-bg p-4">
        <p className="text-sm text-text-primary">Couldn&apos;t load AI Test Insights. Please try again.</p>
        <Button variant="secondary" onClick={() => void retry()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <Card elevation="sm" className="p-4">
      <StudentList students={state.students} centreId={centreId} />
    </Card>
  );
}
