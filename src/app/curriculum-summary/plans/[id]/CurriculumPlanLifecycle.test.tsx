import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush, mockRefresh } = vi.hoisted(() => ({ mockPush: vi.fn(), mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: mockRefresh }) }));

import type { CurriculumPlanChapter } from "@/lib/curriculum-plans";
import CurriculumPlanLifecycle from "./CurriculumPlanLifecycle";

function chapter(chapterId: number, chapterName: string, dueDate: string | null): CurriculumPlanChapter {
  return { chapterId, chapterCode: `C${chapterId}`, chapterName, subjectId: 4, subjectName: "Physics", dueDate, testDate: null };
}

const CHAPTERS = [chapter(1, "Motion", "2026-06-30"), chapter(2, "Gravitation", null), chapter(3, "Waves", null)];

function renderLifecycle(overrides: Partial<Parameters<typeof CurriculumPlanLifecycle>[0]> = {}) {
  return render(
    <CurriculumPlanLifecycle
      planId={7}
      displayStatus="draft"
      academicYear="2026-2027"
      grade={11}
      chapters={CHAPTERS}
      readOnly={false}
      {...overrides}
    />
  );
}

function respond(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CurriculumPlanLifecycle", () => {
  it.each([
    ["active", "Active"],
    ["closed", "Closed"],
  ] as const)("shows a %s plan's status with no lifecycle controls", (displayStatus, label) => {
    renderLifecycle({ displayStatus });

    expect(screen.getByTestId("plan-status")).toHaveTextContent(label);
    expect(screen.queryByRole("button", { name: "Activate plan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete plan" })).not.toBeInTheDocument();
  });

  it("disables Activate and Delete for a read-only Admin", () => {
    renderLifecycle({ readOnly: true });

    expect(screen.getByTestId("plan-status")).toHaveTextContent("Draft");
    expect(screen.getByRole("button", { name: "Activate plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete plan" })).toBeDisabled();
  });

  it("lists undated Chapters before activating, then activates and refreshes", async () => {
    const fetchMock = respond({ plan: { id: 7 }, warnings: [] });
    renderLifecycle();

    fireEvent.click(screen.getByRole("button", { name: "Activate plan" }));
    const confirm = screen.getByTestId("plan-activate-confirm");
    expect(confirm).toHaveTextContent("2 Chapters have no Chapter Due Date and will show as Not in plan:");
    expect(within(confirm).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Gravitation",
      "Waves",
    ]);
    fireEvent.click(within(confirm).getByRole("button", { name: "Activate anyway" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Plan activated.");
    expect(fetchMock).toHaveBeenCalledWith("/api/curriculum/plans/7/activate", { method: "POST" });
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByTestId("plan-activate-confirm")).not.toBeInTheDocument();
  });

  it("says when one Chapter, or none, is undated", () => {
    const { unmount } = renderLifecycle({ chapters: [chapter(1, "Motion", null)] });
    fireEvent.click(screen.getByRole("button", { name: "Activate plan" }));
    expect(screen.getByTestId("plan-activate-confirm")).toHaveTextContent("1 Chapter has no Chapter Due Date");
    unmount();

    renderLifecycle({ chapters: [chapter(1, "Motion", "2026-06-30")] });
    fireEvent.click(screen.getByRole("button", { name: "Activate plan" }));
    expect(screen.getByText("Every Chapter has a Chapter Due Date.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm activation" })).toBeInTheDocument();
  });

  it("shows the server's error when activation is refused, and Cancel closes the confirmation", async () => {
    respond({ error: "Only Draft plans can be activated" }, false);
    renderLifecycle();

    fireEvent.click(screen.getByRole("button", { name: "Activate plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Activate anyway" }));

    expect(await screen.findByTestId("plan-lifecycle-error")).toHaveTextContent("Only Draft plans can be activated");
    expect(mockRefresh).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByTestId("plan-activate-confirm")).not.toBeInTheDocument();
  });

  it("falls back to a generic error when activation fails without a message or the request fails", async () => {
    respond({}, false);
    const { unmount } = renderLifecycle();
    fireEvent.click(screen.getByRole("button", { name: "Activate plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Activate anyway" }));
    expect(await screen.findByTestId("plan-lifecycle-error")).toHaveTextContent("Could not activate the plan");
    unmount();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderLifecycle();
    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(await screen.findByTestId("plan-lifecycle-error")).toHaveTextContent("Could not delete the plan");
  });

  it("deletes a Draft after confirmation and returns to its year and Grade's plan list", async () => {
    const fetchMock = respond({ deleted: true });
    renderLifecycle();

    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    expect(screen.getByTestId("plan-delete-confirm")).toHaveTextContent(
      "Delete this Draft plan? Its Chapter dates and Plan Assignments are removed too."
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    await vi.waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/curriculum-summary/plans?academic_year=2026-2027&grade=11")
    );
    expect(fetchMock).toHaveBeenCalledWith("/api/curriculum/plans/7", { method: "DELETE" });
  });

  it("shows the server's error when deletion is refused", async () => {
    respond({ error: "Only Draft plans can be deleted" }, false);
    renderLifecycle();

    fireEvent.click(screen.getByRole("button", { name: "Delete plan" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));

    expect(await screen.findByTestId("plan-lifecycle-error")).toHaveTextContent("Only Draft plans can be deleted");
    expect(mockPush).not.toHaveBeenCalled();
  });
});
