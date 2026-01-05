"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  Chapter,
  TeachingSession,
  ChapterProgress,
  SubjectName,
  GradeNumber,
} from "@/types/curriculum";
import {
  loadSessions,
  saveSessions,
  loadProgress,
  saveProgress,
  calculateAllProgress,
  generateSessionId,
  getTodayDate,
} from "@/lib/curriculum-helpers";
import ProgressSummary from "./ProgressSummary";
import ChapterAccordion from "./ChapterAccordion";
import SessionHistory from "./SessionHistory";
import LogSessionModal from "./LogSessionModal";

interface CurriculumTabProps {
  schoolCode: string;
  schoolName: string;
  canEdit: boolean;
}

export default function CurriculumTab({
  schoolCode,
  schoolName,
  canEdit,
}: CurriculumTabProps) {
  // Filter state
  const [selectedGrade, setSelectedGrade] = useState<GradeNumber>(11);
  const [selectedSubject, setSelectedSubject] = useState<SubjectName>("Physics");

  // Data state
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Progress state (school-scoped)
  const [sessions, setSessions] = useState<TeachingSession[]>([]);
  const [progress, setProgress] = useState<Record<number, ChapterProgress>>({});

  // UI state
  const [expandedChapterIds, setExpandedChapterIds] = useState<number[]>([]);
  const [activeTab, setActiveTab] = useState<"chapters" | "history">("chapters");
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Load sessions and progress from localStorage on mount (school-scoped)
  useEffect(() => {
    const storedSessions = loadSessions(schoolCode);
    const storedProgress = loadProgress(schoolCode);
    setSessions(storedSessions);
    setProgress(storedProgress);
  }, [schoolCode]);

  // Fetch chapters when grade or subject changes
  useEffect(() => {
    async function fetchChapters() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/curriculum/chapters?grade=${selectedGrade}&subject=${selectedSubject}`
        );

        if (!response.ok) {
          throw new Error("Failed to fetch chapters");
        }

        const data = await response.json();
        setChapters(data.chapters);

        // Recalculate progress for new chapters
        const storedProgress = loadProgress(schoolCode);
        const newProgress = calculateAllProgress(
          data.chapters,
          sessions,
          storedProgress
        );
        setProgress(newProgress);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setIsLoading(false);
      }
    }

    fetchChapters();
  }, [selectedGrade, selectedSubject, sessions, schoolCode]);

  // Toggle chapter expansion
  const toggleChapter = useCallback((chapterId: number) => {
    setExpandedChapterIds((prev) =>
      prev.includes(chapterId)
        ? prev.filter((id) => id !== chapterId)
        : [...prev, chapterId]
    );
  }, []);

  // Save a new teaching session
  const handleSaveSession = useCallback(
    (date: string, durationMinutes: number, topicIds: number[], completedChapterIds: number[]) => {
      if (!canEdit) return;

      // Build topic details for display
      const topicDetails = topicIds.map((topicId) => {
        for (const chapter of chapters) {
          const topic = chapter.topics.find((t) => t.id === topicId);
          if (topic) {
            return {
              topicId: topic.id,
              topicName: topic.name,
              chapterName: chapter.name,
            };
          }
        }
        return { topicId, topicName: "Unknown", chapterName: "Unknown" };
      });

      const newSession: TeachingSession = {
        id: generateSessionId(),
        date,
        durationMinutes,
        topicIds,
        topics: topicDetails,
      };

      setSessions((prev) => {
        const updated = [newSession, ...prev];
        saveSessions(schoolCode, updated);
        return updated;
      });

      // Recalculate progress and mark completed chapters
      setProgress((prev) => {
        const updated = calculateAllProgress(chapters, [newSession, ...sessions], prev);

        // Mark chapters as complete
        for (const chapterId of completedChapterIds) {
          if (updated[chapterId]) {
            updated[chapterId] = {
              ...updated[chapterId],
              isChapterComplete: true,
              chapterCompletedDate: date,
            };
          } else {
            updated[chapterId] = {
              chapterId,
              completedTopicIds: [],
              totalTimeMinutes: 0,
              lastTaughtDate: null,
              allTopicsCovered: false,
              isChapterComplete: true,
              chapterCompletedDate: date,
            };
          }
        }

        saveProgress(schoolCode, updated);
        return updated;
      });

      setIsModalOpen(false);
    },
    [canEdit, chapters, sessions, schoolCode]
  );

  return (
    <div>
      {/* School Context Header */}
      <div className="mb-4 pb-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              JEE Curriculum Progress
            </h2>
            <p className="text-sm text-gray-500">{schoolName}</p>
          </div>
          {!canEdit && (
            <span className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 rounded">
              View Only
            </span>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-50 rounded-lg p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          {/* Grade Select */}
          <div>
            <label
              htmlFor="grade"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Grade
            </label>
            <select
              id="grade"
              value={selectedGrade}
              onChange={(e) => setSelectedGrade(parseInt(e.target.value) as GradeNumber)}
              className="block w-24 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value={11}>11</option>
              <option value={12}>12</option>
            </select>
          </div>

          {/* Subject Select */}
          <div>
            <label
              htmlFor="subject"
              className="block text-xs font-medium text-gray-700 mb-1"
            >
              Subject
            </label>
            <select
              id="subject"
              value={selectedSubject}
              onChange={(e) => setSelectedSubject(e.target.value as SubjectName)}
              className="block w-32 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="Physics">Physics</option>
              <option value="Chemistry">Chemistry</option>
              <option value="Maths">Maths</option>
            </select>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Log Session Button (only if canEdit) */}
          {canEdit && (
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              + Log Session
            </button>
          )}
        </div>
      </div>

      {/* Progress Summary */}
      <ProgressSummary chapters={chapters} progress={progress} />

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-4">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab("chapters")}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === "chapters"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            Chapters
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`py-3 px-1 border-b-2 text-sm font-medium transition-colors ${
              activeTab === "history"
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            History
          </button>
        </nav>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">{error}</div>
      ) : activeTab === "chapters" ? (
        <ChapterAccordion
          chapters={chapters}
          progress={progress}
          expandedChapterIds={expandedChapterIds}
          onToggleChapter={toggleChapter}
        />
      ) : (
        <SessionHistory sessions={sessions} />
      )}

      {/* Log Session Modal */}
      {isModalOpen && canEdit && (
        <LogSessionModal
          chapters={chapters}
          progress={progress}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveSession}
        />
      )}
    </div>
  );
}
