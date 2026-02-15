import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatDate,
  getProgressIndicator,
  getProgressColorClass,
  calculateChapterProgress,
  calculateStats,
  calculateAllProgress,
} from "./curriculum-helpers";
import type { Chapter, ChapterProgress, TeachingSession } from "@/types/curriculum";

describe("formatDuration", () => {
  it("returns '-' for 0 minutes", () => {
    expect(formatDuration(0)).toBe("-");
  });

  it("formats minutes only", () => {
    expect(formatDuration(45)).toBe("45m");
  });

  it("formats hours only", () => {
    expect(formatDuration(120)).toBe("2h");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(90)).toBe("1h 30m");
  });
});

describe("formatDate", () => {
  it("returns '-' for null", () => {
    expect(formatDate(null)).toBe("-");
  });

  it("formats a date string in en-IN locale", () => {
    const result = formatDate("2025-03-15");
    // Just check it contains "Mar" and "15" — locale-sensitive
    expect(result).toContain("Mar");
    expect(result).toContain("15");
  });
});

describe("getProgressIndicator", () => {
  it("returns empty circle for undefined progress", () => {
    expect(getProgressIndicator(undefined)).toBe("○");
  });

  it("returns empty circle for no topics covered", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [],
      totalTimeMinutes: 0,
      lastTaughtDate: null,
      allTopicsCovered: false,
      isChapterComplete: false,
      chapterCompletedDate: null,
    };
    expect(getProgressIndicator(progress)).toBe("○");
  });

  it("returns filled circle for complete chapter", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [1, 2],
      totalTimeMinutes: 60,
      lastTaughtDate: "2025-01-01",
      allTopicsCovered: true,
      isChapterComplete: true,
      chapterCompletedDate: "2025-01-01",
    };
    expect(getProgressIndicator(progress)).toBe("●");
  });

  it("returns half-right circle when all topics covered but not marked complete", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [1, 2],
      totalTimeMinutes: 60,
      lastTaughtDate: "2025-01-01",
      allTopicsCovered: true,
      isChapterComplete: false,
      chapterCompletedDate: null,
    };
    expect(getProgressIndicator(progress)).toBe("◑");
  });

  it("returns half-left circle for partial progress", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [1],
      totalTimeMinutes: 30,
      lastTaughtDate: "2025-01-01",
      allTopicsCovered: false,
      isChapterComplete: false,
      chapterCompletedDate: null,
    };
    expect(getProgressIndicator(progress)).toBe("◐");
  });
});

describe("getProgressColorClass", () => {
  it("returns gray for no progress", () => {
    expect(getProgressColorClass(undefined)).toBe("text-gray-400");
  });

  it("returns green for complete", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [1],
      totalTimeMinutes: 30,
      lastTaughtDate: "2025-01-01",
      allTopicsCovered: true,
      isChapterComplete: true,
      chapterCompletedDate: "2025-01-01",
    };
    expect(getProgressColorClass(progress)).toBe("text-green-600");
  });

  it("returns blue when all topics covered but not marked complete", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [1],
      totalTimeMinutes: 30,
      lastTaughtDate: "2025-01-01",
      allTopicsCovered: true,
      isChapterComplete: false,
      chapterCompletedDate: null,
    };
    expect(getProgressColorClass(progress)).toBe("text-blue-600");
  });

  it("returns yellow for partial progress", () => {
    const progress: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [1],
      totalTimeMinutes: 30,
      lastTaughtDate: "2025-01-01",
      allTopicsCovered: false,
      isChapterComplete: false,
      chapterCompletedDate: null,
    };
    expect(getProgressColorClass(progress)).toBe("text-yellow-600");
  });
});

// Helpers for chapter/session test data
function makeChapter(id: number, topicIds: number[]): Chapter {
  return {
    id,
    code: `CH${id}`,
    name: `Chapter ${id}`,
    grade: 11,
    subjectId: 1,
    subjectName: "Physics",
    topics: topicIds.map((tid) => ({
      id: tid,
      code: `T${tid}`,
      name: `Topic ${tid}`,
      chapterId: id,
    })),
  };
}

function makeSession(
  topicIds: number[],
  durationMinutes: number,
  date: string
): TeachingSession {
  return {
    id: `session_${Date.now()}_${Math.random()}`,
    topicIds,
    durationMinutes,
    date,
    topics: topicIds.map((tid) => ({
      topicId: tid,
      topicName: `Topic ${tid}`,
      chapterName: "Chapter 1",
    })),
  };
}

describe("calculateChapterProgress", () => {
  it("returns empty progress when no sessions exist", () => {
    const chapter = makeChapter(1, [10, 11, 12]);
    const progress = calculateChapterProgress(chapter, []);
    expect(progress.completedTopicIds).toEqual([]);
    expect(progress.totalTimeMinutes).toBe(0);
    expect(progress.lastTaughtDate).toBeNull();
    expect(progress.allTopicsCovered).toBe(false);
  });

  it("tracks covered topics from sessions", () => {
    const chapter = makeChapter(1, [10, 11, 12]);
    const sessions = [makeSession([10, 11], 60, "2025-01-15")];
    const progress = calculateChapterProgress(chapter, sessions);
    expect(progress.completedTopicIds).toContain(10);
    expect(progress.completedTopicIds).toContain(11);
    expect(progress.completedTopicIds).not.toContain(12);
    expect(progress.allTopicsCovered).toBe(false);
  });

  it("detects all topics covered", () => {
    const chapter = makeChapter(1, [10, 11]);
    const sessions = [
      makeSession([10], 30, "2025-01-15"),
      makeSession([11], 30, "2025-01-16"),
    ];
    const progress = calculateChapterProgress(chapter, sessions);
    expect(progress.allTopicsCovered).toBe(true);
  });

  it("calculates proportional time correctly", () => {
    const chapter = makeChapter(1, [10]);
    // Session covers topic 10 + topic 20 (not in this chapter) — 50% proportional
    const sessions = [makeSession([10, 20], 60, "2025-01-15")];
    const progress = calculateChapterProgress(chapter, sessions);
    expect(progress.totalTimeMinutes).toBe(30); // 60 * 1/2
  });

  it("tracks the latest taught date", () => {
    const chapter = makeChapter(1, [10, 11]);
    const sessions = [
      makeSession([10], 30, "2025-01-10"),
      makeSession([11], 30, "2025-01-20"),
    ];
    const progress = calculateChapterProgress(chapter, sessions);
    expect(progress.lastTaughtDate).toBe("2025-01-20");
  });

  it("preserves existing completion status", () => {
    const chapter = makeChapter(1, [10]);
    const sessions = [makeSession([10], 30, "2025-01-15")];
    const existing: ChapterProgress = {
      chapterId: 1,
      completedTopicIds: [10],
      totalTimeMinutes: 30,
      lastTaughtDate: "2025-01-15",
      allTopicsCovered: true,
      isChapterComplete: true,
      chapterCompletedDate: "2025-01-15",
    };
    const progress = calculateChapterProgress(chapter, sessions, existing);
    expect(progress.isChapterComplete).toBe(true);
    expect(progress.chapterCompletedDate).toBe("2025-01-15");
  });
});

describe("calculateAllProgress", () => {
  it("returns progress for all chapters", () => {
    const chapters = [makeChapter(1, [10, 11]), makeChapter(2, [20, 21])];
    const sessions = [makeSession([10, 20], 60, "2025-01-15")];
    const result = calculateAllProgress(chapters, sessions, {});
    expect(result[1]).toBeDefined();
    expect(result[2]).toBeDefined();
    expect(result[1].completedTopicIds).toContain(10);
    expect(result[2].completedTopicIds).toContain(20);
  });
});

describe("calculateStats", () => {
  it("calculates zero stats with no progress", () => {
    const chapters = [makeChapter(1, [10, 11]), makeChapter(2, [20])];
    const stats = calculateStats(chapters, {});
    expect(stats.chaptersCompleted).toBe(0);
    expect(stats.totalChapters).toBe(2);
    expect(stats.topicsCovered).toBe(0);
    expect(stats.totalTopics).toBe(3);
    expect(stats.totalTimeMinutes).toBe(0);
  });

  it("counts completed chapters and covered topics", () => {
    const chapters = [makeChapter(1, [10, 11]), makeChapter(2, [20])];
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
      2: {
        chapterId: 2,
        completedTopicIds: [],
        totalTimeMinutes: 0,
        lastTaughtDate: null,
        allTopicsCovered: false,
        isChapterComplete: false,
        chapterCompletedDate: null,
      },
    };
    const stats = calculateStats(chapters, progress);
    expect(stats.chaptersCompleted).toBe(1);
    expect(stats.topicsCovered).toBe(2);
    expect(stats.totalTimeMinutes).toBe(60);
  });
});
