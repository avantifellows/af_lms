import type { ChapterProgress, TeachingSession, Chapter } from "@/types/curriculum";

// LocalStorage key generators (school-scoped)
function getSessionsKey(schoolCode: string): string {
  return `curriculum_sessions_${schoolCode}`;
}

function getProgressKey(schoolCode: string): string {
  return `curriculum_progress_${schoolCode}`;
}

// Generate a unique ID for sessions
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

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

// Load sessions from localStorage (school-scoped)
export function loadSessions(schoolCode: string): TeachingSession[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(getSessionsKey(schoolCode));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

// Save sessions to localStorage (school-scoped)
export function saveSessions(schoolCode: string, sessions: TeachingSession[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getSessionsKey(schoolCode), JSON.stringify(sessions));
}

// Load progress from localStorage (school-scoped)
export function loadProgress(schoolCode: string): Record<number, ChapterProgress> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(getProgressKey(schoolCode));
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

// Save progress to localStorage (school-scoped)
export function saveProgress(schoolCode: string, progress: Record<number, ChapterProgress>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getProgressKey(schoolCode), JSON.stringify(progress));
}

// Calculate progress for a chapter based on sessions
export function calculateChapterProgress(
  chapter: Chapter,
  sessions: TeachingSession[],
  existingProgress?: ChapterProgress
): ChapterProgress {
  // Get all topic IDs that have been covered in any session
  const coveredTopicIds = new Set<number>();
  let totalTimeMinutes = 0;
  let lastTaughtDate: string | null = null;

  // Find sessions that cover topics from this chapter
  const chapterTopicIds = new Set(chapter.topics.map((t) => t.id));

  for (const session of sessions) {
    const sessionTopicsInChapter = session.topicIds.filter((id) =>
      chapterTopicIds.has(id)
    );

    if (sessionTopicsInChapter.length > 0) {
      // Add covered topics
      sessionTopicsInChapter.forEach((id) => coveredTopicIds.add(id));

      // Calculate proportional time for this chapter
      const proportionOfSession =
        sessionTopicsInChapter.length / session.topicIds.length;
      totalTimeMinutes += Math.round(
        session.durationMinutes * proportionOfSession
      );

      // Track last taught date
      if (!lastTaughtDate || session.date > lastTaughtDate) {
        lastTaughtDate = session.date;
      }
    }
  }

  const allTopicsCovered =
    chapter.topics.length > 0 &&
    coveredTopicIds.size >= chapter.topics.length;

  return {
    chapterId: chapter.id,
    completedTopicIds: Array.from(coveredTopicIds),
    totalTimeMinutes,
    lastTaughtDate,
    allTopicsCovered,
    // Preserve explicit completion status if exists
    isChapterComplete: existingProgress?.isChapterComplete || false,
    chapterCompletedDate: existingProgress?.chapterCompletedDate || null,
  };
}

// Calculate all chapter progress from sessions
export function calculateAllProgress(
  chapters: Chapter[],
  sessions: TeachingSession[],
  existingProgress: Record<number, ChapterProgress>
): Record<number, ChapterProgress> {
  const progress: Record<number, ChapterProgress> = {};

  for (const chapter of chapters) {
    progress[chapter.id] = calculateChapterProgress(
      chapter,
      sessions,
      existingProgress[chapter.id]
    );
  }

  return progress;
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
    return "text-blue-600";
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
