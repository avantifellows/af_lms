"use client";

import { useState } from "react";
import { SectionCard } from "@/components/ui/SectionCard";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  DIFFICULTY_ORDER,
  byDifficulty,
  byTopic,
  pct,
  questionLabel,
  rankGroups,
  rankQuestions,
  type InsightKind,
} from "@/lib/question-aggregates";
import type { QuestionGroupStat, QuestionStat } from "@/types/question-analytics";
import QuestionTable, {
  DifficultyLabel,
  countWithPct,
  formatMinutes,
  type QuestionColumn,
} from "./QuestionTable";

const KINDS: { kind: InsightKind; title: string }[] = [
  { kind: "skipped", title: "Most skipped" },
  { kind: "incorrect", title: "Most incorrect" },
  { kind: "correct", title: "Most correct" },
];

// An easy question this many students skip, or this few get right, is flagged:
// its difficulty label doesn't match how the class treated it.
const EASY_SKIP_FLAG = 50;
const EASY_ACCURACY_FLAG = 40;

// Difficulty levels arrive lower-case; topics keep their own case.
function groupLabel(label: string): string {
  return (DIFFICULTY_ORDER as readonly string[]).includes(label)
    ? `${label[0].toUpperCase()}${label.slice(1)}`
    : label;
}

const round = (v: number | null) => Math.round(v ?? 0);
const valueOf = (g: QuestionGroupStat, kind: InsightKind) =>
  kind === "skipped" ? round(g.skip_pct) : round(g.accuracy_pct);

/** A sentence as text runs; topic and difficulty names and their percentages are bold. */
export type Segment = { text: string; bold?: boolean };
const b = (text: string): Segment => ({ text, bold: true });
const t = (text: string): Segment => ({ text });

export function segmentsText(segments: Segment[]): string {
  return segments.map((s) => s.text).join("");
}

/** "A (78%) and B (73%)", or "A and B (31% each)" when they share a value. */
function namePair(groups: QuestionGroupStat[], kind: InsightKind): Segment[] {
  const [x, y] = groups;
  const value = (g: QuestionGroupStat) => b(`${valueOf(g, kind)}%`);
  if (!y) return [b(groupLabel(x.label)), t(" ("), value(x), t(")")];
  if (valueOf(x, kind) === valueOf(y, kind)) {
    return [b(groupLabel(x.label)), t(" and "), b(groupLabel(y.label)), t(" ("), value(x), t(" each)")];
  }
  return [
    b(groupLabel(x.label)), t(" ("), value(x), t(") and "),
    b(groupLabel(y.label)), t(" ("), value(y), t(")"),
  ];
}

/** The topic sentence for one insight: the top two topics, and for skipping also the bottom two. */
export function topicSentence(topics: QuestionGroupStat[], kind: InsightKind): Segment[] | null {
  const ranked = rankGroups(topics, kind);
  if (ranked.length === 0) return null;
  const top = ranked.slice(0, 2);
  if (kind === "skipped") {
    const least = ranked.slice(Math.max(2, ranked.length - 2)).reverse();
    return [
      t("By topic, "), ...namePair(top, kind), t(` ${top.length > 1 ? "were" : "was"} skipped the most`),
      ...(least.length > 0 ? [t("; "), ...namePair(least, kind), t(" the least")] : []),
      t("."),
    ];
  }
  const which = kind === "incorrect" ? "lowest" : "highest";
  return [t("By topic, "), ...namePair(top, kind), t(` had the ${which} accuracy.`)];
}

/** The difficulty sentence: every level's percentage, easy to hard. */
export function difficultySentence(levels: QuestionGroupStat[], kind: InsightKind): Segment[] | null {
  const shown = kind === "skipped" ? levels : levels.filter((g) => g.accuracy_pct != null);
  if (shown.length === 0) return null;
  const list = shown.flatMap((g, i) => [
    ...(i > 0 ? [t(", ")] : []),
    b(groupLabel(g.label)), t(" "), b(`${valueOf(g, kind)}%`),
  ]);
  if (kind === "skipped") return [t("By difficulty: "), ...list, t(" skipped.")];
  const [pick] = rankGroups(shown, kind);
  const which = kind === "incorrect" ? "lowest" : "highest";
  return shown.length > 1
    ? [t("By difficulty, "), b(groupLabel(pick.label)), t(` had the ${which} accuracy: `), ...list, t(".")]
    : [t("By difficulty, accuracy: "), ...list, t(".")];
}

function Sentence({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-bold text-text-primary">
            {s.text}
          </strong>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** Most skipped / incorrect / correct, by topic and by difficulty, as short sentences. */
export function InsightsSection({ questions }: { questions: QuestionStat[] }) {
  const topics = byTopic(questions);
  const difficulties = byDifficulty(questions);
  const flagged = questions
    .map((q, i) => ({ q, i }))
    .filter(
      ({ q }) =>
        q.difficulty === "easy" &&
        q.responses > 0 &&
        (pct(q.skipped, q.responses) >= EASY_SKIP_FLAG ||
          (q.attempted > 0 && pct(q.correct, q.attempted) < EASY_ACCURACY_FLAG)),
    );

  return (
    <SectionCard title="Insights">
      <p className="text-xs text-text-muted mb-3">
        Skipped is the share of answers left blank; accuracy is the share of attempted answers that were correct.
      </p>
      <div className="divide-y divide-border">
        {KINDS.map(({ kind, title }) => {
          const lines = [
            topicSentence(topics, kind) ?? [t("By topic: questions are not tagged with topics.")],
            difficultySentence(difficulties, kind),
          ].filter((l): l is Segment[] => l != null);
          return (
            <div key={kind} className="py-3 first:pt-0 last:pb-0">
              <h4 className="text-xs font-bold uppercase tracking-wide text-accent">{title}</h4>
              <ul className="mt-2 space-y-1 list-disc pl-5 text-sm text-text-secondary">
                {lines.map((line) => (
                  <li key={segmentsText(line)}>
                    <Sentence segments={line} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {flagged.length > 0 && (
        <div className="mt-4 p-3 rounded-lg bg-warning-bg text-sm text-text-primary">
          {flagged.map(({ q, i }) => (
            <p key={q.question_id}>
              {questionLabel(q, i)} is labelled Easy, but {Math.round(pct(q.skipped, q.responses))}% skipped it
              {q.attempted > 0 && ` and ${Math.round(pct(q.correct, q.attempted))}% of those who tried got it right`}.
            </p>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

interface TableProps {
  questions: QuestionStat[];
  schoolUdise: string;
  sessionQuery: string | null;
}

/** Per-question results, one tab per difficulty, in test order. */
export function QuestionBreakdownSection({ questions, schoolUdise, sessionQuery }: TableProps) {
  const present = DIFFICULTY_ORDER.filter((d) => questions.some((q) => q.difficulty === d));
  const untagged = questions.some((q) => !q.difficulty);
  const tabs: string[] = [...present, ...(untagged ? ["untagged"] : [])];
  const [tab, setTab] = useState<string>(tabs[0] ?? "untagged");
  const shown = questions.filter((q) => (tab === "untagged" ? !q.difficulty : q.difficulty === tab));

  const columns: QuestionColumn[] = [
    { header: "Skipped", cell: (q) => countWithPct(q.skipped, q.responses) },
    { header: "Incorrect", cell: (q) => countWithPct(q.incorrect, q.responses) },
    { header: "Correct", cell: (q) => countWithPct(q.correct, q.responses) },
    { header: "Avg Time", cell: (q) => formatMinutes(q.avg_time_seconds) },
  ];

  return (
    <SectionCard title="Question Breakdown" subtitle="Tap a question to see it, its answer and its topic.">
      {tabs.length > 1 && (
        <SegmentedControl
          label="Difficulty"
          className="mb-4"
          options={tabs.map((d) => ({
            value: d,
            label: `${d[0].toUpperCase()}${d.slice(1)} (${questions.filter((q) => (d === "untagged" ? !q.difficulty : q.difficulty === d)).length})`,
          }))}
          value={tab}
          onChange={setTab}
        />
      )}
      <QuestionTable questions={shown} columns={columns} schoolUdise={schoolUdise} sessionQuery={sessionQuery} />
    </SectionCard>
  );
}

const RANKING_LIMIT = 5;

/** The questions most skipped, most often wrong and most often right. */
export function QuestionRankingsSection({ questions, schoolUdise, sessionQuery }: TableProps) {
  const [kind, setKind] = useState<InsightKind>("skipped");
  const [showAll, setShowAll] = useState(false);
  const ranked = rankQuestions(questions, kind);
  const shown = showAll ? ranked : ranked.slice(0, RANKING_LIMIT);

  const difficulty: QuestionColumn = { header: "Difficulty", cell: (q) => <DifficultyLabel difficulty={q.difficulty} /> };
  const time: QuestionColumn = { header: "Avg Time", cell: (q) => formatMinutes(q.avg_time_seconds) };
  const columns: QuestionColumn[] =
    kind === "skipped"
      ? [
          difficulty,
          { header: "Skipped", cell: (q) => countWithPct(q.skipped, q.responses) },
          time,
        ]
      : [
          difficulty,
          {
            header: kind === "incorrect" ? "Wrong" : "Correct",
            cell: (q) => (kind === "incorrect" ? q.incorrect : q.correct),
          },
          { header: "Attempted", cell: (q) => q.attempted },
          {
            header: "% of attempted",
            cell: (q) =>
              q.attempted > 0
                ? `${Math.round(pct(kind === "incorrect" ? q.incorrect : q.correct, q.attempted))}%`
                : "—",
          },
          time,
        ];

  return (
    <SectionCard title="Question Rankings">
      <SegmentedControl
        label="Rank by"
        className="mb-4"
        options={KINDS.map(({ kind: k, title }) => ({ value: k, label: title }))}
        value={kind}
        onChange={(k) => setKind(k)}
      />
      <QuestionTable questions={shown} columns={columns} schoolUdise={schoolUdise} sessionQuery={sessionQuery} />
      {ranked.length > RANKING_LIMIT && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-xs font-bold uppercase tracking-wide text-accent hover:text-accent-hover min-h-[44px]"
        >
          {showAll ? `Show top ${RANKING_LIMIT}` : `Show all ${ranked.length}`}
        </button>
      )}
    </SectionCard>
  );
}
