"use client";

import type { ReactNode } from "react";
import StatCard from "../../StatCard";
import PriorityBadge from "../PriorityBadge";
import type { ChapterTestReportData } from "@/types/question-analytics";
import { appearedLine, formatLongDate } from "./format";
import { InsightsSection, QuestionBreakdownSection, QuestionRankingsSection } from "./QuestionSections";
import { GenderSplitSection, SchoolComparisonSection } from "./CohortSections";
import { useJsonFetch } from "./useJsonFetch";

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
  /** The general report, shown instead when this one fails to load or the session
   *  is not a single-chapter test (combined chapter tests, homework keep the
   *  general report's chapter analysis). */
  fallback?: ReactNode;
}

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

const isSingleChapterTest = (format: string | null) => (format ?? "").toLowerCase() === "chapter_test";
const isNewCmsTest = (cmsTestId: string | null) => cmsTestId != null && /^\d+$/.test(cmsTestId);

function ReportLoading() {
  return (
    <div className="flex justify-center items-center h-[30vh]">
      <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-accent" />
      <span className="ml-3 text-sm text-text-secondary">Loading chapter test report...</span>
    </div>
  );
}

function ReportHeader({ data, pdfBase }: { data: ChapterTestReportData; pdfBase: string | null }) {
  const { test, overview } = data;
  const appearedPct =
    overview.enrolled && overview.enrolled > 0
      ? ` (${Math.round((overview.appeared / overview.enrolled) * 100)}%)`
      : "";
  const meta = [
    "Chapter Test",
    test.subject,
    formatLongDate(test.start_date),
    `${appearedLine(overview.appeared, overview.enrolled)}${appearedPct}`,
  ].filter(Boolean);
  return (
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
  );
}

function scoreValue(score: number, maxMarks: number | null): string {
  if (!maxMarks) return `${score}%`;
  return `${score}% (${Math.round((score / 100) * maxMarks * 10) / 10} of ${maxMarks})`;
}

function timeValue(minutes: number | null, duration: number | null): string {
  if (minutes == null) return "—";
  return duration ? `${minutes} of ${duration} min` : `${minutes} min`;
}

function OverviewCards({ data }: { data: ChapterTestReportData }) {
  const { test, overview, questions } = data;
  const totalQuestions = test.total_questions ?? questions.length;
  const attemptedQuestions = Math.round((overview.avg_attempt_rate / 100) * totalQuestions);
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
      <StatCard
        label="Avg Attempt Rate"
        value={`${overview.avg_attempt_rate}% (~${attemptedQuestions} of ${totalQuestions} Qs)`}
        size="sm"
        color="brand-coral"
      />
      <StatCard label="Avg Accuracy" value={`${overview.avg_accuracy}% of attempted`} size="sm" color="brand-gold" />
      <StatCard
        label="Avg Score"
        value={scoreValue(overview.avg_score, test.max_marks)}
        size="sm"
        color="brand-amber"
      />
      <StatCard
        label="Avg Time Taken"
        value={timeValue(overview.avg_time_minutes, test.duration_minutes)}
        size="sm"
        color="brand-gold"
      />
    </div>
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
  const state = useJsonFetch<ChapterTestReportData>(
    `/api/quiz-analytics/${schoolUdise}/chapter-test-report?${sessionParams(grade, sessionId, program, stream)}`,
    "Failed to fetch the chapter test report",
    (data) => {
      if (onDataLoaded && data.test.test_name) onDataLoaded(data.test.test_name);
    }
  );

  if (state.status === "loading") return <ReportLoading />;
  if (state.status === "error") {
    if (fallback) return <>{fallback}</>;
    return (
      <div className="space-y-6">
        <div className="p-4 bg-danger-bg border border-danger text-danger rounded-lg">{state.message}</div>
        {studentResults}
      </div>
    );
  }

  const { test, gender, questions, comparison } = state.data;
  if (fallback && !isSingleChapterTest(test.test_format)) return <>{fallback}</>;
  // The server resolves the CMS test from the session; only new-CMS tests have one.
  const sessionQuery = isNewCmsTest(test.cms_test_id) ? sessionParams(grade, sessionId, program, stream) : null;

  return (
    <div className="space-y-6">
      <ReportHeader
        data={state.data}
        pdfBase={sessionQuery ? `/api/quiz-analytics/${schoolUdise}/test-pdf?${sessionQuery}` : null}
      />
      <OverviewCards data={state.data} />

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
