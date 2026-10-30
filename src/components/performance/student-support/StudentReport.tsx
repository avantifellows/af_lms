"use client";

import { useState } from "react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useJsonFetch } from "../chapter-report/useJsonFetch";
import { PerformanceNotice } from "../PerformanceStates";
import PriorityBadge from "../PriorityBadge";
import { FlagChip, LevelChip, ScoreBar, StatusChip } from "./chips";
import { type ChapterSort, focusChapters, sortChapters } from "./report-view";
import { passMark } from "@/lib/student-support-rules";
import type {
  ChapterRow,
  StudentReportData,
  SubjectChapters,
  TestHistoryRow,
  TestScore,
  TopicRow,
} from "@/types/student-support";

interface Props {
  schoolUdise: string;
  grade: number;
  program: string;
  uid: string;
  onBack: () => void;
}

function Section({ title, children, open = false }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border border-border bg-bg-card">
      <summary className="cursor-pointer px-4 py-3 text-sm font-bold uppercase tracking-wide">{title}</summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

function PyqLinks({ links }: { links: string[] }) {
  if (!links.length) return null;
  return (
    <span className="inline-flex gap-2 text-xs">
      {links.map((url, i) => (
        <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
          PYQ{links.length > 1 ? ` ${i + 1}` : ""}
        </a>
      ))}
    </span>
  );
}

function FocusCards({ subject }: { subject: SubjectChapters }) {
  const focus = focusChapters(subject.chapters);
  if (!focus.length) {
    return <p className="text-sm text-text-muted">No High-priority chapters flagged in {subject.subject}.</p>;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {focus.map((c) => (
        <div key={c.key} className="space-y-2 rounded-lg border border-border bg-bg-card p-3">
          <div className="font-semibold">{c.name}</div>
          <div className="text-xs text-text-muted">{c.code ?? ""}</div>
          <div className="flex flex-wrap items-center gap-2">
            <PriorityBadge priority={c.priority} />
            <FlagChip flag={c.flag} />
          </div>
          <ScoreBar value={c.score} pass={subject.passMark} />
          {c.topics.some((t) => t.flag) && (
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {c.topics.filter((t) => t.flag).slice(0, 3).map((t) => <li key={t.code}>{t.name}</li>)}
            </ul>
          )}
          <PyqLinks links={c.pyq} />
        </div>
      ))}
    </div>
  );
}

// One grid for the map's header, chapters and topics, so the priority, score
// and flag columns line up (prototype layout); rows wrap below md.
const MAP_ROW =
  "flex flex-wrap items-center gap-x-3 gap-y-1 md:grid md:grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_11rem_10rem]";

function TopicLine({ t, pass }: { t: TopicRow; pass: number }) {
  return (
    <div className={`${MAP_ROW} border-t border-dashed border-border py-1.5 text-xs`}>
      <span className="min-w-[12rem] flex-1 md:col-start-2 md:col-end-4">{t.name}</span>
      <ScoreBar value={t.score} pass={pass} />
      <span><FlagChip flag={t.flag} /></span>
    </div>
  );
}

/** Flagged topics first; topics on track behind a toggle, as in the prototype. */
function ChapterTopics({ c, pass }: { c: ChapterRow; pass: number }) {
  const [showOk, setShowOk] = useState(false);
  const flagged = c.topics.filter((t) => t.flag);
  const onTrack = c.topics.filter((t) => !t.flag);
  return (
    <div className="pb-2">
      {(showOk ? c.topics : flagged).map((t) => <TopicLine key={t.code} t={t} pass={pass} />)}
      {onTrack.length > 0 && (
        <button type="button" onClick={() => setShowOk(!showOk)} className="mt-1 text-xs text-accent hover:underline md:ml-[5.25rem]">
          {showOk ? "Hide" : "Show"} {onTrack.length} topic{onTrack.length === 1 ? "" : "s"} on track
        </button>
      )}
    </div>
  );
}

function ChapterLine({ c, pass }: { c: ChapterRow; pass: number }) {
  return (
    <details className="group border-t border-border first:border-t-0">
      <summary className={`${MAP_ROW} cursor-pointer list-none py-2 text-sm`}>
        <span className="w-16 text-xs text-text-muted tabular-nums md:w-auto">
          <span className="mr-1 inline-block transition-transform group-open:rotate-90">▸</span>
          {c.code ?? ""}
        </span>
        <span className="min-w-[12rem] flex-1">{c.name}</span>
        <span><PriorityBadge priority={c.priority} /></span>
        <ScoreBar value={c.score} pass={pass} />
        <span><FlagChip flag={c.flag} /></span>
      </summary>
      <div className="pb-1 text-xs text-text-muted tabular-nums md:pl-[5.25rem]">
        {c.n} answers · attempt {c.attempt ?? "—"}% · accuracy {c.accuracy ?? "—"}% · {c.tests} tests
        {c.pyq.length > 0 && <span className="ml-3"><PyqLinks links={c.pyq} /></span>}
      </div>
      <ChapterTopics c={c} pass={pass} />
    </details>
  );
}

function ChapterMap({ subject }: { subject: SubjectChapters }) {
  const [sort, setSort] = useState<ChapterSort>("priority");
  const rows = sortChapters(subject.chapters, sort);
  const flagged = rows.filter((c) => c.flag);
  const onTrack = rows.filter((c) => !c.flag);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-text-muted tabular-nums">
          {subject.answers} answers · attempt {subject.attempt ?? "—"}% · accuracy {subject.accuracy ?? "—"}% · pass mark{" "}
          {subject.passMark}%
        </span>
        <SegmentedControl<ChapterSort>
          label="Sort"
          options={[
            { value: "priority", label: "Priority" },
            { value: "weakest", label: "Weakest" },
            { value: "order", label: "Chapter order" },
          ]}
          value={sort}
          onChange={setSort}
        />
      </div>
      <div className={`${MAP_ROW} hidden border-b border-border pb-1 text-[11px] font-bold uppercase tracking-wide text-text-muted md:grid`}>
        <span />
        <span>Chapter</span>
        <span>Priority</span>
        <span>Score</span>
        <span>Flags</span>
      </div>
      {[
        { title: "Needs work", list: flagged },
        { title: "On track", list: onTrack },
      ].map(({ title, list }) => (
        <div key={title}>
          <h5 className="mb-1 text-xs font-bold uppercase tracking-wide text-text-muted">
            {title} · {list.length}
          </h5>
          {list.map((c) => <ChapterLine key={c.key} c={c} pass={subject.passMark} />)}
        </div>
      ))}
    </div>
  );
}

const fmt = (v: number | null) => (v === null ? "—" : String(v));

function ScoreCells({ s, pass }: { s: TestScore; pass: number }) {
  return (
    <>
      <td className="px-3 py-2">
        <ScoreBar value={s.pct} pass={pass} />
        <span className="ml-2 text-xs text-text-muted tabular-nums">{fmt(s.marks)}/{fmt(s.max)}</span>
      </td>
      <td className="px-3 py-2 tabular-nums">{fmt(s.correct)}</td>
      <td className="px-3 py-2 tabular-nums">{fmt(s.wrong)}{s.partial ? ` (+${s.partial} partial)` : ""}</td>
      <td className="px-3 py-2 tabular-nums">{fmt(s.skipped)}</td>
    </>
  );
}

function TestRow({ t }: { t: TestHistoryRow }) {
  const [open, setOpen] = useState(false);
  const pass = passMark(t.exam ?? "JEE Main", "overall");
  if (t.absent || !t.overall) {
    return (
      <tr className="border-t border-border text-text-muted">
        <td className="px-3 py-2">{t.date} · {t.name}</td>
        <td className="px-3 py-2" colSpan={7}>AB</td>
      </tr>
    );
  }
  return (
    <>
      <tr className="cursor-pointer border-t border-border hover:bg-bg-card-alt/40" onClick={() => setOpen(!open)}>
        <td className="px-3 py-2">
          <span className="mr-1 text-text-muted">{open ? "▾" : "▸"}</span>
          <span className="text-xs text-text-muted tabular-nums">{t.date}</span> · {t.name}
        </td>
        <td className="px-3 py-2"><LevelChip level={t.level} /></td>
        <ScoreCells s={t.overall} pass={pass} />
        <td className={`px-3 py-2 tabular-nums ${t.change !== null && t.change < 0 ? "text-danger" : ""}`}>
          {t.change === null ? "—" : `${t.change > 0 ? "+" : ""}${t.change}`}
        </td>
        <td className="px-3 py-2 tabular-nums">{t.rank !== null ? `${t.rank} / ${t.takers}` : "—"}</td>
      </tr>
      {open &&
        t.subjects.map((s) => (
          <tr key={s.subject} className="bg-bg-card-alt/30 text-xs">
            <td className="px-3 py-1.5 pl-8">{s.subject}</td>
            <td />
            <ScoreCells s={s} pass={passMark(t.exam ?? "JEE Main", s.subject)} />
            <td colSpan={2} />
          </tr>
        ))}
    </>
  );
}

function TestHistory({ tests }: { tests: TestHistoryRow[] }) {
  if (!tests.length) return <p className="text-sm text-text-muted">No full tests yet.</p>;
  const sat = tests.filter((t) => !t.absent && t.overall?.pct != null);
  const avg = sat.length ? Math.round((sat.reduce((a, t) => a + (t.overall?.pct ?? 0), 0) / sat.length) * 10) / 10 : null;
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-muted">
        {sat.length} of {tests.length} tests sat · average {avg ?? "—"}%
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-bg-card-alt text-left text-[11.5px] uppercase tracking-wide text-text-muted">
            <tr>
              {["Test", "Level", "Marks", "Correct", "Incorrect", "Skipped", "Change vs last", "Rank in centre"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tests.map((t) => <TestRow key={t.sessionId} t={t} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function StudentReport({ schoolUdise, grade, program, uid, onBack }: Props) {
  const [exam, setExam] = useState<string | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const qs = new URLSearchParams({ grade: String(grade), program, student: uid });
  const state = useJsonFetch<StudentReportData>(
    `/api/quiz-analytics/${schoolUdise}/student-report?${qs}`,
    "Failed to load the student report"
  );

  const back = (
    <button type="button" onClick={onBack} className="text-sm text-accent hover:underline">
      ← Score journey
    </button>
  );
  if (state.status === "loading") return <div className="space-y-2">{back}<PerformanceNotice>Loading the report…</PerformanceNotice></div>;
  if (state.status === "error") return <div className="space-y-2">{back}<PerformanceNotice>{state.message}</PerformanceNotice></div>;

  const { student, chapters, tests } = state.data;
  const examData = chapters.find((e) => e.exam === exam) ?? chapters[0];
  const subjectData = examData?.subjects.find((s) => s.subject === subject) ?? examData?.subjects[0];
  const examTests = examData ? tests.filter((t) => t.exam === examData.exam) : tests;

  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-card p-4">
        <div className="mr-4">
          <div className="text-lg font-bold">{student.name}</div>
          <div className="text-xs text-text-muted">
            {[student.studentId, student.gender, student.category].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className="text-xs text-text-muted">Predicted</span> <LevelChip level={student.predicted} />
        <span className="text-xs text-text-muted">Mode</span> <LevelChip level={student.mode} />
        <StatusChip status={student.status} />
      </div>

      {examData ? (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {chapters.length > 1 && (
              <SegmentedControl
                label="Exam"
                options={chapters.map((e) => ({
                  value: e.exam,
                  label: `${e.exam} (${e.subjects.reduce((n, s) => n + s.chapters.filter((c) => c.flag).length, 0)})`,
                }))}
                value={examData.exam}
                onChange={(v) => { setExam(v); setSubject(null); }}
              />
            )}
            <SegmentedControl
              label="Subject"
              options={examData.subjects.map((s) => ({
                value: s.subject,
                label: `${s.subject} (${s.chapters.filter((c) => c.flag).length})`,
              }))}
              value={subjectData?.subject ?? ""}
              onChange={setSubject}
            />
          </div>
          {subjectData && (
            <>
              <Section title="Focus chapters · self-prep plan" open>
                <FocusCards subject={subjectData} />
              </Section>
              <Section title="Detailed chapter competency map">
                <ChapterMap key={`${examData.exam}|${subjectData.subject}`} subject={subjectData} />
              </Section>
            </>
          )}
        </>
      ) : (
        <PerformanceNotice>No chapter data for this student yet.</PerformanceNotice>
      )}

      <Section title={`Detailed full test scores${examData ? ` · ${examData.exam}` : ""}`}>
        <TestHistory tests={examTests} />
      </Section>
    </div>
  );
}
