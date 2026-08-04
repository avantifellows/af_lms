"use client";

import type { Chapter, ChapterProgress } from "@/types/curriculum";
import {
  getChapterStatus,
  formatDuration,
  formatDate,
} from "@/lib/curriculum-helpers";
import TopicRow from "./TopicRow";

interface ChapterAccordionProps {
  chapters: Chapter[];
  progress: Record<number, ChapterProgress>;
  expandedChapterIds: number[];
  onToggleChapter: (chapterId: number) => void;
  canEdit?: boolean;
  onToggleChapterCompletion?: (chapterId: number, completed: boolean) => void;
  updatingChapterId?: number | null;
}

// status key -> pill and meter-fill colors (AF brand tokens). Status shows via
// the pill + meter; cards use the neutral enrollment-style border, and turn
// brown only when expanded.
const STATUS_STYLES: Record<
  "complete" | "progress" | "none",
  { pill: string; dot: string; bar: string }
> = {
  complete: {
    pill: "bg-success-bg text-success",
    dot: "bg-success",
    bar: "bg-success",
  },
  progress: {
    pill: "bg-warning-bg text-warning-text",
    dot: "bg-warning-border",
    bar: "bg-warning-border",
  },
  none: {
    pill: "bg-gray-100 text-gray-500",
    dot: "bg-gray-400",
    bar: "bg-gray-200",
  },
};

export default function ChapterAccordion({
  chapters,
  progress,
  expandedChapterIds,
  onToggleChapter,
  canEdit = false,
  onToggleChapterCompletion,
  updatingChapterId = null,
}: ChapterAccordionProps) {
  if (chapters.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-lg shadow-sm p-8 text-center text-gray-500">
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
        const isChapterComplete = chapterProgress?.isChapterComplete || false;
        const isUpdatingCompletion = updatingChapterId === chapter.id;
        const status = getChapterStatus(chapterProgress);
        const styles = STATUS_STYLES[status.key];
        const percent = isChapterComplete
          ? 100
          : totalCount > 0
            ? Math.round((completedCount / totalCount) * 100)
            : 0;

        return (
          <div
            key={chapter.id}
            data-chapter-row
            className={`bg-bg-card border rounded-lg shadow-sm overflow-hidden ${
              isExpanded ? "border-warning-border" : "border-border"
            } ${isChapterComplete ? "bg-bg-card-alt" : ""}`}
          >
            {/* Chapter Header */}
            <div className="w-full px-4 py-3 flex items-center gap-3">
              <button
                onClick={() => onToggleChapter(chapter.id)}
                className="flex-1 min-w-0 flex items-center gap-3 hover:text-gray-700 transition-colors text-left"
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
                  <div
                    className={`font-medium truncate ${
                      isChapterComplete ? "text-gray-500 line-through" : "text-gray-900"
                    }`}
                  >
                    {index + 1}. {chapter.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    Last taught: {formatDate(chapterProgress?.lastTaughtDate || null)}
                    {chapter.prescribedMinutes != null
                      ? ` • Prescribed: ${formatDuration(chapter.prescribedMinutes)}`
                      : ""}
                    {chapterProgress?.totalTimeMinutes
                      ? ` • Time: ${formatDuration(chapterProgress.totalTimeMinutes)}`
                      : ""}
                  </div>
                </div>
              </button>

              {/* Status pill (read-only) */}
              <span
                className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${styles.pill}`}
              >
                {status.key === "complete" ? (
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <span
                    className={`w-2 h-2 rounded-full ${styles.dot}`}
                    aria-hidden="true"
                  />
                )}
                {status.label}
              </span>

              {canEdit && onToggleChapterCompletion && (
                isChapterComplete ? (
                  <button
                    type="button"
                    disabled={isUpdatingCompletion}
                    onClick={() => onToggleChapterCompletion(chapter.id, false)}
                    className="shrink-0 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-accent underline-offset-2 hover:underline disabled:text-gray-300 disabled:cursor-not-allowed"
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isUpdatingCompletion}
                    onClick={() => onToggleChapterCompletion(chapter.id, true)}
                    className="shrink-0 px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    Mark complete
                  </button>
                )
              )}
            </div>

            {/* Topics coverage meter */}
            <div className="px-4 pb-3 pl-10 flex items-center gap-3">
              <div className="flex-1 h-1.5 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className={`h-full rounded-full ${styles.bar}`}
                  style={{ width: `${percent}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 tabular-nums shrink-0">
                {completedCount}/{totalCount}
              </span>
            </div>

            {/* Expanded Topics */}
            {isExpanded && (
              <div className="border-t border-gray-100">
                {chapter.topics.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-500 italic">
                    No topics defined for this chapter
                  </div>
                ) : (
                  <>
                    <div className="px-4 pt-2 pl-10 text-[11px] uppercase tracking-wide text-gray-400">
                      Topics — marked from what you log
                    </div>
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
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
