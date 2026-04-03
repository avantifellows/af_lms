"use client";

import { Fragment, useState } from "react";
import type { StudentDeepDiveRow, StudentSubjectScore } from "@/types/quiz";

interface Props {
  students: StudentDeepDiveRow[];
}

type SortKey = "percentage" | "accuracy" | "attempt_rate" | "student_name" | "marks_scored";
type SortDir = "asc" | "desc";

function SubjectWithChapters({ ss }: { ss: StudentSubjectScore }) {
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
          <tr
            key={`${ss.subject}-${ch.chapter_name}`}
            className="bg-bg-card-alt border-b border-border/25"
          >
            <td className="px-3 py-1 text-[11px] pl-8 text-text-secondary">
              {ch.chapter_name}
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
        ))}
    </>
  );
}

const TH = "px-4 py-3 text-left text-xs uppercase tracking-wider font-bold bg-bg-card-alt text-text-muted";
const SORTABLE_TH = `${TH} cursor-pointer hover:text-text-primary`;

export default function StudentResultsTable({ students }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("percentage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedName, setExpandedName] = useState<string | null>(null);

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

  return (
    <div className="bg-bg-card border border-border">
      <div className="px-4 md:px-6 py-3 md:py-4 flex items-center justify-between border-b-2 border-border-accent">
        <h3 className="font-bold uppercase tracking-wide text-sm md:text-base text-text-primary">
          Student Results
        </h3>
        <span className="text-xs md:text-sm font-mono text-text-muted">
          {students.length} students
        </span>
      </div>

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
                    onClick={() => setExpandedName(isExpanded ? null : s.student_name)}
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
                                <SubjectWithChapters key={ss.subject} ss={ss} />
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
    </div>
  );
}
