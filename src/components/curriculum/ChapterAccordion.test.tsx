import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChapterAccordion from "./ChapterAccordion";
import type { Chapter, ChapterProgress } from "@/types/curriculum";

// --- Mocks ---

const mockGetProgressIndicator = vi.fn();
const mockGetProgressColorClass = vi.fn();
const mockFormatDuration = vi.fn();
const mockFormatDate = vi.fn();

vi.mock("@/lib/curriculum-helpers", () => ({
  getProgressIndicator: (...args: unknown[]) =>
    mockGetProgressIndicator(...args),
  getProgressColorClass: (...args: unknown[]) =>
    mockGetProgressColorClass(...args),
  formatDuration: (...args: unknown[]) => mockFormatDuration(...args),
  formatDate: (...args: unknown[]) => mockFormatDate(...args),
}));

vi.mock("./TopicRow", () => ({
  default: ({ topic, isCompleted }: { topic: { id: number; name: string; code: string }; isCompleted: boolean }) => (
    <div data-testid={`topic-row-${topic.id}`} data-completed={isCompleted}>
      {topic.name} ({topic.code})
    </div>
  ),
}));

// --- Helpers ---

function makeChapter(overrides: Partial<Chapter> & { id: number; name: string }): Chapter {
  return {
    code: `CH${overrides.id}`,
    grade: 11,
    subjectId: 4,
    subjectName: "Physics",
    topics: [],
    ...overrides,
  };
}

function makeProgress(
  chapterId: number,
  overrides: Partial<ChapterProgress> = {}
): ChapterProgress {
  return {
    chapterId,
    completedTopicIds: [],
    totalTimeMinutes: 0,
    lastTaughtDate: null,
    allTopicsCovered: false,
    isChapterComplete: false,
    chapterCompletedDate: null,
    ...overrides,
  };
}

// --- Tests ---

describe("ChapterAccordion", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProgressIndicator.mockReturnValue("○");
    mockGetProgressColorClass.mockReturnValue("text-gray-400");
    mockFormatDuration.mockReturnValue("1h 30m");
    mockFormatDate.mockReturnValue("-");
  });

  it("renders empty state when no chapters", () => {
    render(
      <ChapterAccordion
        chapters={[]}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(
      screen.getByText("No chapters found for this grade and subject.")
    ).toBeInTheDocument();
  });

  it("renders chapter names with index numbers", () => {
    const chapters = [
      makeChapter({ id: 1, name: "Kinematics" }),
      makeChapter({ id: 2, name: "Dynamics" }),
    ];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.getByText("1. Kinematics")).toBeInTheDocument();
    expect(screen.getByText("2. Dynamics")).toBeInTheDocument();
  });

  it("shows progress indicator and color class from helpers", () => {
    const chapters = [makeChapter({ id: 1, name: "Kinematics" })];
    const progress = {
      1: makeProgress(1, { completedTopicIds: [10, 11] }),
    };

    mockGetProgressIndicator.mockReturnValue("◐");
    mockGetProgressColorClass.mockReturnValue("text-yellow-500");

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={progress}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    const indicator = screen.getByText("◐");
    expect(indicator).toHaveClass("text-yellow-500");
    expect(mockGetProgressIndicator).toHaveBeenCalledWith(progress[1]);
    expect(mockGetProgressColorClass).toHaveBeenCalledWith(progress[1]);
  });

  it("shows completed/total topic counts", () => {
    const chapters = [
      makeChapter({
        id: 1,
        name: "Kinematics",
        topics: [
          { id: 10, code: "T1", name: "Velocity", chapterId: 1 },
          { id: 11, code: "T2", name: "Acceleration", chapterId: 1 },
          { id: 12, code: "T3", name: "Displacement", chapterId: 1 },
        ],
      }),
    ];
    const progress = {
      1: makeProgress(1, { completedTopicIds: [10] }),
    };

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={progress}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("shows 0/N when chapter has no progress entry", () => {
    const chapters = [
      makeChapter({
        id: 1,
        name: "Kinematics",
        topics: [
          { id: 10, code: "T1", name: "Velocity", chapterId: 1 },
        ],
      }),
    ];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.getByText("0/1")).toBeInTheDocument();
  });

  it("displays last taught date from formatDate", () => {
    const chapters = [makeChapter({ id: 1, name: "Kinematics" })];
    const progress = {
      1: makeProgress(1, { lastTaughtDate: "2026-02-10" }),
    };
    mockFormatDate.mockReturnValue("Feb 10");

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={progress}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.getByText(/Last taught: Feb 10/)).toBeInTheDocument();
    expect(mockFormatDate).toHaveBeenCalledWith("2026-02-10");
  });

  it("displays time spent when totalTimeMinutes > 0", () => {
    const chapters = [makeChapter({ id: 1, name: "Kinematics" })];
    const progress = {
      1: makeProgress(1, { totalTimeMinutes: 90 }),
    };
    mockFormatDuration.mockReturnValue("1h 30m");

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={progress}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.getByText(/Time: 1h 30m/)).toBeInTheDocument();
    expect(mockFormatDuration).toHaveBeenCalledWith(90);
  });

  it("hides time when totalTimeMinutes is 0", () => {
    const chapters = [makeChapter({ id: 1, name: "Kinematics" })];
    const progress = {
      1: makeProgress(1, { totalTimeMinutes: 0 }),
    };

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={progress}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.queryByText(/Time:/)).not.toBeInTheDocument();
  });

  it("hides time when no progress entry exists", () => {
    const chapters = [makeChapter({ id: 1, name: "Kinematics" })];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.queryByText(/Time:/)).not.toBeInTheDocument();
  });

  it("calls onToggleChapter when header button is clicked", async () => {
    const onToggle = vi.fn();
    const chapters = [makeChapter({ id: 42, name: "Thermodynamics" })];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={onToggle}
      />
    );

    await user.click(screen.getByText("1. Thermodynamics"));
    expect(onToggle).toHaveBeenCalledWith(42);
  });

  it("does not show topics when chapter is collapsed", () => {
    const chapters = [
      makeChapter({
        id: 1,
        name: "Kinematics",
        topics: [{ id: 10, code: "T1", name: "Velocity", chapterId: 1 }],
      }),
    ];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(screen.queryByTestId("topic-row-10")).not.toBeInTheDocument();
  });

  it("shows topics when chapter is expanded", () => {
    const chapters = [
      makeChapter({
        id: 1,
        name: "Kinematics",
        topics: [
          { id: 10, code: "T1", name: "Velocity", chapterId: 1 },
          { id: 11, code: "T2", name: "Acceleration", chapterId: 1 },
        ],
      }),
    ];
    const progress = {
      1: makeProgress(1, { completedTopicIds: [10] }),
    };

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={progress}
        expandedChapterIds={[1]}
        onToggleChapter={vi.fn()}
      />
    );

    const topic10 = screen.getByTestId("topic-row-10");
    expect(topic10).toHaveAttribute("data-completed", "true");

    const topic11 = screen.getByTestId("topic-row-11");
    expect(topic11).toHaveAttribute("data-completed", "false");
  });

  it("shows 'No topics defined' when expanded chapter has no topics", () => {
    const chapters = [makeChapter({ id: 1, name: "Empty Chapter", topics: [] })];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[1]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(
      screen.getByText("No topics defined for this chapter")
    ).toBeInTheDocument();
  });

  it("applies rotate-90 class to arrow when expanded", () => {
    const chapters = [
      makeChapter({ id: 1, name: "Ch1" }),
      makeChapter({ id: 2, name: "Ch2" }),
    ];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[1]}
        onToggleChapter={vi.fn()}
      />
    );

    const arrows = screen.getAllByText("▶");
    // Chapter 1 is expanded
    expect(arrows[0]).toHaveClass("rotate-90");
    // Chapter 2 is collapsed
    expect(arrows[1]).not.toHaveClass("rotate-90");
  });

  it("passes isCompleted=false when no progress entry for expanded chapter", () => {
    const chapters = [
      makeChapter({
        id: 1,
        name: "Kinematics",
        topics: [{ id: 10, code: "T1", name: "Velocity", chapterId: 1 }],
      }),
    ];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[1]}
        onToggleChapter={vi.fn()}
      />
    );

    const topicRow = screen.getByTestId("topic-row-10");
    expect(topicRow).toHaveAttribute("data-completed", "false");
  });

  it("renders multiple chapters with independent expand state", () => {
    const chapters = [
      makeChapter({
        id: 1,
        name: "Kinematics",
        topics: [{ id: 10, code: "T1", name: "Velocity", chapterId: 1 }],
      }),
      makeChapter({
        id: 2,
        name: "Dynamics",
        topics: [{ id: 20, code: "T2", name: "Force", chapterId: 2 }],
      }),
    ];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[2]}
        onToggleChapter={vi.fn()}
      />
    );

    // Chapter 1 topics not shown (collapsed)
    expect(screen.queryByTestId("topic-row-10")).not.toBeInTheDocument();
    // Chapter 2 topics shown (expanded)
    expect(screen.getByTestId("topic-row-20")).toBeInTheDocument();
  });

  it("calls formatDate with null when no lastTaughtDate", () => {
    const chapters = [makeChapter({ id: 1, name: "Kinematics" })];

    render(
      <ChapterAccordion
        chapters={chapters}
        progress={{}}
        expandedChapterIds={[]}
        onToggleChapter={vi.fn()}
      />
    );

    expect(mockFormatDate).toHaveBeenCalledWith(null);
  });
});
