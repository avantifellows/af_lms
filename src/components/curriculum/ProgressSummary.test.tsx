import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import ProgressSummary from "./ProgressSummary";
import type { Chapter, ChapterProgress } from "@/types/curriculum";

vi.mock("@/lib/curriculum-helpers", () => ({
  calculateStats: vi.fn(),
  formatDuration: vi.fn(),
}));

import { calculateStats, formatDuration } from "@/lib/curriculum-helpers";

const mockCalculateStats = vi.mocked(calculateStats);
const mockFormatDuration = vi.mocked(formatDuration);

const chapters: Chapter[] = [
  { id: 1, code: "C1", name: "Ch 1", grade: 11, subjectId: 1, subjectName: "Physics", topics: [] },
];

const progress: Record<number, ChapterProgress> = {};

describe("ProgressSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCalculateStats.mockReturnValue({
      chaptersCompleted: 2,
      totalChapters: 5,
      topicsCovered: 8,
      totalTopics: 20,
      totalTimeMinutes: 90,
    });
    mockFormatDuration.mockReturnValue("1h 30m");
  });

  it("renders chapters completed with total", () => {
    render(<ProgressSummary chapters={chapters} progress={progress} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("/5")).toBeInTheDocument();
    expect(screen.getByText("chapters completed")).toBeInTheDocument();
  });

  it("renders topics covered with total", () => {
    render(<ProgressSummary chapters={chapters} progress={progress} />);
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("/20")).toBeInTheDocument();
    expect(screen.getByText("topics covered")).toBeInTheDocument();
  });

  it("renders total time from formatDuration", () => {
    render(<ProgressSummary chapters={chapters} progress={progress} />);
    expect(screen.getByText("1h 30m")).toBeInTheDocument();
    expect(screen.getByText("total time taught")).toBeInTheDocument();
    expect(mockFormatDuration).toHaveBeenCalledWith(90);
  });

  it("passes chapters and progress to calculateStats", () => {
    render(<ProgressSummary chapters={chapters} progress={progress} />);
    expect(mockCalculateStats).toHaveBeenCalledWith(chapters, progress);
  });

  it("renders zero stats correctly", () => {
    mockCalculateStats.mockReturnValue({
      chaptersCompleted: 0,
      totalChapters: 0,
      topicsCovered: 0,
      totalTopics: 0,
      totalTimeMinutes: 0,
    });
    mockFormatDuration.mockReturnValue("0m");

    render(<ProgressSummary chapters={[]} progress={{}} />);
    expect(screen.getByText("0m")).toBeInTheDocument();
    expect(screen.getByText("chapters completed")).toBeInTheDocument();
    expect(screen.getByText("topics covered")).toBeInTheDocument();
    expect(screen.getByText("total time taught")).toBeInTheDocument();
  });
});
