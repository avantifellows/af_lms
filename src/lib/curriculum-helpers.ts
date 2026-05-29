import type { ChapterProgress, Chapter } from "@/types/curriculum";

// Format duration from minutes to display string
export function formatDuration(minutes: number): string {
  if (minutes === 0) return "-";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

// Format date for display
export function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-IN", {
    month: "short",
    day: "numeric",
  });
}

// Get today's date in YYYY-MM-DD format
export function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

// Get progress indicator character
export function getProgressIndicator(progress: ChapterProgress | undefined): string {
  if (!progress || progress.completedTopicIds.length === 0) {
    return "○"; // Empty
  }
  if (progress.isChapterComplete) {
    return "●"; // Complete
  }
  if (progress.allTopicsCovered) {
    return "◑"; // All topics done, not marked complete
  }
  return "◐"; // Partial
}

// Get progress color class
export function getProgressColorClass(progress: ChapterProgress | undefined): string {
  if (!progress || progress.completedTopicIds.length === 0) {
    return "text-gray-400";
  }
  if (progress.isChapterComplete) {
    return "text-green-600";
  }
  if (progress.allTopicsCovered) {
    return "text-accent";
  }
  return "text-yellow-600";
}

// Summary stats
export interface CurriculumStats {
  chaptersCompleted: number;
  totalChapters: number;
  topicsCovered: number;
  totalTopics: number;
  totalTimeMinutes: number;
}

export function calculateStats(
  chapters: Chapter[],
  progress: Record<number, ChapterProgress>
): CurriculumStats {
  let chaptersCompleted = 0;
  let topicsCovered = 0;
  let totalTopics = 0;
  let totalTimeMinutes = 0;

  for (const chapter of chapters) {
    totalTopics += chapter.topics.length;
    const chapterProgress = progress[chapter.id];

    if (chapterProgress) {
      if (chapterProgress.isChapterComplete) {
        chaptersCompleted++;
      }
      topicsCovered += chapterProgress.completedTopicIds.length;
      totalTimeMinutes += chapterProgress.totalTimeMinutes;
    }
  }

  return {
    chaptersCompleted,
    totalChapters: chapters.length,
    topicsCovered,
    totalTopics,
    totalTimeMinutes,
  };
}
