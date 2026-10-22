"use client";

import { useEffect, useState, type ReactNode } from "react";
import StatCard from "../../StatCard";
import PriorityBadge from "../PriorityBadge";
import type { ChapterTestReportData } from "@/types/question-analytics";
import { appearedLine, formatLongDate } from "./format";
import { InsightsSection, QuestionBreakdownSection, QuestionRankingsSection } from "./QuestionSections";
import { GenderSplitSection, SchoolComparisonSection } from "./CohortSections";

interface Props {
  schoolUdise: string;
  grade: number;
  sessionId: string;
  program?: string;
  stream?: string;
  onDataLoaded?: (testName: string) => void;
  /** The combined student reports, shown right after the overview. */
  afterOverview?: ReactNode;
  /** Student Results, kept from the general test report, shown last. */
  studentResults?: ReactNode;
  /** Shown instead for a session that is not a single-chapter test (combined
   *  chapter tests, homework): they keep the general report's chapter analysis. */
  fallback?: ReactNode;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: ChapterTestReportData };

function sessionParams(grade: number, sessionId: string, program?: string, stream?: string): string {
  const query = new URLSearchParams({ grade: String(grade), sessionId });
  if (program) query.set("program", program);
  if (stream) query.set("stream", stream);
  return query.toString();
}

function PdfLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center min-h-[44px] text-xs font-bold uppercase tracking-wide text-accent hover:text-accent-hover"
    >
      {children}
    </a>
  );
}

/**
 * The chapter-test report for physical centres (Poojita's design, in LMS style):
 * overview, insights by topic and difficulty, the per-question breakdown and
 * rankings, the gender split and other centres on the same test. Student Results
 * and the combined reports are passed in from the general report.
 */
export default function ChapterTestReport({
  schoolUdise,
  grade,
  sessionId,
  program,
  stream,
  onDataLoaded,
  afterOverview,
  studentResults,
  fallback,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setState({ status: "loading" });
    const query = sessionParams(grade, sessionId, program, stream);
    fetch(`/api/quiz-analytics/${schoolUdise}/chapter-test-report?${query}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Failed to fetch the chapter test report");
        }
        return res.json() as Promise<ChapterTestReportData>;
      })
      .then((data) => {
        if (!current) return;
        setState({ status: "ready", data });
        if (onDataLoaded && data.test.test_name) onDataLoaded(data.test.test_name);
      })
      .catch((err) => {
        if (current && err.name !== "AbortError") setState({ status: "error", message: err.message });
      });
    return () => {
      current = false;
      controller.abort();
    };
  }, [schoolUdise, grade, sessionId, program, stream]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state.status === "loading") {
    return (
      <div className="flex justify-center items-center h-[30vh]">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
        <span className="ml-3 text-sm text-text-secondary">Loading chapter test report...</span>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="space-y-6">
        <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">{state.message}</div>
        {studentResults}
      </div>
    );
  }

  const { test, overview, gender, questions, comparison } = state.data;
  if (fallback && (test.test_format ?? "").toLowerCase() !== "chapter_test") return <>{fallback}</>;
  const totalQuestions = test.total_questions ?? questions.length;
  const appearedPct =
    overview.enrolled && overview.enrolled > 0
      ? ` (${Math.round((overview.students / overview.enrolled) * 100)}%)`
      : "";
  const meta = [
    "Chapter Test",
    test.subject,
    formatLongDate(test.start_date),
    `${appearedLine(overview.students, overview.enrolled)}${appearedPct}`,
  ].filter(Boolean);
  const attemptedQuestions = Math.round((overview.avg_attempt_rate / 100) * totalQuestions);
  // The server resolves the CMS test from the session; only new-CMS tests have one.
  const isNewCms = test.cms_test_id != null && /^\d+$/.test(test.cms_test_id);
  const sessionQuery = isNewCms ? sessionParams(grade, sessionId, program, stream) : null;
  const pdfBase = sessionQuery ? `/api/quiz-analytics/${schoolUdise}/test-pdf?${sessionQuery}` : null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {test.exam && (
            <span className="text-xs font-bold uppercase tracking-wide text-text-secondary">{test.exam}</span>
          )}
          {test.priority && <PriorityBadge priority={test.priority} suffix=" priority" />}
        </div>
        <p className="text-sm text-text-secondary">{meta.join(" · ")}</p>
        {pdfBase && (
          <div className="flex flex-wrap gap-4">
            <PdfLink href={`${pdfBase}&type=questions`}>Question Paper (PDF)</PdfLink>
            <PdfLink href={`${pdfBase}&type=answers`}>Solution Key (PDF)</PdfLink>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Avg Attempt Rate"
          value={`${overview.avg_attempt_rate}% (~${attemptedQuestions} of ${totalQuestions} Qs)`}
          size="sm"
          color="brand-coral"
        />
        <StatCard
          label="Avg Accuracy"
          value={`${overview.avg_accuracy}% of attempted`}
          size="sm"
          color="brand-gold"
        />
        <StatCard
          label="Avg Score"
          value={
            test.max_marks
              ? `${overview.avg_score}% (${Math.round((overview.avg_score / 100) * test.max_marks * 10) / 10} of ${test.max_marks})`
              : `${overview.avg_score}%`
          }
          size="sm"
          color="brand-amber"
        />
        <StatCard
          label="Avg Time Taken"
          value={
            overview.avg_time_minutes == null
              ? "—"
              : test.duration_minutes
                ? `${overview.avg_time_minutes} of ${test.duration_minutes} min`
                : `${overview.avg_time_minutes} min`
          }
          size="sm"
          color="brand-gold"
        />
      </div>

      {afterOverview}

      <InsightsSection questions={questions} />
      <QuestionBreakdownSection questions={questions} schoolUdise={schoolUdise} sessionQuery={sessionQuery} />
      <QuestionRankingsSection questions={questions} schoolUdise={schoolUdise} sessionQuery={sessionQuery} />
      <GenderSplitSection gender={gender} />
      <SchoolComparisonSection rows={comparison} />
      {studentResults}
    </div>
  );
}
