"use client";

import type { LmsCurriculumLog } from "@/types/curriculum";
import { formatDuration } from "@/lib/curriculum-helpers";

interface SessionHistoryProps {
  logs: LmsCurriculumLog[];
  canEdit?: boolean;
  onEditLog?: (log: LmsCurriculumLog) => void;
  onDeleteLog?: (log: LmsCurriculumLog) => void;
}

export default function SessionHistory({
  logs,
  canEdit = false,
  onEditLog,
  onDeleteLog,
}: SessionHistoryProps) {
  if (logs.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg shadow-sm p-8 text-center text-gray-500">
        No classes logged yet.
        <br />
        <span className="text-sm">
          Click &quot;+ Log a class&quot; to record your first class.
        </span>
      </div>
    );
  }

  const groupTopicsByChapter = (
    topics: LmsCurriculumLog["topics"]
  ): Record<string, string[]> => {
    const grouped: Record<string, string[]> = {};
    for (const topic of topics) {
      if (!grouped[topic.chapterName]) {
        grouped[topic.chapterName] = [];
      }
      grouped[topic.chapterName].push(topic.topicName);
    }
    return grouped;
  };

  // Format date for display
  const formatSessionDate = (dateStr: string): string => {
    const [year, month, day] = dateStr.split("-").map(Number);
    const date =
      Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
        ? new Date(year, month - 1, day)
        : new Date(dateStr);
    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleDeleteLog = (log: LmsCurriculumLog) => {
    const confirmed = window.confirm(
      "Delete this LMS Curriculum Log? It will be removed from Logs and Progress."
    );
    if (confirmed) {
      onDeleteLog?.(log);
    }
  };

  return (
    <div className="space-y-4">
      {logs.map((log) => {
        const groupedTopics = groupTopicsByChapter(log.topics);

        return (
          <div
            key={log.id}
            data-curriculum-log-row
            className="bg-bg-card border border-border rounded-lg shadow-sm overflow-hidden"
          >
            {/* Session Header */}
            <div className="px-4 py-3 bg-bg-card-alt border-b border-border flex items-center justify-between gap-3">
              <div className="font-medium text-gray-900">
                {formatSessionDate(log.logDate)}
              </div>
              <div className="flex items-center gap-3">
                {!log.isEditable && (
                  <span className="rounded bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                    Historical log
                  </span>
                )}
                <div className="text-sm text-gray-600">
                  Duration: {formatDuration(log.durationMinutes)}
                </div>
                {canEdit && (
                  <>
                    <button
                      type="button"
                      onClick={() => onEditLog?.(log)}
                      disabled={!log.isEditable}
                      className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      Edit log
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLog(log)}
                      className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                    >
                      Delete log
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Topics Covered */}
            <div className="px-4 py-3">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Topics covered
              </div>
              <div className="space-y-2">
                {Object.entries(groupedTopics).map(([chapterName, topicNames]) => (
                  <div key={chapterName}>
                    <div className="text-sm font-medium text-gray-700">
                      {chapterName}
                    </div>
                    <ul className="mt-1 ml-4 text-sm text-gray-600">
                      {topicNames.map((topicName, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-gray-400 mt-0.5">•</span>
                          <span>{topicName}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
