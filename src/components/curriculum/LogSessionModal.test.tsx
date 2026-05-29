import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogSessionModal from "./LogSessionModal";
import type { Chapter, ChapterProgress } from "@/types/curriculum";

vi.mock("@/lib/curriculum-date-helpers", () => ({
  getTodayIST: () => "2026-02-15",
}));

const chapters: Chapter[] = [
  {
    id: 1,
    code: "PH01",
    name: "Kinematics",
    grade: 11,
    subjectId: 4,
    subjectName: "Physics",
    prescribedMinutes: 90,
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
    prescribedMinutes: 60,
    topics: [{ id: 201, code: "PH02.01", name: "Newton's Laws", chapterId: 2 }],
  },
];

const progress: Record<number, ChapterProgress> = {
  1: {
    chapterId: 1,
    completedTopicIds: [101],
    totalTimeMinutes: 60,
    lastTaughtDate: "2026-02-10",
    allTopicsCovered: false,
    isChapterComplete: true,
    chapterCompletedDate: "2026-02-10T00:00:00.000Z",
  },
};

function renderModal(
  props: Partial<{
    onClose: () => void;
    onSave: (date: string, durationMinutes: number, topicIds: number[]) => void;
    isSaving: boolean;
    error: string | null;
  }> = {}
) {
  return render(
    <LogSessionModal
      chapters={chapters}
      progress={progress}
      onClose={props.onClose ?? vi.fn()}
      onSave={props.onSave ?? vi.fn()}
      isSaving={props.isSaving}
      error={props.error}
    />
  );
}

describe("LogSessionModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("alert", vi.fn());
  });

  it("renders topic-backed log controls with today's IST date", () => {
    renderModal();

    expect(screen.getByText("Log Teaching Session")).toBeInTheDocument();
    expect((document.querySelector('input[type="date"]') as HTMLInputElement).value).toBe(
      "2026-02-15"
    );
    expect(screen.getByText("Select topics covered")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Log" })).toBeDisabled();
    expect(screen.queryByText("Will Complete")).not.toBeInTheDocument();
  });

  it("selects topics and submits backend log fields only", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderModal({ onSave });

    await user.click(screen.getByText("Kinematics"));
    const topicLabel = screen.getByText("Motion in a Straight Line").closest("label")!;
    await user.click(within(topicLabel).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save Log" }));

    expect(onSave).toHaveBeenCalledWith("2026-02-15", 60, [101]);
  });

  it("calculates duration from hours and minutes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderModal({ onSave });

    const [hours, minutes] = screen.getAllByRole("spinbutton");
    await user.clear(hours);
    await user.type(hours, "2");
    await user.clear(minutes);
    await user.type(minutes, "30");

    await user.click(screen.getByText("Laws of Motion"));
    const topicLabel = screen.getByText("Newton's Laws").closest("label")!;
    await user.click(within(topicLabel).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Save Log" }));

    expect(onSave).toHaveBeenCalledWith("2026-02-15", 150, [201]);
  });

  it("shows already covered and completed context without enabling completion mutation", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText("✓ Complete")).toBeInTheDocument();
    expect(screen.getByText("Kinematics").className).toContain("line-through");
    await user.click(screen.getByText("Kinematics"));

    expect(screen.getByText("✓ covered")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("shows save errors and saving state from the backend mutation", () => {
    renderModal({ isSaving: true, error: "Your permissions changed. Reload the page before trying again." });

    expect(screen.getByText("Saving...")).toBeDisabled();
    expect(
      screen.getByText("Your permissions changed. Reload the page before trying again.")
    ).toBeInTheDocument();
  });
});
