import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SessionHistory from "./SessionHistory";
import type { LmsCurriculumLog } from "@/types/curriculum";

vi.mock("@/lib/curriculum-helpers", () => ({
  formatDuration: vi.fn((minutes: number) => `${minutes}m`),
}));

function makeLog(overrides: Partial<LmsCurriculumLog> = {}): LmsCurriculumLog {
  return {
    id: 1,
    logDate: "2026-01-15",
    durationMinutes: 45,
    programId: 1,
    gradeId: 3,
    subjectId: 4,
    examTrack: "jee_main",
    topics: [
      { topicId: 1, topicName: "Newton's Laws", chapterId: 1, chapterName: "Mechanics" },
      { topicId: 2, topicName: "Friction", chapterId: 1, chapterName: "Mechanics" },
    ],
    isEditable: true,
    createdAt: "2026-01-15T10:00:00.000Z",
    updatedAt: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("SessionHistory", () => {
  it("renders empty state when no LMS Curriculum Logs exist", () => {
    render(<SessionHistory logs={[]} />);
    expect(screen.getByText("No classes logged yet.")).toBeInTheDocument();
    expect(screen.getByText(/Click .+ Log a class/)).toBeInTheDocument();
  });

  it("renders a single LMS Curriculum Log with date, duration, and topics", () => {
    render(<SessionHistory logs={[makeLog()]} />);

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
    const log = makeLog({
      topics: [
        { topicId: 1, topicName: "Speed", chapterId: 1, chapterName: "Kinematics" },
        { topicId: 2, topicName: "Acceleration", chapterId: 1, chapterName: "Kinematics" },
        { topicId: 3, topicName: "Ohm's Law", chapterId: 2, chapterName: "Electricity" },
      ],
    });
    render(<SessionHistory logs={[log]} />);

    expect(screen.getByText("Kinematics")).toBeInTheDocument();
    expect(screen.getByText("Electricity")).toBeInTheDocument();
    expect(screen.getByText("Speed")).toBeInTheDocument();
    expect(screen.getByText("Acceleration")).toBeInTheDocument();
    expect(screen.getByText("Ohm's Law")).toBeInTheDocument();
  });

  it("renders multiple LMS Curriculum Logs", () => {
    const logs = [
      makeLog({ id: 1, logDate: "2026-01-15", durationMinutes: 45 }),
      makeLog({
        id: 2,
        logDate: "2026-01-20",
        durationMinutes: 60,
        topics: [
          { topicId: 3, topicName: "Thermodynamics", chapterId: 3, chapterName: "Heat" },
        ],
      }),
    ];
    render(<SessionHistory logs={logs} />);

    // Both durations rendered
    expect(screen.getByText("Duration: 45m")).toBeInTheDocument();
    expect(screen.getByText("Duration: 60m")).toBeInTheDocument();

    // Both chapter groups
    expect(screen.getByText("Mechanics")).toBeInTheDocument();
    expect(screen.getByText("Heat")).toBeInTheDocument();
  });

  it("renders multiple chapters from same session separately", () => {
    const log = makeLog({
      topics: [
        { topicId: 1, topicName: "Momentum", chapterId: 1, chapterName: "Mechanics" },
        { topicId: 2, topicName: "Waves", chapterId: 2, chapterName: "Oscillations" },
        { topicId: 3, topicName: "Sound", chapterId: 2, chapterName: "Oscillations" },
      ],
    });
    render(<SessionHistory logs={[log]} />);

    expect(screen.getByText("Mechanics")).toBeInTheDocument();
    expect(screen.getByText("Oscillations")).toBeInTheDocument();

    // Check topics under each chapter
    expect(screen.getByText("Momentum")).toBeInTheDocument();
    expect(screen.getByText("Waves")).toBeInTheDocument();
    expect(screen.getByText("Sound")).toBeInTheDocument();
  });

  it("opens editable LMS Curriculum Logs and disables historical log edit controls", async () => {
    const user = userEvent.setup();
    const onEditLog = vi.fn();
    const onDeleteLog = vi.fn();
    const editableLog = makeLog({ id: 1, isEditable: true });
    const historicalLog = makeLog({
      id: 2,
      logDate: "2026-01-20",
      isEditable: false,
    });

    render(
      <SessionHistory
        logs={[editableLog, historicalLog]}
        canEdit
        onEditLog={onEditLog}
        onDeleteLog={onDeleteLog}
      />
    );

    const editButtons = screen.getAllByRole("button", { name: /edit log/i });
    expect(editButtons[0]).toBeEnabled();
    expect(editButtons[1]).toBeDisabled();
    const deleteButtons = screen.getAllByRole("button", { name: /delete log/i });
    expect(deleteButtons[0]).toBeEnabled();
    expect(deleteButtons[1]).toBeEnabled();
    expect(screen.getByText("Historical log")).toBeInTheDocument();

    await user.click(editButtons[0]);
    expect(onEditLog).toHaveBeenCalledWith(editableLog);
  });

  it("confirms before requesting LMS Curriculum Log deletion", async () => {
    const user = userEvent.setup();
    const onDeleteLog = vi.fn();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const log = makeLog();

    render(<SessionHistory logs={[log]} canEdit onDeleteLog={onDeleteLog} />);

    await user.click(screen.getByRole("button", { name: /delete log/i }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Delete this LMS Curriculum Log? It will be removed from Logs and Progress."
    );
    expect(onDeleteLog).toHaveBeenCalledWith(log);
  });

  it("does not request deletion when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const onDeleteLog = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<SessionHistory logs={[makeLog()]} canEdit onDeleteLog={onDeleteLog} />);

    await user.click(screen.getByRole("button", { name: /delete log/i }));

    expect(onDeleteLog).not.toHaveBeenCalled();
  });

  it("hides edit and delete controls for read-only users", () => {
    render(
      <SessionHistory
        logs={[makeLog()]}
        canEdit={false}
        onEditLog={vi.fn()}
        onDeleteLog={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /edit log/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete log/i })).not.toBeInTheDocument();
  });
});
