"use client";

import { Fragment, useState } from "react";
import type { StudentDeepDiveRow } from "@/types/quiz";

interface Props {
  students: StudentDeepDiveRow[];
}

type SortKey = "percentage" | "accuracy" | "attempt_rate" | "student_name" | "marks_scored";
type SortDir = "asc" | "desc";

export default function StudentResultsTable({ students }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("percentage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

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

  const headerClass =
    "px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700";

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-4">
        Student Results ({students.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Rank
              </th>
              <th className={headerClass} onClick={() => handleSort("student_name")}>
                Name{sortIcon("student_name")}
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Gender
              </th>
              <th className={headerClass} onClick={() => handleSort("marks_scored")}>
                Marks{sortIcon("marks_scored")}
              </th>
              <th className={headerClass} onClick={() => handleSort("percentage")}>
                Percentage{sortIcon("percentage")}
              </th>
              <th className={headerClass} onClick={() => handleSort("accuracy")}>
                Accuracy{sortIcon("accuracy")}
              </th>
              <th className={headerClass} onClick={() => handleSort("attempt_rate")}>
                Attempt Rate{sortIcon("attempt_rate")}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.map((s, idx) => {
              const isExpanded = expandedIdx === idx;
              return (
                <Fragment key={idx}>
                  <tr
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedIdx(isExpanded ? null : idx)}
                  >
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {idx + 1}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {s.student_name}
                      {s.subject_scores.length > 0 && (
                        <span className="ml-1 text-gray-400 text-xs">
                          {isExpanded ? "▼" : "▶"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-600">
                      {s.gender || "-"}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {s.marks_scored}/{s.max_marks}
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {Math.round(s.percentage * 10) / 10}%
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {Math.round(s.accuracy * 10) / 10}%
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                      {Math.round(s.attempt_rate * 10) / 10}%
                    </td>
                  </tr>
                  {isExpanded && s.subject_scores.length > 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-2 bg-blue-50">
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-blue-100">
                            <thead>
                              <tr>
                                <th className="px-3 py-1 text-left text-xs font-medium text-blue-600">Subject</th>
                                <th className="px-3 py-1 text-left text-xs font-medium text-blue-600">Marks</th>
                                <th className="px-3 py-1 text-left text-xs font-medium text-blue-600">Percentage</th>
                                <th className="px-3 py-1 text-left text-xs font-medium text-blue-600">Accuracy</th>
                                <th className="px-3 py-1 text-left text-xs font-medium text-blue-600">Attempt Rate</th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.subject_scores.map((ss) => (
                                <tr key={ss.subject}>
                                  <td className="px-3 py-1 text-xs text-gray-900">{ss.subject}</td>
                                  <td className="px-3 py-1 text-xs text-gray-900">
                                    {ss.marks_scored}/{ss.max_marks}
                                  </td>
                                  <td className="px-3 py-1 text-xs text-gray-900">
                                    {Math.round(ss.percentage * 10) / 10}%
                                  </td>
                                  <td className="px-3 py-1 text-xs text-gray-900">
                                    {Math.round(ss.accuracy * 10) / 10}%
                                  </td>
                                  <td className="px-3 py-1 text-xs text-gray-900">
                                    {Math.round(ss.attempt_rate * 10) / 10}%
                                  </td>
                                </tr>
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
