"use client";

import type { Chapter, ChapterProgress } from "@/types/curriculum";
import {
  getProgressIndicator,
  getProgressColorClass,
  formatDuration,
  formatDate,
} from "@/lib/curriculum-helpers";
import TopicRow from "./TopicRow";

interface ChapterAccordionProps {
  chapters: Chapter[];
  progress: Record<number, ChapterProgress>;
  expandedChapterIds: number[];
  onToggleChapter: (chapterId: number) => void;
}

export default function ChapterAccordion({
  chapters,
  progress,
  expandedChapterIds,
  onToggleChapter,
}: ChapterAccordionProps) {
  if (chapters.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No chapters found for this grade and subject.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {chapters.map((chapter, index) => {
        const chapterProgress = progress[chapter.id];
        const isExpanded = expandedChapterIds.includes(chapter.id);
        const completedCount = chapterProgress?.completedTopicIds.length || 0;
        const totalCount = chapter.topics.length;
        const indicator = getProgressIndicator(chapterProgress);
        const colorClass = getProgressColorClass(chapterProgress);

        return (
          <div
            key={chapter.id}
            className="bg-white rounded-lg shadow overflow-hidden"
          >
            {/* Chapter Header */}
            <button
              onClick={() => onToggleChapter(chapter.id)}
              className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-50 transition-colors text-left"
            >
              {/* Expand/Collapse Arrow */}
              <span
                className={`text-gray-400 transition-transform ${
                  isExpanded ? "rotate-90" : ""
                }`}
              >
                ▶
              </span>

              {/* Chapter Number and Name */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-gray-900 truncate">
                  {index + 1}. {chapter.name}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Last taught: {formatDate(chapterProgress?.lastTaughtDate || null)}
                  {chapterProgress?.totalTimeMinutes
                    ? ` • Time: ${formatDuration(chapterProgress.totalTimeMinutes)}`
                    : ""}
                </div>
              </div>

              {/* Progress Indicator */}
              <div className="flex items-center gap-2">
                <span className={`text-lg ${colorClass}`}>{indicator}</span>
                <span className="text-sm text-gray-500">
                  {completedCount}/{totalCount}
                </span>
              </div>
            </button>

            {/* Expanded Topics */}
            {isExpanded && (
              <div className="border-t border-gray-100">
                {chapter.topics.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 italic">
                    No topics defined for this chapter
                  </div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {chapter.topics.map((topic) => (
                      <TopicRow
                        key={topic.id}
                        topic={topic}
                        isCompleted={
                          chapterProgress?.completedTopicIds.includes(topic.id) ||
                          false
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
