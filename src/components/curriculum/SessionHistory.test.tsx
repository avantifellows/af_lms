import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SessionHistory from "./SessionHistory";
import type { TeachingSession } from "@/types/curriculum";

vi.mock("@/lib/curriculum-helpers", () => ({
  formatDuration: vi.fn((minutes: number) => `${minutes}m`),
}));

function makeSession(overrides: Partial<TeachingSession> = {}): TeachingSession {
  return {
    id: "s1",
    date: "2026-01-15",
    durationMinutes: 45,
    topicIds: [1, 2],
    topics: [
      { topicId: 1, topicName: "Newton's Laws", chapterName: "Mechanics" },
      { topicId: 2, topicName: "Friction", chapterName: "Mechanics" },
    ],
    ...overrides,
  };
}

describe("SessionHistory", () => {
  it("renders empty state when no sessions", () => {
    render(<SessionHistory sessions={[]} />);
    expect(screen.getByText("No teaching sessions logged yet.")).toBeInTheDocument();
    expect(screen.getByText(/Click .+ Log Session/)).toBeInTheDocument();
  });

  it("renders a single session with date, duration, and topics", () => {
    render(<SessionHistory sessions={[makeSession()]} />);

    // Date formatted via toLocaleDateString("en-IN", ...) — check it exists
    // "Thu, 15 Jan 2026" or similar locale-dependent format
    const dateEl = screen.getByText(/Jan/);
    expect(dateEl).toBeInTheDocument();

    // Duration uses mocked formatDuration
    expect(screen.getByText("Duration: 45m")).toBeInTheDocument();

    // Topics header
    expect(screen.getByText("Topics covered")).toBeInTheDocument();

    // Chapter name
    expect(screen.getByText("Mechanics")).toBeInTheDocument();

    // Topic names
    expect(screen.getByText("Newton's Laws")).toBeInTheDocument();
    expect(screen.getByText("Friction")).toBeInTheDocument();
  });

  it("groups topics by chapter within a session", () => {
    const session = makeSession({
      topics: [
        { topicId: 1, topicName: "Speed", chapterName: "Kinematics" },
        { topicId: 2, topicName: "Acceleration", chapterName: "Kinematics" },
        { topicId: 3, topicName: "Ohm's Law", chapterName: "Electricity" },
      ],
    });
    render(<SessionHistory sessions={[session]} />);

    expect(screen.getByText("Kinematics")).toBeInTheDocument();
    expect(screen.getByText("Electricity")).toBeInTheDocument();
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("Acceleration")).toBeInTheDocument();
    expect(screen.getByText("Ohm's Law")).toBeInTheDocument();
  });

  it("renders multiple sessions", () => {
    const sessions = [
      makeSession({ id: "s1", date: "2026-01-15", durationMinutes: 45 }),
      makeSession({
        id: "s2",
        date: "2026-01-20",
        durationMinutes: 60,
        topics: [
          { topicId: 3, topicName: "Thermodynamics", chapterName: "Heat" },
        ],
      }),
    ];
    render(<SessionHistory sessions={sessions} />);

    // Both durations rendered
    expect(screen.getByText("Duration: 45m")).toBeInTheDocument();
    expect(screen.getByText("Duration: 60m")).toBeInTheDocument();

    // Both chapter groups
    expect(screen.getByText("Mechanics")).toBeInTheDocument();
    expect(screen.getByText("Heat")).toBeInTheDocument();
  });

  it("renders multiple chapters from same session separately", () => {
    const session = makeSession({
      topics: [
        { topicId: 1, topicName: "Momentum", chapterName: "Mechanics" },
        { topicId: 2, topicName: "Waves", chapterName: "Oscillations" },
        { topicId: 3, topicName: "Sound", chapterName: "Oscillations" },
      ],
    });
    render(<SessionHistory sessions={[session]} />);

    expect(screen.getByText("Mechanics")).toBeInTheDocument();
    expect(screen.getByText("Oscillations")).toBeInTheDocument();

    // Check topics under each chapter
    expect(screen.getByText("Momentum")).toBeInTheDocument();
    expect(screen.getByText("Waves")).toBeInTheDocument();
    expect(screen.getByText("Sound")).toBeInTheDocument();
  });
});
