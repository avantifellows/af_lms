"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import type { ChapterAnalysisRow, TestQuestionLevelRow } from "@/types/quiz";

interface Props {
  chapters: ChapterAnalysisRow[];
  schoolUdise: string;
  grade: number;
  sessionId: string;
  program?: string;
  stream?: string;
}

function scoreColorClass(score: number): string {
  if (score < 40) return "bg-danger-bg";
  if (score < 60) return "bg-warning-bg";
  return "bg-success-bg";
}

// Stream-keyed chapter priority (resolved upstream by etl-next). Untagged
// chapters render an em-dash so the column reads cleanly until the curriculum
// team finishes backfilling chapter_tagging.
function PriorityBadge({ priority }: { priority: string | null }) {
  if (!priority || priority === "None") {
    return <span className="text-text-muted">—</span>;
  }
  const cls =
    priority === "High"
      ? "bg-danger-bg text-danger"
      : priority === "Medium"
        ? "bg-warning-bg text-text-primary"
        : "bg-success-bg text-text-primary";
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold ${cls}`}>
      {priority}
    </span>
  );
}

const TH = "px-4 py-3 text-left text-xs uppercase tracking-wider font-bold bg-bg-card-alt text-text-muted";
const QTH = "px-3 py-2 text-left text-xs uppercase tracking-wider font-bold text-text-muted";

// chapter_id is the stable join key shared by the v2 DynamoDB reports and the
// BQ question-level fact table (both COALESCE from chapter_tagging in the dbt
// models). When chapter_id is missing on either side we fall back to a
// subject+name composite so rows still group within a single render.
function chapterKey(
  chapterId: string | null,
  subject: string,
  chapterName: string
): string {
  if (chapterId) return `id:${chapterId}`;
  return `name:${subject.trim().toLowerCase()}::${chapterName.trim().toLowerCase()}`;
}

export default function ChapterAnalysisSection({
  chapters,
  schoolUdise,
  grade,
  sessionId,
  program,
  stream,
}: Props) {
  const [openSubjects, setOpenSubjects] = useState<Set<string>>(() => {
    if (chapters.length > 0) {
      const firstSubject = chapters[0].subject;
      return new Set([firstSubject]);
    }
    return new Set();
  });

  const [openChapters, setOpenChapters] = useState<Set<string>>(new Set());

  // Question-level cache for the whole test. Lazy-fetched on first chapter expand.
  const [questions, setQuestions] = useState<TestQuestionLevelRow[] | null>(null);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const questionsByChapter = useMemo(() => {
    if (!questions) return new Map<string, TestQuestionLevelRow[]>();
    const map = new Map<string, TestQuestionLevelRow[]>();
    for (const q of questions) {
      const key = chapterKey(q.chapter_id, q.subject, q.chapter_name);
      const list = map.get(key) || [];
      list.push(q);
      map.set(key, list);
    }
    return map;
  }, [questions]);

  const ensureQuestionsLoaded = async () => {
    if (questions !== null || questionsLoading) return;
    setQuestionsLoading(true);
    setQuestionsError(null);
    try {
      const programParam = program ? `&program=${encodeURIComponent(program)}` : "";
      const streamParam = stream ? `&stream=${encodeURIComponent(stream)}` : "";
      const res = await fetch(
        `/api/quiz-analytics/${schoolUdise}/test-questions?grade=${grade}&sessionId=${encodeURIComponent(sessionId)}${programParam}${streamParam}`
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Failed to fetch question-level data");
      }
      const data = (await res.json()) as { questions: TestQuestionLevelRow[] };
      setQuestions(data.questions || []);
    } catch (err) {
      setQuestionsError(err instanceof Error ? err.message : String(err));
    } finally {
      setQuestionsLoading(false);
    }
  };

  if (chapters.length === 0) {
    return (
      <Card elevation="sm" className="overflow-hidden">
        <div className="px-4 md:px-6 py-3 md:py-4 border-b-2 border-border-accent">
          <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
            Chapter Analysis
          </h3>
        </div>
        <div className="p-4 md:p-6">
          <p className="text-sm text-text-muted">No chapter-level data available for this test.</p>
        </div>
      </Card>
    );
  }

  const grouped = new Map<string, ChapterAnalysisRow[]>();
  for (const ch of chapters) {
    const list = grouped.get(ch.subject) || [];
    list.push(ch);
    grouped.set(ch.subject, list);
  }

  const subjects = Array.from(grouped.keys());

  const toggleSubject = (subject: string) => {
    setOpenSubjects((prev) => {
      const next = new Set(prev);
      if (next.has(subject)) next.delete(subject);
      else next.add(subject);
      return next;
    });
  };

  const toggleChapter = (chapter: ChapterAnalysisRow) => {
    const key = chapterKey(chapter.chapter_id, chapter.subject, chapter.chapter_name);
    const willOpen = !openChapters.has(key);
    setOpenChapters((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (willOpen) ensureQuestionsLoaded();
  };

  return (
    <Card elevation="sm" className="overflow-hidden">
      <div className="px-4 md:px-6 py-3 md:py-4 border-b-2 border-border-accent">
        <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
          Chapter Analysis
        </h3>
      </div>

      <div className="p-4 md:p-6 space-y-4">
        {subjects.map((subject) => {
          const isOpen = openSubjects.has(subject);
          return (
            <div key={subject}>
              <button
                onClick={() => toggleSubject(subject)}
                className={`flex items-center gap-2 text-sm font-bold uppercase tracking-wide transition-colors min-h-[44px] py-1 rounded-lg px-2 hover:bg-hover-bg ${
                  isOpen ? "text-accent" : "text-text-primary hover:text-accent"
                }`}
              >
                <span className="w-1 h-4 bg-accent" />
                {subject} ({grouped.get(subject)!.length} chapters)
                <span className="text-xs">{isOpen ? "▼" : "▶"}</span>
              </button>

              {isOpen && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b-2 border-border-accent">
                        <th className={TH}></th>
                        <th className={TH}>Chapter</th>
                        <th className={TH}>Priority</th>
                        <th className={TH}>Avg Score</th>
                        <th className={TH}>Accuracy</th>
                        <th className={TH}>Attempt Rate</th>
                        <th className={TH}>Questions</th>
                        <th className={TH}>Avg Time/Q</th>
                      </tr>
                    </thead>
                    <tbody>
                      {grouped.get(subject)!.map((ch) => {
                        const key = chapterKey(ch.chapter_id, ch.subject, ch.chapter_name);
                        const isChapterOpen = openChapters.has(key);
                        const chapterQuestions = questionsByChapter.get(key);
                        return (
                          <ChapterRowFragment
                            key={key}
                            chapter={ch}
                            isOpen={isChapterOpen}
                            onToggle={() => toggleChapter(ch)}
                            questions={chapterQuestions}
                            loading={questionsLoading}
                            error={questionsError}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ChapterRowFragment({
  chapter,
  isOpen,
  onToggle,
  questions,
  loading,
  error,
}: {
  chapter: ChapterAnalysisRow;
  isOpen: boolean;
  onToggle: () => void;
  questions: TestQuestionLevelRow[] | undefined;
  loading: boolean;
  error: string | null;
}) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={`border-b border-border/25 transition-colors hover:bg-hover-bg cursor-pointer ${scoreColorClass(chapter.avg_score)}`}
      >
        <td className="px-3 py-3 text-xs text-text-muted w-8">{isOpen ? "▼" : "▶"}</td>
        <td className="px-4 py-3 text-sm text-text-primary">{chapter.chapter_name}</td>
        <td className="px-4 py-3 text-sm"><PriorityBadge priority={chapter.priority} /></td>
        <td className="px-4 py-3 text-sm font-bold font-mono text-accent">{chapter.avg_score}%</td>
        <td className="px-4 py-3 text-sm font-mono text-text-primary">{chapter.accuracy}%</td>
        <td className="px-4 py-3 text-sm font-mono text-text-primary">{chapter.attempt_rate}%</td>
        <td className="px-4 py-3 text-sm font-bold font-mono text-text-primary">{chapter.questions}</td>
        <td className="px-4 py-3 text-sm font-mono text-text-primary">
          {chapter.avg_time != null ? `${chapter.avg_time}s` : "-"}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-bg-card-alt/40">
          <td></td>
          <td colSpan={7} className="px-4 py-3">
            <QuestionBreakdown
              questions={questions}
              loading={loading}
              error={error}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function QuestionBreakdown({
  questions,
  loading,
  error,
}: {
  questions: TestQuestionLevelRow[] | undefined;
  loading: boolean;
  error: string | null;
}) {
  if (loading && questions === undefined) {
    return <p className="text-xs text-text-muted">Loading questions…</p>;
  }
  if (error) {
    return <p className="text-xs text-danger">{error}</p>;
  }
  if (!questions || questions.length === 0) {
    return <p className="text-xs text-text-muted">No question-level data for this chapter.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border/25">
            <th className={QTH}>Question</th>
            <th className={QTH}>Attempt Rate</th>
            <th className={QTH}>Accuracy</th>
            <th className={QTH}>Correct</th>
            <th className={QTH}>Wrong</th>
            <th className={QTH}>Skipped</th>
          </tr>
        </thead>
        <tbody>
          {questions.map((q, idx) => (
            <tr key={q.question_id} className="border-b border-border/15">
              <td className="px-3 py-2 text-sm font-mono text-text-primary">
                Q{q.position_index ?? idx + 1}
              </td>
              <td className="px-3 py-2 text-sm font-mono text-text-primary">{q.attempt_rate}%</td>
              <td className="px-3 py-2 text-sm font-mono text-text-primary">{q.accuracy}%</td>
              <td className="px-3 py-2 text-sm font-mono text-text-primary">{q.correct}</td>
              <td className="px-3 py-2 text-sm font-mono text-text-primary">{q.wrong}</td>
              <td className="px-3 py-2 text-sm font-mono text-text-primary">{q.skipped}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
