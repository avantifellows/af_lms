import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The children have their own suites; stub them to their callbacks.
vi.mock("./CycleCard", () => ({
  default: ({ cycle, focused, onAnalyze, onExtended }: {
    cycle: { setupRunId: string; cycleLabel: string };
    focused: boolean;
    onAnalyze: (quizId: string, name: string) => void;
    onExtended: (message: string, variant: "success" | "info") => void;
  }) => (
    <div data-testid="cycle" data-focused={focused}>
      {cycle.cycleLabel}
      <button onClick={() => onAnalyze("q1", "Indrani Khan")}>analyze</button>
      <button onClick={() => onExtended("Extended to tomorrow", "success")}>extended</button>
    </div>
  ),
}));
vi.mock("./SetupModal", () => ({
  default: ({ onDone, onExtendInstead }: {
    onDone: (r: { cycleLabel: string; createdCount: number; failedCount: number }) => void;
    onExtendInstead: (id: string) => void;
  }) => (
    <div>
      setup open
      <button onClick={() => onDone({ cycleLabel: "Oct 2026", createdCount: 2, failedCount: 0 })}>done</button>
      <button onClick={() => onDone({ cycleLabel: "Oct 2026", createdCount: 1, failedCount: 1 })}>partly done</button>
      <button onClick={() => onExtendInstead("run-1")}>extend instead</button>
    </div>
  ),
}));
vi.mock("./AnalysisModal", () => ({
  default: ({ teacherName, onClose }: { teacherName: string; onClose: () => void }) => (
    <div>
      analysis of {teacherName}
      <button onClick={onClose}>close analysis</button>
    </div>
  ),
}));

import TeacherFeedbackTab from "./TeacherFeedbackTab";

const CYCLES = [{ setupRunId: "run-1", cycleLabel: "Sep 2026" }];

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body)));
}

let cyclesResponse: () => Promise<Response>;

beforeEach(() => {
  cyclesResponse = () => json({ cycles: CYCLES });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string) => (input.includes("/cycles") ? cyclesResponse() : json({ centres: [] })))
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("TeacherFeedbackTab", () => {
  it("loads the centre's rounds and centres", async () => {
    render(<TeacherFeedbackTab schoolCode="59324" canEdit centreId={7} />);

    expect(await screen.findByText("Sep 2026")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/teacher-feedback/cycles?school_code=59324&centre_id=7", expect.anything());
    expect(fetch).toHaveBeenCalledWith("/api/teacher-feedback/centres?school_code=59324&centre_id=7", expect.anything());
  });

  it("shows an empty state, and a toast when loading fails", async () => {
    cyclesResponse = () => json({ cycles: [] });
    const { unmount } = render(<TeacherFeedbackTab schoolCode="59324" canEdit />);
    expect(await screen.findByText(/No feedback rounds yet/)).toBeInTheDocument();
    unmount();

    cyclesResponse = () => Promise.reject(new Error("down"));
    vi.mocked(fetch).mockImplementation(() => Promise.reject(new Error("down")));
    render(<TeacherFeedbackTab schoolCode="59324" canEdit />);
    expect(await screen.findByText("Failed to load feedback rounds")).toBeInTheDocument();
  });

  it("hides setup from view-only users", async () => {
    render(<TeacherFeedbackTab schoolCode="59324" canEdit={false} />);
    await screen.findByText("Sep 2026");
    expect(screen.queryByRole("button", { name: /Set Up Feedback/ })).not.toBeInTheDocument();
  });

  it("reports setup results and reloads the rounds", async () => {
    render(<TeacherFeedbackTab schoolCode="59324" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: /Set Up Feedback/ }));
    fireEvent.click(screen.getByRole("button", { name: "done" }));

    expect(await screen.findByText("Created 2 feedback form(s) for Oct 2026")).toBeInTheDocument();
    expect(screen.queryByText("setup open")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Set Up Feedback/ }));
    fireEvent.click(screen.getByRole("button", { name: "partly done" }));
    expect(await screen.findByText("Created 1, 1 failed")).toBeInTheDocument();
  });

  it("sends the PM from the setup nudge to the round to extend", async () => {
    render(<TeacherFeedbackTab schoolCode="59324" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: /Set Up Feedback/ }));
    fireEvent.click(screen.getByRole("button", { name: "extend instead" }));

    expect(screen.getByTestId("cycle")).toHaveAttribute("data-focused", "true");
    expect(screen.queryByText("setup open")).not.toBeInTheDocument();
  });

  it("opens analysis and toasts an extend", async () => {
    render(<TeacherFeedbackTab schoolCode="59324" canEdit />);
    fireEvent.click(await screen.findByRole("button", { name: "analyze" }));
    expect(screen.getByText("analysis of Indrani Khan")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "close analysis" }));
    expect(screen.queryByText(/analysis of/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "extended" }));
    expect(await screen.findByText("Extended to tomorrow")).toBeInTheDocument();
  });

  it("refreshes in the background without a toast on failure", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<TeacherFeedbackTab schoolCode="59324" canEdit />);
    await screen.findByText("Sep 2026");
    const before = vi.mocked(fetch).mock.calls.length;

    cyclesResponse = () => Promise.reject(new Error("blip"));
    await act(async () => {
      vi.advanceTimersByTime(40_000);
    });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBe(before + 1));
    expect(screen.queryByText("Failed to load feedback rounds")).not.toBeInTheDocument();
    expect(screen.getByText("Sep 2026")).toBeInTheDocument();
  });
});
