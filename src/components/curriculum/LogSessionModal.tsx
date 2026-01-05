"use client";

import { useState } from "react";
import type { Chapter, ChapterProgress } from "@/types/curriculum";
import { getTodayDate } from "@/lib/curriculum-helpers";

interface LogSessionModalProps {
  chapters: Chapter[];
  progress: Record<number, ChapterProgress>;
  onClose: () => void;
  onSave: (date: string, durationMinutes: number, topicIds: number[], completedChapterIds: number[]) => void;
}

export default function LogSessionModal({
  chapters,
  progress,
  onClose,
  onSave,
}: LogSessionModalProps) {
  const [date, setDate] = useState(getTodayDate());
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<number>>(new Set());
  const [expandedChapterIds, setExpandedChapterIds] = useState<Set<number>>(new Set());
  const [completedChapterIds, setCompletedChapterIds] = useState<Set<number>>(new Set());

  const toggleChapterComplete = (chapterId: number) => {
    setCompletedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  const toggleTopic = (topicId: number) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) {
        next.delete(topicId);
      } else {
        next.add(topicId);
      }
      return next;
    });
  };

  const toggleChapterExpand = (chapterId: number) => {
    setExpandedChapterIds((prev) => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  const handleSave = () => {
    const durationMinutes = hours * 60 + minutes;
    // Allow saving if either topics are selected OR chapters are marked complete
    if (selectedTopicIds.size === 0 && completedChapterIds.size === 0) {
      alert("Please select at least one topic or mark a chapter as complete");
      return;
    }
    if (durationMinutes <= 0) {
      alert("Please enter a valid duration");
      return;
    }
    onSave(date, durationMinutes, Array.from(selectedTopicIds), Array.from(completedChapterIds));
  };

  // Count selected topics per chapter
  const getSelectedCountForChapter = (chapter: Chapter): number => {
    return chapter.topics.filter((t) => selectedTopicIds.has(t.id)).length;
  };

  // Count unique chapters with selections
  const getSelectedChapterCount = (): number => {
    const chaptersWithSelections = new Set<number>();
    for (const chapter of chapters) {
      if (chapter.topics.some((t) => selectedTopicIds.has(t.id))) {
        chaptersWithSelections.add(chapter.id);
      }
    }
    return chaptersWithSelections.size;
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-30"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative min-h-screen flex items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Log Teaching Session
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4">
            {/* Date and Duration */}
            <div className="flex gap-4 mb-4">
              {/* Date */}
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {/* Duration */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Duration
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={12}
                    value={hours}
                    onChange={(e) => setHours(Math.max(0, parseInt(e.target.value) || 0))}
                    className="w-16 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-500">hrs</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={minutes}
                    onChange={(e) => setMinutes(Math.min(59, Math.max(0, parseInt(e.target.value) || 0)))}
                    className="w-16 rounded-md border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900 text-center focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-500">mins</span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 my-4" />

            {/* Topic Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Topics Covered
              </label>

              <div className="border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                {chapters.map((chapter) => {
                  const isExpanded = expandedChapterIds.has(chapter.id);
                  const selectedCount = getSelectedCountForChapter(chapter);
                  const chapterProgress = progress[chapter.id];
                  const hasTopics = chapter.topics.length > 0;
                  const isAlreadyComplete = chapterProgress?.isChapterComplete;
                  const isMarkedComplete = completedChapterIds.has(chapter.id);

                  return (
                    <div key={chapter.id} className="border-b border-gray-100 last:border-b-0">
                      {/* Chapter Header */}
                      <div className="flex items-center px-3 py-2 gap-2">
                        {/* Mark Complete Checkbox */}
                        <label
                          className="flex items-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isMarkedComplete || isAlreadyComplete}
                            disabled={isAlreadyComplete}
                            onChange={() => toggleChapterComplete(chapter.id)}
                            className="w-4 h-4 rounded border-gray-300 text-green-600 focus:ring-green-500 disabled:opacity-50"
                          />
                        </label>

                        {/* Expandable Chapter Name */}
                        <button
                          onClick={() => hasTopics && toggleChapterExpand(chapter.id)}
                          disabled={!hasTopics}
                          className={`flex-1 flex items-center gap-2 text-left ${
                            hasTopics ? "hover:text-blue-600" : "opacity-50 cursor-not-allowed"
                          }`}
                        >
                          {hasTopics && (
                            <span
                              className={`text-xs text-gray-400 transition-transform ${
                                isExpanded ? "rotate-90" : ""
                              }`}
                            >
                              ▶
                            </span>
                          )}
                          <span className={`text-sm truncate ${isAlreadyComplete ? "text-gray-400 line-through" : "text-gray-700"}`}>
                            {chapter.name}
                          </span>
                        </button>

                        {/* Badges */}
                        {isAlreadyComplete && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                            ✓ Complete
                          </span>
                        )}
                        {isMarkedComplete && !isAlreadyComplete && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">
                            Will Complete
                          </span>
                        )}
                        {selectedCount > 0 && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                            {selectedCount} topics
                          </span>
                        )}
                        {hasTopics && !selectedCount && (
                          <span className="text-xs text-gray-400">
                            {chapter.topics.length} topics
                          </span>
                        )}
                      </div>

                      {/* Topics */}
                      {isExpanded && hasTopics && (
                        <div className="bg-gray-50 border-t border-gray-100">
                          {chapter.topics.map((topic) => {
                            const isSelected = selectedTopicIds.has(topic.id);
                            const wasAlreadyCovered =
                              chapterProgress?.completedTopicIds.includes(topic.id);

                            return (
                              <label
                                key={topic.id}
                                className={`flex items-center gap-3 px-3 py-2 pl-8 cursor-pointer hover:bg-gray-100 ${
                                  wasAlreadyCovered ? "opacity-60" : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => toggleTopic(topic.id)}
                                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="flex-1 text-sm text-gray-700">
                                  {topic.name}
                                </span>
                                {wasAlreadyCovered && (
                                  <span className="text-xs text-green-600">
                                    ✓ covered
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Selection Summary */}
            <div className="mt-3 text-sm text-gray-600 space-y-1">
              {selectedTopicIds.size > 0 && (
                <div>
                  Topics: {selectedTopicIds.size} selected from {getSelectedChapterCount()} chapter
                  {getSelectedChapterCount() !== 1 ? "s" : ""}
                </div>
              )}
              {completedChapterIds.size > 0 && (
                <div className="text-green-600">
                  Chapters to complete: {completedChapterIds.size}
                </div>
              )}
              {selectedTopicIds.size === 0 && completedChapterIds.size === 0 && (
                <div className="text-gray-400 italic">
                  Select topics or mark chapters as complete
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-gray-200 flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={selectedTopicIds.size === 0 && completedChapterIds.size === 0}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
