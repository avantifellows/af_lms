"use client";

import type { TeachingSession } from "@/types/curriculum";
import { formatDuration } from "@/lib/curriculum-helpers";

interface SessionHistoryProps {
  sessions: TeachingSession[];
}

export default function SessionHistory({ sessions }: SessionHistoryProps) {
  if (sessions.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No teaching sessions logged yet.
        <br />
        <span className="text-sm">
          Click &quot;+ Log Session&quot; to record your first session.
        </span>
      </div>
    );
  }

  // Group topics by chapter for each session
  const groupTopicsByChapter = (
    topics: TeachingSession["topics"]
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
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <div className="space-y-4">
      {sessions.map((session) => {
        const groupedTopics = groupTopicsByChapter(session.topics);

        return (
          <div
            key={session.id}
            className="bg-white rounded-lg shadow overflow-hidden"
          >
            {/* Session Header */}
            <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
              <div className="font-medium text-gray-900">
                {formatSessionDate(session.date)}
              </div>
              <div className="text-sm text-gray-600">
                Duration: {formatDuration(session.durationMinutes)}
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
