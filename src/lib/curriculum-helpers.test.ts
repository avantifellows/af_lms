import { describe, expect, it, vi, afterEach } from "vitest";
import {
  calculateStats,
  formatDate,
  formatDuration,
  getProgressColorClass,
  getProgressIndicator,
  getTodayDate,
} from "./curriculum-helpers";
import type { Chapter, ChapterProgress } from "@/types/curriculum";

describe("formatDuration", () => {
  it("formats minutes as compact duration text", () => {
    expect(formatDuration(0)).toBe("-");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});

describe("formatDate", () => {
  it("formats null and date strings for display", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate("2025-03-15")).toContain("Mar");
    expect(formatDate("2025-03-15")).toContain("15");
  });
});

describe("getProgressIndicator", () => {
  it("maps progress state to the expected indicator", () => {
    expect(getProgressIndicator(undefined)).toBe("○");
    expect(
      getProgressIndicator({
        chapterId: 1,
        completedTopicIds: [],
        totalTimeMinutes: 0,
        lastTaughtDate: null,
        allTopicsCovered: false,
        isChapterComplete: false,
        chapterCompletedDate: null,
      })
    ).toBe("○");
    expect(
      getProgressIndicator({
        chapterId: 1,
        completedTopicIds: [1],
        totalTimeMinutes: 30,
        lastTaughtDate: "2025-01-01",
        allTopicsCovered: false,
        isChapterComplete: false,
        chapterCompletedDate: null,
      })
    ).toBe("◐");
    expect(
      getProgressIndicator({
        chapterId: 1,
        completedTopicIds: [1],
        totalTimeMinutes: 30,
        lastTaughtDate: "2025-01-01",
        allTopicsCovered: true,
        isChapterComplete: false,
        chapterCompletedDate: null,
      })
    ).toBe("◑");
    expect(
      getProgressIndicator({
        chapterId: 1,
        completedTopicIds: [1],
        totalTimeMinutes: 30,
        lastTaughtDate: "2025-01-01",
        allTopicsCovered: true,
        isChapterComplete: true,
        chapterCompletedDate: "2025-01-01",
      })
    ).toBe("●");
  });
});

describe("getProgressColorClass", () => {
  it("maps progress state to color classes", () => {
    expect(getProgressColorClass(undefined)).toBe("text-gray-400");
    expect(
      getProgressColorClass({
        chapterId: 1,
        completedTopicIds: [1],
        totalTimeMinutes: 30,
        lastTaughtDate: "2025-01-01",
        allTopicsCovered: false,
        isChapterComplete: false,
        chapterCompletedDate: null,
      })
    ).toBe("text-yellow-600");
    expect(
      getProgressColorClass({
        chapterId: 1,
        completedTopicIds: [1],
        totalTimeMinutes: 30,
        lastTaughtDate: "2025-01-01",
        allTopicsCovered: true,
        isChapterComplete: false,
        chapterCompletedDate: null,
      })
    ).toBe("text-accent");
    expect(
      getProgressColorClass({
        chapterId: 1,
        completedTopicIds: [1],
        totalTimeMinutes: 30,
        lastTaughtDate: "2025-01-01",
        allTopicsCovered: true,
        isChapterComplete: true,
        chapterCompletedDate: "2025-01-01",
      })
    ).toBe("text-green-600");
  });
});

function chapter(id: number, topicIds: number[]): Chapter {
  return {
    id,
    code: `CH${id}`,
    name: `Chapter ${id}`,
    grade: 11,
    subjectId: 4,
    subjectName: "Physics",
    topics: topicIds.map((topicId) => ({
      id: topicId,
      code: `T${topicId}`,
      name: `Topic ${topicId}`,
      chapterId: id,
    })),
  };
}

describe("calculateStats", () => {
  it("calculates display stats from backend progress", () => {
    const progress: Record<number, ChapterProgress> = {
      1: {
        chapterId: 1,
        completedTopicIds: [10, 11],
        totalTimeMinutes: 60,
        lastTaughtDate: "2025-01-15",
        allTopicsCovered: true,
        isChapterComplete: true,
        chapterCompletedDate: "2025-01-15",
      },
    };

    expect(calculateStats([chapter(1, [10, 11]), chapter(2, [20])], progress)).toEqual({
      chaptersCompleted: 1,
      totalChapters: 2,
      topicsCovered: 2,
      totalTopics: 3,
      totalTimeMinutes: 60,
    });
  });
});

describe("getTodayDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns YYYY-MM-DD format from the current UTC date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-06-15T10:00:00Z"));

    expect(getTodayDate()).toBe("2025-06-15");
  });
});
