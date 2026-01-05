"use client";

import type { Chapter, ChapterProgress } from "@/types/curriculum";
import { calculateStats, formatDuration } from "@/lib/curriculum-helpers";

interface ProgressSummaryProps {
  chapters: Chapter[];
  progress: Record<number, ChapterProgress>;
}

export default function ProgressSummary({
  chapters,
  progress,
}: ProgressSummaryProps) {
  const stats = calculateStats(chapters, progress);

  return (
    <div className="bg-white rounded-lg shadow p-4 mb-6">
      <div className="grid grid-cols-3 gap-4">
        {/* Chapters Completed */}
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">
            {stats.chaptersCompleted}
            <span className="text-gray-400 text-lg font-normal">
              /{stats.totalChapters}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">chapters completed</div>
        </div>

        {/* Topics Covered */}
        <div className="text-center border-l border-r border-gray-100">
          <div className="text-2xl font-bold text-gray-900">
            {stats.topicsCovered}
            <span className="text-gray-400 text-lg font-normal">
              /{stats.totalTopics}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1">topics covered</div>
        </div>

        {/* Total Time */}
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-900">
            {formatDuration(stats.totalTimeMinutes)}
          </div>
          <div className="text-xs text-gray-500 mt-1">total time taught</div>
        </div>
      </div>
    </div>
  );
}
