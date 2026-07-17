"use client";

import { Fragment, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import type {
  StudentDeepDiveRow,
  StudentSubjectScore,
  StudentChapterScore,
  StudentQuestionRow,
} from "@/types/quiz";

interface Props {
  students: StudentDeepDiveRow[];
  schoolUdise: string;
  grade: number;
  sessionId: string;
  program?: string;
  stream?: string;
}

type SortKey = "percentage" | "accuracy" | "attempt_rate" | "student_name" | "marks_scored";
type SortDir = "asc" | "desc";
type QStatus = "idle" | "loading" | "loaded" | "error";

const STATUS_LABEL: Record<StudentQuestionRow["status"], string> = {
  correct: "Correct",
  wrong: "Wrong",
  skipped: "Skipped",
};
const STATUS_CLASS: Record<StudentQuestionRow["status"], string> = {
  correct: "text-accent",
  wrong: "text-danger",
  skipped: "text-text-muted",
};

// The questions for a single (student, chapter): match on chapter_id when the
// v2 chapter row carries one, else fall back to a case-insensitive chapter_name
// match (BQ names can lack the "11C3 - " code prefix the v2 row has).
function questionsForChapter(
  ch: StudentChapterScore,
  studentQuestions: StudentQuestionRow[]
): StudentQuestionRow[] {
  const byId = ch.chapter_id
    ? studentQuestions.filter((q) => q.chapter_id === ch.chapter_id)
    : [];
  if (byId.length > 0) return byId;
  const chName = ch.chapter_name.toLowerCase();
  return studentQuestions.filter((q) => {
    const qName = q.chapter_name.toLowerCase();
    return qName === chName || chName.endsWith(qName) || qName.endsWith(chName);
  });
}

function ChapterRow({
  ch,
  studentQuestions,
  qStatus,
}: {
  ch: StudentChapterScore;
  studentQuestions: StudentQuestionRow[] | undefined;
  qStatus: QStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  // Drill-down to questions is only meaningful once the fetch has data.
  const canDrill = qStatus === "loaded";
  const questions = useMemo(
    () =>
      canDrill && studentQuestions
        ? questionsForChapter(ch, studentQuestions).sort(
            (a, b) => (a.position_index ?? 0) - (b.position_index ?? 0)
          )
        : [],
    [canDrill, studentQuestions, ch]
  );
  const showCaret = canDrill && questions.length > 0;

  return (
    <>
      <tr
        className={`bg-bg-card-alt border-b border-border/25 ${showCaret ? "cursor-pointer hover:bg-hover-bg" : ""}`}
        onClick={() => showCaret && setExpanded(!expanded)}
      >
        <td className="px-3 py-1 text-[11px] pl-8 text-text-secondary">
          {ch.chapter_name}
          {showCaret && (
            <span className="ml-1 text-[10px] text-text-muted">
              {expanded ? "▼" : "▶"}
            </span>
          )}
          {qStatus === "loading" && (
            <span className="ml-1 text-[10px] text-text-muted">loading…</span>
          )}
        </td>
        <td className="px-3 py-1 text-[11px] font-mono text-text-secondary">
          {ch.marks_scored}/{ch.max_marks}
        </td>
        <td className="px-3 py-1 text-[11px] font-mono text-text-secondary">
          {ch.max_marks > 0
            ? Math.round((ch.marks_scored / ch.max_marks) * 1000) / 10
            : 0}
          %
        </td>
        <td className="px-3 py-1 text-[11px] font-mono text-text-secondary">
          {Math.round(ch.accuracy * 10) / 10}%
        </td>
        <td className="px-3 py-1 text-[11px] font-mono text-text-secondary">
          {Math.round(ch.attempt_rate * 10) / 10}%
        </td>
      </tr>
      {expanded &&
        questions.map((q) => (
          <tr key={q.question_id} className="bg-bg border-b border-border/15">
            <td className="px-3 py-1 text-[11px] pl-12 font-mono text-text-secondary">
              Q{q.position_index == null ? "?" : q.position_index + 1}
            </td>
            <td
              className={`px-3 py-1 text-[11px] font-semibold ${STATUS_CLASS[q.status]}`}
              colSpan={4}
            >
              {STATUS_LABEL[q.status]}
            </td>
          </tr>
        ))}
    </>
  );
}

function SubjectWithChapters({
  ss,
  studentQuestions,
  qStatus,
}: {
  ss: StudentSubjectScore;
  studentQuestions: StudentQuestionRow[] | undefined;
  qStatus: QStatus;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChapters = ss.chapters && ss.chapters.length > 0;

  return (
    <>
      <tr
        className={`border-b border-border/25 transition-colors hover:bg-hover-bg ${hasChapters ? "cursor-pointer" : ""}`}
        onClick={() => hasChapters && setExpanded(!expanded)}
      >
        <td className="px-3 py-1.5 text-xs text-text-primary">
          {ss.subject}
          {hasChapters && (
            <span className="ml-1 text-[10px] text-text-muted">
              {expanded ? "▼" : "▶"}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 text-xs font-mono text-text-primary">
          {ss.marks_scored}/{ss.max_marks}
        </td>
        <td className="px-3 py-1.5 text-xs font-bold font-mono text-accent">
          {Math.round(ss.percentage * 10) / 10}%
        </td>
        <td className="px-3 py-1.5 text-xs font-mono text-text-primary">
          {Math.round(ss.accuracy * 10) / 10}%
        </td>
        <td className="px-3 py-1.5 text-xs font-mono text-text-primary">
          {Math.round(ss.attempt_rate * 10) / 10}%
        </td>
      </tr>
      {expanded &&
        ss.chapters!.map((ch) => (
          <ChapterRow
            key={`${ss.subject}-${ch.chapter_id ?? ch.chapter_name}`}
            ch={ch}
            studentQuestions={studentQuestions}
            qStatus={qStatus}
          />
        ))}
    </>
  );
}

const TH = "px-4 py-3 text-left text-xs uppercase tracking-wider font-bold bg-bg-card-alt text-text-muted";
const SORTABLE_TH = `${TH} cursor-pointer hover:text-text-primary`;

export default function StudentResultsTable({
  students,
  schoolUdise,
  grade,
  sessionId,
  program,
  stream,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("percentage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedName, setExpandedName] = useState<string | null>(null);

  // Per-student question rows for the whole test, fetched once on first
  // drill-in (the table is clustered such that one all-students query is far
  // cheaper than one query per student), then filtered client-side.
  const [qStatus, setQStatus] = useState<QStatus>("idle");
  const [allQuestions, setAllQuestions] = useState<StudentQuestionRow[]>([]);
  const [qError, setQError] = useState<string | null>(null);

  const fetchQuestions = () => {
    if (qStatus !== "idle") return;
    setQStatus("loading");
    const programParam = program ? `&program=${encodeURIComponent(program)}` : "";
    const streamParam = stream ? `&stream=${encodeURIComponent(stream)}` : "";
    fetch(
      `/api/quiz-analytics/${schoolUdise}/student-questions?grade=${grade}&sessionId=${encodeURIComponent(sessionId)}${programParam}${streamParam}`
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Failed to fetch question detail");
        }
        return res.json();
      })
      .then((d: { questions: StudentQuestionRow[] }) => {
        setAllQuestions(d.questions || []);
        setQStatus("loaded");
      })
      .catch((err) => {
        setQError(err.message);
        setQStatus("error");
      });
  };

  const questionsByStudent = useMemo(() => {
    const map = new Map<string, StudentQuestionRow[]>();
    for (const q of allQuestions) {
      const list = map.get(q.enrollment_user_id) || [];
      list.push(q);
      map.set(q.enrollment_user_id, list);
    }
    return map;
  }, [allQuestions]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "student_name" ? "asc" : "desc");
    }
  };

  const sorted = [...students].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "student_name") {
      return mul * a.student_name.localeCompare(b.student_name);
    }
    return mul * ((a[sortKey] ?? 0) - (b[sortKey] ?? 0));
  });

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  const toggleStudent = (name: string) => {
    const next = expandedName === name ? null : name;
    setExpandedName(next);
    // First drill-in triggers the one-time question fetch.
    if (next) fetchQuestions();
  };

  return (
    <Card elevation="sm" className="overflow-hidden">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between border-b-2 border-border-accent">
        <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
          Student Results
        </h3>
        <span className="text-xs md:text-sm font-mono text-text-muted">
          {students.length} students
        </span>
      </div>

      {qStatus === "error" && qError && (
        <div className="px-4 md:px-6 py-2 text-xs text-danger bg-danger-bg border-b border-danger">
          Couldn&apos;t load question detail: {qError}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-border-accent">
              <th className={TH}>Rank</th>
              <th className={SORTABLE_TH} onClick={() => handleSort("student_name")}>
                Name{sortIcon("student_name")}
              </th>
              <th className={TH}>Gender</th>
              <th className={SORTABLE_TH} onClick={() => handleSort("marks_scored")}>
                Marks{sortIcon("marks_scored")}
              </th>
              <th className={SORTABLE_TH} onClick={() => handleSort("percentage")}>
                Percentage{sortIcon("percentage")}
              </th>
              <th className={SORTABLE_TH} onClick={() => handleSort("accuracy")}>
                Accuracy{sortIcon("accuracy")}
              </th>
              <th className={SORTABLE_TH} onClick={() => handleSort("attempt_rate")}>
                Attempt Rate{sortIcon("attempt_rate")}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, idx) => {
              const isExpanded = expandedName === s.student_name;
              return (
                <Fragment key={s.student_name}>
                  <tr
                    className="border-b border-border/25 cursor-pointer transition-colors hover:bg-hover-bg"
                    onClick={() => toggleStudent(s.student_name)}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold text-accent">
                      {String(idx + 1).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-semibold text-text-primary">
                      {s.student_name}
                      {s.subject_scores.length > 0 && (
                        <span className="ml-1 text-xs text-text-muted">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-text-secondary">
                      {s.gender || "-"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-text-primary">
                      {s.marks_scored}/{s.max_marks}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-bold font-mono text-accent">
                      {Math.round(s.percentage * 10) / 10}%
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-text-primary">
                      {Math.round(s.accuracy * 10) / 10}%
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-text-primary">
                      {Math.round(s.attempt_rate * 10) / 10}%
                    </td>
                  </tr>
                  {isExpanded && s.subject_scores.length > 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-2 bg-bg">
                        <div className="overflow-x-auto">
                          <table className="w-full">
                            <thead>
                              <tr className="border-b border-border">
                                <th className="px-3 py-1 text-left text-xs font-bold uppercase tracking-wider text-accent">
                                  Subject
                                </th>
                                <th className="px-3 py-1 text-left text-xs font-bold uppercase tracking-wider text-accent">
                                  Marks
                                </th>
                                <th className="px-3 py-1 text-left text-xs font-bold uppercase tracking-wider text-accent">
                                  Percentage
                                </th>
                                <th className="px-3 py-1 text-left text-xs font-bold uppercase tracking-wider text-accent">
                                  Accuracy
                                </th>
                                <th className="px-3 py-1 text-left text-xs font-bold uppercase tracking-wider text-accent">
                                  Attempt Rate
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.subject_scores.map((ss) => (
                                <SubjectWithChapters
                                  key={ss.subject}
                                  ss={ss}
                                  studentQuestions={
                                    s.enrollment_user_id
                                      ? questionsByStudent.get(s.enrollment_user_id)
                                      : undefined
                                  }
                                  qStatus={qStatus}
                                />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
