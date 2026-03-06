import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CurriculumTab from "./CurriculumTab";
import type { Chapter, ChapterProgress, TeachingSession } from "@/types/curriculum";

// --- Mocks ---

const mockLoadSessions = vi.fn<(code: string) => TeachingSession[]>();
const mockSaveSessions = vi.fn();
const mockLoadProgress = vi.fn<(code: string) => Record<number, ChapterProgress>>();
const mockSaveProgress = vi.fn();
const mockCalculateAllProgress = vi.fn<
  (chapters: Chapter[], sessions: TeachingSession[], existing: Record<number, ChapterProgress>) => Record<number, ChapterProgress>
>();
const mockGenerateSessionId = vi.fn();

vi.mock("@/lib/curriculum-helpers", () => ({
  loadSessions: (...args: unknown[]) => mockLoadSessions(...(args as [string])),
  saveSessions: (...args: unknown[]) => mockSaveSessions(...args),
  loadProgress: (...args: unknown[]) => mockLoadProgress(...(args as [string])),
  saveProgress: (...args: unknown[]) => mockSaveProgress(...args),
  calculateAllProgress: (...args: unknown[]) =>
    mockCalculateAllProgress(
      ...(args as [Chapter[], TeachingSession[], Record<number, ChapterProgress>])
    ),
  generateSessionId: () => mockGenerateSessionId(),
}));

// Mock child components as stubs
vi.mock("./ProgressSummary", () => ({
  default: (props: { chapters: Chapter[]; progress: Record<number, ChapterProgress> }) => (
    <div data-testid="progress-summary" data-chapters={JSON.stringify(props.chapters)} />
  ),
}));

vi.mock("./ChapterAccordion", () => ({
  default: (props: {
    chapters: Chapter[];
    progress: Record<number, ChapterProgress>;
    expandedChapterIds: number[];
    onToggleChapter: (id: number) => void;
  }) => (
    <div data-testid="chapter-accordion" data-chapters={JSON.stringify(props.chapters)}>
      <button data-testid="toggle-chapter-1" onClick={() => props.onToggleChapter(1)}>
        Toggle
      </button>
    </div>
  ),
}));

vi.mock("./SessionHistory", () => ({
  default: (props: { sessions: TeachingSession[] }) => (
    <div data-testid="session-history" data-sessions={JSON.stringify(props.sessions)} />
  ),
}));

vi.mock("./LogSessionModal", () => ({
  default: (props: {
    chapters: Chapter[];
    progress: Record<number, ChapterProgress>;
    onClose: () => void;
    onSave: (date: string, dur: number, topicIds: number[], chapterIds: number[]) => void;
  }) => (
    <div data-testid="log-session-modal">
      <button data-testid="modal-close" onClick={props.onClose}>
        Close
      </button>
      <button
        data-testid="modal-save"
        onClick={() => props.onSave("2026-02-15", 60, [101], [1])}
      >
        Save
      </button>
      <button
        data-testid="modal-save-no-chapter"
        onClick={() => props.onSave("2026-02-15", 45, [101, 102], [])}
      >
        Save No Chapter
      </button>
    </div>
  ),
}));

// --- Test data ---

const sampleChapters: Chapter[] = [
  {
    id: 1,
    code: "PH01",
    name: "Kinematics",
    grade: 11,
    subjectId: 4,
    subjectName: "Physics",
    topics: [
      { id: 101, code: "PH01.01", name: "Motion in a Straight Line", chapterId: 1 },
      { id: 102, code: "PH01.02", name: "Projectile Motion", chapterId: 1 },
    ],
  },
  {
    id: 2,
    code: "PH02",
    name: "Laws of Motion",
    grade: 11,
    subjectId: 4,
    subjectName: "Physics",
    topics: [
      { id: 201, code: "PH02.01", name: "Newton's Laws", chapterId: 2 },
    ],
  },
];

const sampleProgress: Record<number, ChapterProgress> = {
  1: {
    chapterId: 1,
    completedTopicIds: [101],
    totalTimeMinutes: 60,
    lastTaughtDate: "2026-02-10",
    allTopicsCovered: false,
    isChapterComplete: false,
    chapterCompletedDate: null,
  },
};

const sampleSessions: TeachingSession[] = [
  {
    id: "session_1",
    date: "2026-02-10",
    durationMinutes: 60,
    topicIds: [101],
    topics: [{ topicId: 101, topicName: "Motion in a Straight Line", chapterName: "Kinematics" }],
  },
];

// --- Helpers ---

let mockFetch: ReturnType<typeof vi.fn>;

function setupFetch(chapters: Chapter[] = sampleChapters, ok = true) {
  mockFetch.mockResolvedValue({
    ok,
    json: async () => ({ chapters }),
  });
}

function renderTab(props: Partial<{ schoolCode: string; schoolName: string; canEdit: boolean }> = {}) {
  return render(
    <CurriculumTab
      schoolCode={props.schoolCode ?? "SCH001"}
      schoolName={props.schoolName ?? "Test School"}
      canEdit={props.canEdit ?? true}
    />
  );
}

// --- Tests ---

describe("CurriculumTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    // Default mock returns
    mockLoadSessions.mockReturnValue([]);
    mockLoadProgress.mockReturnValue({});
    mockCalculateAllProgress.mockReturnValue({});
    mockGenerateSessionId.mockReturnValue("session_new");
  });

  describe("initial rendering", () => {
    it("renders heading, school name, and filter controls", async () => {
      setupFetch();
      renderTab({ schoolName: "Avanti School" });

      expect(screen.getByText("JEE Curriculum Progress")).toBeInTheDocument();
      expect(screen.getByText("Avanti School")).toBeInTheDocument();
      expect(screen.getByLabelText("Grade")).toBeInTheDocument();
      expect(screen.getByLabelText("Subject")).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });
    });

    it("shows loading spinner initially", () => {
      // Never resolve fetch to keep loading
      mockFetch.mockReturnValue(new Promise(() => {}));
      renderTab();

      // Loading spinner is a div with animate-spin class
      const spinner = document.querySelector(".animate-spin");
      expect(spinner).toBeInTheDocument();
    });

    it("shows '+ Log Session' button when canEdit is true", async () => {
      setupFetch();
      renderTab({ canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      expect(screen.getByText("+ Log Session")).toBeInTheDocument();
    });

    it("hides '+ Log Session' button and shows 'View Only' when canEdit is false", async () => {
      setupFetch();
      renderTab({ canEdit: false });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      expect(screen.queryByText("+ Log Session")).not.toBeInTheDocument();
      expect(screen.getByText("View Only")).toBeInTheDocument();
    });
  });

  describe("localStorage loading", () => {
    it("loads sessions and progress from localStorage on mount", async () => {
      mockLoadSessions.mockReturnValue(sampleSessions);
      mockLoadProgress.mockReturnValue(sampleProgress);
      setupFetch();

      renderTab({ schoolCode: "SCH001" });

      expect(mockLoadSessions).toHaveBeenCalledWith("SCH001");
      expect(mockLoadProgress).toHaveBeenCalledWith("SCH001");

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });
    });
  });

  describe("fetching chapters", () => {
    it("fetches chapters for default grade=11 and subject=Physics on mount", async () => {
      setupFetch();
      renderTab();

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/curriculum/chapters?grade=11&subject=Physics"
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });
    });

    it("recalculates progress after fetching chapters", async () => {
      mockLoadProgress.mockReturnValue(sampleProgress);
      mockCalculateAllProgress.mockReturnValue(sampleProgress);
      setupFetch();
      renderTab();

      await waitFor(() => {
        expect(mockCalculateAllProgress).toHaveBeenCalled();
      });
    });

    it("shows error message when fetch fails (non-ok response)", async () => {
      mockFetch.mockResolvedValue({ ok: false });
      renderTab();

      await waitFor(() => {
        expect(screen.getByText("Failed to fetch chapters")).toBeInTheDocument();
      });
    });

    it("shows error message when fetch throws a network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      renderTab();

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("shows generic error for non-Error thrown objects", async () => {
      mockFetch.mockRejectedValue("something wrong");
      renderTab();

      await waitFor(() => {
        expect(screen.getByText("An error occurred")).toBeInTheDocument();
      });
    });
  });

  describe("grade/subject selectors", () => {
    it("fetches new chapters when grade changes to 12", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      mockFetch.mockClear();
      setupFetch([]);

      await user.selectOptions(screen.getByLabelText("Grade"), "12");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/curriculum/chapters?grade=12&subject=Physics"
        );
      });
    });

    it("fetches new chapters when subject changes to Chemistry", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      mockFetch.mockClear();
      setupFetch([]);

      await user.selectOptions(screen.getByLabelText("Subject"), "Chemistry");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/curriculum/chapters?grade=11&subject=Chemistry"
        );
      });
    });
  });

  describe("tab switching", () => {
    it("shows ChapterAccordion by default (Chapters tab active)", async () => {
      setupFetch();
      renderTab();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("session-history")).not.toBeInTheDocument();
    });

    it("switches to History tab and shows SessionHistory", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("History"));

      expect(screen.getByTestId("session-history")).toBeInTheDocument();
      expect(screen.queryByTestId("chapter-accordion")).not.toBeInTheDocument();
    });

    it("switches back to Chapters tab", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("History"));
      expect(screen.getByTestId("session-history")).toBeInTheDocument();

      await user.click(screen.getByText("Chapters"));
      expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      expect(screen.queryByTestId("session-history")).not.toBeInTheDocument();
    });
  });

  describe("modal lifecycle", () => {
    it("opens LogSessionModal when '+ Log Session' is clicked", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab({ canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("log-session-modal")).not.toBeInTheDocument();

      await user.click(screen.getByText("+ Log Session"));

      expect(screen.getByTestId("log-session-modal")).toBeInTheDocument();
    });

    it("closes modal when onClose is called", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab({ canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Log Session"));
      expect(screen.getByTestId("log-session-modal")).toBeInTheDocument();

      await user.click(screen.getByTestId("modal-close"));
      expect(screen.queryByTestId("log-session-modal")).not.toBeInTheDocument();
    });

    it("does not render modal when canEdit is false even if isModalOpen were true", async () => {
      setupFetch();
      renderTab({ canEdit: false });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      // No button to open modal, and modal is not rendered
      expect(screen.queryByText("+ Log Session")).not.toBeInTheDocument();
      expect(screen.queryByTestId("log-session-modal")).not.toBeInTheDocument();
    });
  });

  describe("saving sessions", () => {
    it("saves a session with topics and chapter completion, then closes modal", async () => {
      mockLoadSessions.mockReturnValue([]);
      mockLoadProgress.mockReturnValue({});
      mockCalculateAllProgress.mockReturnValue({});
      mockGenerateSessionId.mockReturnValue("session_abc");
      setupFetch();
      const user = userEvent.setup();
      renderTab({ schoolCode: "SCH001", canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Log Session"));
      expect(screen.getByTestId("log-session-modal")).toBeInTheDocument();

      // Click save on the mock modal (calls onSave with date, 60, [101], [1])
      await user.click(screen.getByTestId("modal-save"));

      // Modal should close after save
      expect(screen.queryByTestId("log-session-modal")).not.toBeInTheDocument();

      // saveSessions should have been called with updated sessions
      expect(mockSaveSessions).toHaveBeenCalledWith(
        "SCH001",
        expect.arrayContaining([
          expect.objectContaining({
            id: "session_abc",
            date: "2026-02-15",
            durationMinutes: 60,
            topicIds: [101],
          }),
        ])
      );

      // saveProgress should have been called
      expect(mockSaveProgress).toHaveBeenCalledWith("SCH001", expect.any(Object));
    });

    it("saves a session with topics only (no chapter completion)", async () => {
      mockLoadSessions.mockReturnValue([]);
      mockLoadProgress.mockReturnValue({});
      mockCalculateAllProgress.mockReturnValue({});
      mockGenerateSessionId.mockReturnValue("session_xyz");
      setupFetch();
      const user = userEvent.setup();
      renderTab({ schoolCode: "SCH002", canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Log Session"));
      await user.click(screen.getByTestId("modal-save-no-chapter"));

      expect(screen.queryByTestId("log-session-modal")).not.toBeInTheDocument();
      expect(mockSaveSessions).toHaveBeenCalledWith(
        "SCH002",
        expect.arrayContaining([
          expect.objectContaining({
            id: "session_xyz",
            durationMinutes: 45,
            topicIds: [101, 102],
          }),
        ])
      );
    });

    it("does not save when canEdit is false (guard in handleSaveSession)", async () => {
      // canEdit=false prevents opening the modal entirely, but the guard also
      // exists in handleSaveSession. We test it indirectly — no saveSessions calls.
      setupFetch();
      renderTab({ canEdit: false });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      expect(mockSaveSessions).not.toHaveBeenCalled();
      expect(mockSaveProgress).not.toHaveBeenCalled();
    });

    it("builds topic details with 'Unknown' fallback for missing topics", async () => {
      // Set up chapters so topic 999 is not found in any chapter
      const chaptersWithMissing: Chapter[] = [
        {
          id: 1,
          code: "PH01",
          name: "Kinematics",
          grade: 11,
          subjectId: 4,
          subjectName: "Physics",
          topics: [],
        },
      ];
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ chapters: chaptersWithMissing }),
      });
      mockCalculateAllProgress.mockReturnValue({});
      mockGenerateSessionId.mockReturnValue("session_missing");

      // Override LogSessionModal mock to call onSave with topic 999 (not in chapters)
      // We can't override the mock per-test easily, but our default mock sends topicId=101
      // which is also not in chaptersWithMissing (empty topics). So the fallback will trigger.

      const user = userEvent.setup();
      renderTab({ schoolCode: "SCH001", canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Log Session"));
      await user.click(screen.getByTestId("modal-save"));

      // The saved session should have topic details with "Unknown" for topic 101
      // since chaptersWithMissing has no topics
      expect(mockSaveSessions).toHaveBeenCalledWith(
        "SCH001",
        expect.arrayContaining([
          expect.objectContaining({
            topics: [
              { topicId: 101, topicName: "Unknown", chapterName: "Unknown" },
            ],
          }),
        ])
      );
    });
  });

  describe("chapter completion in progress", () => {
    it("marks chapter as complete in progress when completedChapterIds includes it", async () => {
      // Set up calculateAllProgress to return a progress with chapter 1
      const progressWithChapter: Record<number, ChapterProgress> = {
        1: {
          chapterId: 1,
          completedTopicIds: [101],
          totalTimeMinutes: 60,
          lastTaughtDate: "2026-02-15",
          allTopicsCovered: false,
          isChapterComplete: false,
          chapterCompletedDate: null,
        },
      };
      mockCalculateAllProgress.mockReturnValue(progressWithChapter);
      mockGenerateSessionId.mockReturnValue("session_complete");
      setupFetch();

      const user = userEvent.setup();
      renderTab({ schoolCode: "SCH001", canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Log Session"));
      // modal-save calls onSave with completedChapterIds=[1]
      await user.click(screen.getByTestId("modal-save"));

      // saveProgress should be called, and chapter 1 should have isChapterComplete=true
      expect(mockSaveProgress).toHaveBeenCalledWith(
        "SCH001",
        expect.objectContaining({
          1: expect.objectContaining({
            isChapterComplete: true,
            chapterCompletedDate: "2026-02-15",
          }),
        })
      );
    });

    it("creates new progress entry for chapter not yet in progress map", async () => {
      // calculateAllProgress returns empty — chapter 1 not present
      mockCalculateAllProgress.mockReturnValue({});
      mockGenerateSessionId.mockReturnValue("session_new_chapter");
      setupFetch();

      const user = userEvent.setup();
      renderTab({ schoolCode: "SCH001", canEdit: true });

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      await user.click(screen.getByText("+ Log Session"));
      // modal-save calls onSave with completedChapterIds=[1]
      await user.click(screen.getByTestId("modal-save"));

      // saveProgress should create a new entry for chapter 1
      expect(mockSaveProgress).toHaveBeenCalledWith(
        "SCH001",
        expect.objectContaining({
          1: expect.objectContaining({
            chapterId: 1,
            completedTopicIds: [],
            totalTimeMinutes: 0,
            lastTaughtDate: null,
            allTopicsCovered: false,
            isChapterComplete: true,
            chapterCompletedDate: "2026-02-15",
          }),
        })
      );
    });
  });

  describe("ProgressSummary integration", () => {
    it("passes chapters and progress to ProgressSummary", async () => {
      mockCalculateAllProgress.mockReturnValue(sampleProgress);
      setupFetch();
      renderTab();

      await waitFor(() => {
        const summary = screen.getByTestId("progress-summary");
        expect(summary).toBeInTheDocument();
      });
    });
  });

  describe("chapter toggle", () => {
    it("passes onToggleChapter to ChapterAccordion", async () => {
      setupFetch();
      const user = userEvent.setup();
      renderTab();

      await waitFor(() => {
        expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
      });

      // Click the toggle button exposed by our mock
      await user.click(screen.getByTestId("toggle-chapter-1"));

      // No crash — the toggle callback was invoked successfully
      expect(screen.getByTestId("chapter-accordion")).toBeInTheDocument();
    });
  });

  describe("empty chapters", () => {
    it("renders ChapterAccordion with empty chapters array", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ chapters: [] }),
      });
      renderTab();

      await waitFor(() => {
        const accordion = screen.getByTestId("chapter-accordion");
        expect(accordion).toBeInTheDocument();
        expect(accordion.getAttribute("data-chapters")).toBe("[]");
      });
    });
  });
});
