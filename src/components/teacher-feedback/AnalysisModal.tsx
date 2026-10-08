"use client";

import { useEffect, useState } from "react";
import { Modal, SectionCard } from "@/components/ui";
import { formatDateTime, formatPct, istMonth, parseDbTime } from "./format";

interface QuestionScore {
  questionTag: string;
  text: string;
  percentage: number;
  answeredBy: number;
  options: string[];
  optionCounts: number[];
}

interface ParameterScore {
  parameter: string;
  percentage: number;
  answeredBy: number;
  questions: QuestionScore[];
}

interface ScoreSummary {
  responseCount: number;
  percentage: number;
  parameters: { parameter: string; percentage: number; answeredBy: number }[];
}

interface HistoryEntry extends ScoreSummary {
  quizId: string;
  cycleLabel: string;
  startTime: string | null;
  batchNames: string[];
}

export interface ReportData {
  teacherName: string;
  responseCount: number;
  percentage: number;
  parameters: ParameterScore[];
  comments: { role: "liked" | "improve"; text: string }[];
  nothingCounts: { liked: number; improve: number };
  byGender: { female?: ScoreSummary; male?: ScoreSummary };
  round: {
    cycleLabel: string;
    centreName: string | null;
    batchNames: string[];
    startTime: string | null;
    endTime: string | null;
  } | null;
  history: HistoryEntry[];
  summary: FeedbackSummary | null;
  summaryGeneratedAt: string | null;
  roundClosed: boolean;
}

interface Theme {
  text: string;
  students: number;
  serious?: boolean;
  recurring?: boolean;
}

/** The comments grouped into themes; written daily by etl-next once a round has closed. */
interface FeedbackSummary {
  liked: Theme[];
  improve: Theme[];
}

type View = "all" | "gender";

const batchKey = (names: string[]) => names.join(", ");

/** "2026-09", from the round's start (IST) or, failing that, its "Sep 2026" label. */
function monthKey(h: { startTime: string | null; cycleLabel: string }): string {
  const start = parseDbTime(h.startTime);
  if (start) return istMonth(start);
  const fromLabel = new Date(`1 ${h.cycleLabel}`);
  return Number.isNaN(fromLabel.getTime()) ? h.cycleLabel : istMonth(fromLabel);
}

const sharesBatch = (a: HistoryEntry, b: HistoryEntry) => a.batchNames.some((n) => b.batchNames.includes(n));

/**
 * This round's batches over time: earlier rounds that share a batch with it, up
 * to and including its month. Other batches the teacher teaches belong to a
 * teacher-level view, and a later month never shows in an earlier round. PMs
 * regroup batches between months (all four, then pairs), so "shares a batch"
 * rather than "same batches".
 */
export function batchHistory(history: HistoryEntry[], quizId: string): HistoryEntry[] {
  const current = history.find((h) => h.quizId === quizId);
  if (!current) return [];
  const month = monthKey(current);
  return history.filter((h) => monthKey(h) <= month && sharesBatch(h, current));
}

/** The latest earlier round sharing a batch with this one, for "vs last time". */
export function previousRound(history: HistoryEntry[], quizId: string): HistoryEntry | null {
  const index = history.findIndex((h) => h.quizId === quizId);
  if (index <= 0) return null;
  const current = history[index];
  return history.slice(0, index).reverse().find((h) => sharesBatch(h, current)) ?? null;
}

function useReport(quizId: string) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/teacher-feedback/report?quiz_id=${encodeURIComponent(quizId)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Failed to load report");
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load report");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [quizId]);

  return { data, error, loading: !data && !error };
}

function Bar({ value, thin = false }: { value: number; thin?: boolean }) {
  return (
    <div className={`w-full rounded-full bg-bg-card-alt ${thin ? "h-1.5" : "h-3"}`}>
      <div
        className={`rounded-full ${thin ? "h-1.5" : "h-3"} ${value < 70 ? "bg-danger" : "bg-accent"}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

function Delta({ now, before, label }: { now: number; before: number; label: string }) {
  const diff = Math.round(now - before);
  if (diff === 0) return <span className="text-sm text-text-muted">same as {label}</span>;
  return (
    <span className={`text-sm font-medium ${diff > 0 ? "text-success" : "text-danger"}`}>
      {diff > 0 ? "▲" : "▼"} {Math.abs(diff)} vs {label}
    </span>
  );
}

const OPTION_TONES = ["bg-success", "bg-warning-text", "bg-danger"];

/** How the students split across the options, best first, as one stacked bar. */
function SplitBar({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-bg-card">
      {counts.map((n, i) => (
        <div key={i} className={OPTION_TONES[i] ?? "bg-text-muted"} style={{ width: `${(n / total) * 100}%` }} />
      ))}
    </div>
  );
}

function OptionSplit({ question }: { question: QuestionScore }) {
  const total = question.optionCounts.reduce((a, b) => a + b, 0);
  const tones = OPTION_TONES;
  return (
    <div className="mt-2 space-y-1">
      <SplitBar counts={question.optionCounts} />
      {question.options.map((option, i) => (
        <div key={option} className="flex items-center gap-3 text-sm">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tones[i] ?? "bg-text-muted"}`} />
          <span className="flex-1 text-text-secondary">{option}</span>
          <span className="w-16 shrink-0 text-right font-medium text-text-primary">
            {question.optionCounts[i]}
            <span className="text-text-muted"> / {total}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function QuestionRow({ question }: { question: QuestionScore }) {
  return (
    <li className="py-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-base font-medium text-text-primary">{question.questionTag}</div>
          <div className="text-sm text-text-secondary">{question.text}</div>
        </div>
        <div className="shrink-0 text-right text-base font-semibold text-text-primary">
          {question.answeredBy > 0 ? formatPct(question.percentage) : "–"}
        </div>
      </div>
      <OptionSplit question={question} />
    </li>
  );
}

function ParameterRow({
  parameter,
  view,
  byGender,
}: {
  parameter: ParameterScore;
  view: View;
  byGender: ReportData["byGender"];
}) {
  const [open, setOpen] = useState(false);
  const rated = parameter.answeredBy > 0;
  const genderPct = (g: "female" | "male") =>
    byGender[g]?.parameters.find((p) => p.parameter === parameter.parameter)?.percentage ?? 0;

  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="grid w-full grid-cols-[1fr_3.5rem] items-center gap-x-4 gap-y-2 py-3 text-left hover:bg-hover-bg sm:grid-cols-[minmax(9rem,14rem)_1fr_3.5rem]"
      >
        <span className="flex items-center gap-2 text-base font-medium text-text-primary">
          <span className="text-text-muted">{open ? "▾" : "▸"}</span>
          {parameter.parameter}
        </span>
        {view === "gender" ? (
          <span className="order-last col-span-2 space-y-1.5 sm:order-none sm:col-span-1">
            <span className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="w-10">Girls</span>
              <Bar value={genderPct("female")} thin />
              <span className="w-10 text-right">{formatPct(genderPct("female"))}</span>
            </span>
            <span className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="w-10">Boys</span>
              <Bar value={genderPct("male")} thin />
              <span className="w-10 text-right">{formatPct(genderPct("male"))}</span>
            </span>
          </span>
        ) : (
          <span className="order-last col-span-2 sm:order-none sm:col-span-1">
            <Bar value={rated ? parameter.percentage : 0} />
          </span>
        )}
        <span className="text-right text-lg font-bold text-text-primary">
          {rated ? formatPct(parameter.percentage) : "–"}
        </span>
      </button>
      {open && (
        <ul className="mb-3 divide-y divide-border rounded-lg bg-bg-card-alt px-4">
          {parameter.questions.map((q) => (
            <QuestionRow key={q.text} question={q} />
          ))}
        </ul>
      )}
    </li>
  );
}

function ParameterSection({ data }: { data: ReportData }) {
  const [view, setView] = useState<View>("all");
  const canSplit = Boolean(data.byGender.female && data.byGender.male);
  const tab = (value: View, label: string) => (
    <button
      type="button"
      onClick={() => setView(value)}
      disabled={value === "gender" && !canSplit}
      title={value === "gender" && !canSplit ? "Needs at least 5 girls and 5 boys to respond" : undefined}
      className={`rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-40 ${
        view === value ? "bg-accent text-text-on-accent" : "text-text-secondary hover:bg-hover-bg"
      }`}
    >
      {label}
    </button>
  );

  return (
    <SectionCard title="By parameter" subtitle="Tap a parameter to see its questions">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tab("all", "All students")}
        {tab("gender", "Girls vs boys")}
        {view === "gender" && (
          <span className="text-sm text-text-secondary">
            {data.byGender.female?.responseCount} girls · {data.byGender.male?.responseCount} boys
          </span>
        )}
      </div>
      <ul>
        {data.parameters.map((p) => (
          <ParameterRow key={p.parameter} parameter={p} view={view} byGender={data.byGender} />
        ))}
      </ul>
    </SectionCard>
  );
}

/** Batches down, months across: each cell is one round's overall score. */
function MonthTrend({ history, currentQuizId }: { history: HistoryEntry[]; currentQuizId: string }) {
  const months = [...new Set(history.map((h) => h.cycleLabel))];
  const rows = new Map<string, Map<string, HistoryEntry>>();
  for (const h of history) {
    const key = batchKey(h.batchNames);
    if (!rows.has(key)) rows.set(key, new Map());
    rows.get(key)!.set(h.cycleLabel, h); // a repeated round in a month: the later one wins
  }

  return (
    <SectionCard title="Over time" subtitle="This teacher's overall score for these batches, up to this round">
      <div className="overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="text-left text-sm text-text-secondary">
              <th className="py-2 pr-4 font-medium">Batch</th>
              {months.map((m) => (
                <th key={m} className="px-3 py-2 text-right font-medium">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows].map(([batch, byMonth]) => (
              <tr key={batch} className="border-t border-border">
                <td className="py-2 pr-4 text-text-primary">{batch}</td>
                {months.map((m) => {
                  const h = byMonth.get(m);
                  return (
                    <td
                      key={m}
                      className={`px-3 py-2 text-right ${h?.quizId === currentQuizId ? "font-bold text-accent" : "text-text-primary"}`}
                    >
                      {h ? formatPct(h.percentage) : "–"}
                      {h && <span className="block text-xs font-normal text-text-muted">{h.responseCount} resp.</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

function ThemeList({ themes }: { themes: Theme[] }) {
  if (themes.length === 0) return <p className="text-base text-text-muted">No common themes.</p>;
  return (
    <ul className="space-y-2 text-base text-text-primary">
      {themes.map((t) => (
        <li key={t.text} className="flex gap-2">
          <span className={t.serious ? "text-danger" : "text-text-muted"}>{t.serious ? "⚑" : "•"}</span>
          <span>
            {t.text}
            {t.students > 0 && (
              <span className="text-text-muted">
                {" "}· {t.students} student{t.students === 1 ? "" : "s"}
              </span>
            )}
            {t.recurring && (
              <span className="ml-2 rounded-full bg-warning-bg px-2 py-0.5 text-xs font-medium text-warning-text">
                Also last time
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * One open question: its themes once summarised, with the raw comments a click
 * away; before that, the raw comments.
 */
function Comments({ title, items, nothingCount, themes }: {
  title: string;
  items: string[];
  nothingCount: number;
  themes: Theme[] | null;
}) {
  const [showAll, setShowAll] = useState(false);
  const raw = (
    <ul className="list-disc space-y-2 pl-5 text-base text-text-primary">
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  );
  return (
    <SectionCard title={title}>
      {themes && <ThemeList themes={themes} />}
      {themes && items.length > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium text-accent hover:underline"
        >
          {showAll ? "Hide comments" : `Show all ${items.length} comments`}
        </button>
      )}
      {(!themes || showAll) && (
        <div className={themes ? "mt-3 border-t border-border pt-3" : ""}>
          {nothingCount > 0 && (
            <p className="mb-3 text-sm text-text-secondary">
              {nothingCount} student{nothingCount === 1 ? "" : "s"} wrote “nothing” or similar.
            </p>
          )}
          {items.length === 0 ? <p className="text-base text-text-muted">No comments.</p> : raw}
        </div>
      )}
    </SectionCard>
  );
}

function CommentsSection({ data }: { data: ReportData }) {
  const { summary } = data;
  const note = data.roundClosed
    ? "The comments are summarised daily after a round closes."
    : "The comments will be summarised after this round closes.";
  return (
    <div className="space-y-2">
      {!summary && <p className="text-sm text-text-secondary">{note}</p>}
      <div className="grid gap-5 md:grid-cols-2">
        <Comments
          title="What students liked"
          items={data.comments.filter((c) => c.role === "liked").map((c) => c.text)}
          nothingCount={data.nothingCounts.liked}
          themes={summary?.liked ?? null}
        />
        <Comments
          title="What could improve"
          items={data.comments.filter((c) => c.role === "improve").map((c) => c.text)}
          nothingCount={data.nothingCounts.improve}
          themes={summary?.improve ?? null}
        />
      </div>
    </div>
  );
}

function Report({ data, quizId }: { data: ReportData; quizId: string }) {
  const previous = previousRound(data.history, quizId);
  const history = batchHistory(data.history, quizId);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="text-4xl font-bold text-text-primary sm:text-5xl">{formatPct(data.percentage)}</div>
        <div className="text-base text-text-secondary">
          overall · {data.responseCount} response{data.responseCount === 1 ? "" : "s"}
        </div>
        {previous && <Delta now={data.percentage} before={previous.percentage} label={previous.cycleLabel} />}
      </div>
      <ParameterSection data={data} />
      {history.length > 1 && <MonthTrend history={history} currentQuizId={quizId} />}
      <CommentsSection data={data} />
    </div>
  );
}

export default function AnalysisModal({
  quizId,
  teacherName,
  onClose,
}: {
  quizId: string;
  teacherName: string;
  onClose: () => void;
}) {
  const { data, error, loading } = useReport(quizId);
  const round = data?.round;

  return (
    <Modal open onClose={onClose} className="flex max-h-[94vh] max-w-4xl flex-col border border-border">
      <div className="flex items-start justify-between gap-4 border-b-4 border-border-accent px-4 py-4 sm:px-6 sm:py-5">
        <div>
          <h2 className="text-xl font-bold text-text-primary sm:text-2xl">{teacherName}</h2>
          {round && (
            <>
              <div className="mt-1 text-base text-text-primary">
                {round.cycleLabel} · {round.batchNames.join(", ")}
              </div>
              <div className="text-sm text-text-secondary">
                {round.centreName ? `${round.centreName} · ` : ""}
                {formatDateTime(round.startTime)} → {formatDateTime(round.endTime)}
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} className="text-xl text-text-secondary hover:text-text-primary" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        {loading ? (
          <p className="text-base text-text-secondary">Loading analysis…</p>
        ) : error ? (
          <p className="text-base text-danger">{error}</p>
        ) : !data || data.responseCount === 0 ? (
          <p className="text-base text-text-secondary">No student responses yet for this teacher.</p>
        ) : (
          <Report data={data} quizId={quizId} />
        )}
      </div>
    </Modal>
  );
}
