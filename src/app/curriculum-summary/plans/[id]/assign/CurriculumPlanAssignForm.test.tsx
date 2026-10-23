import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }) }));

import type { EligibleCentre, PlanAssignmentPreview } from "@/lib/curriculum-plan-assignments";
import CurriculumPlanAssignForm from "./CurriculumPlanAssignForm";

function centre(overrides: Partial<EligibleCentre> & Pick<EligibleCentre, "centreId" | "centreName">): EligibleCentre {
  return {
    schoolName: `${overrides.centreName} School`,
    schoolCode: `S${overrides.centreId}`,
    region: "NORTH",
    programName: "JNV Nodal",
    mappedTracks: ["jee_main"],
    uncoveredTracks: [],
    currentPlan: null,
    ...overrides,
  };
}

const CENTRES: EligibleCentre[] = [
  centre({ centreId: 1, centreName: "Anand", currentPlan: { id: 7, title: "G11 Others" } }),
  centre({ centreId: 2, centreName: "Bhuj", currentPlan: { id: 8, title: "G11 HYD" } }),
  centre({ centreId: 3, centreName: "Surat", region: "" }),
];

function preview(overrides: Partial<PlanAssignmentPreview> = {}): PlanAssignmentPreview {
  return { centres: [], moveCount: 0, removeCount: 0, removedCentres: [], ...overrides };
}

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

// Resolvable preview responses, so a test can look at the form while the preview is loading.
function deferredFetch() {
  const pending: Array<(response: Response) => void> = [];
  const fetchMock = vi.fn((url: string) => {
    if (url.endsWith("/preview")) {
      return new Promise<Response>((resolve) => pending.push(resolve));
    }
    return Promise.resolve(jsonResponse({ ok: true }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    // Answers the latest preview request; earlier ones were aborted by a newer selection.
    async resolveNext(response: Response) {
      await waitFor(() => expect(pending.length).toBeGreaterThan(0));
      const latest = pending.pop()!;
      pending.length = 0;
      await act(async () => latest(response));
    },
  };
}

const saveButton = () => screen.getByRole("button", { name: "Save assignments" });

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CurriculumPlanAssignForm", () => {
  it("ticks the plan's current Centres and groups Centres by region", async () => {
    const { resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);
    await resolveNext(jsonResponse({ preview: preview() }));

    expect(screen.getByRole("checkbox", { name: "Anand" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Bhuj" })).not.toBeChecked();
    expect(screen.getByRole("group", { name: "NORTH" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "No region" })).toBeInTheDocument();
    expect(screen.getByText("On G11 HYD")).toBeInTheDocument();
    expect(screen.getByText("1 Centre ticked")).toBeInTheDocument();
  });

  it("keeps Save disabled until the move preview has loaded", async () => {
    const { resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);

    expect(screen.getByText("Checking moves…")).toBeInTheDocument();
    expect(saveButton()).toBeDisabled();

    await resolveNext(jsonResponse({ preview: preview() }));

    expect(screen.getByTestId("assign-move-count")).toHaveTextContent("No Centres move from another plan");
    expect(saveButton()).toBeEnabled();
  });

  it("shows an error instead of 'Checking moves…' when the preview fails, and retries", async () => {
    const { resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);
    await resolveNext(jsonResponse({ error: "Internal error" }, false));

    expect(screen.queryByText("Checking moves…")).not.toBeInTheDocument();
    expect(screen.getByTestId("assign-preview-error")).toHaveTextContent("Could not check moves and removals");
    expect(saveButton()).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Checking moves…")).toBeInTheDocument();
    await resolveNext(jsonResponse({ preview: preview() }));
    expect(saveButton()).toBeEnabled();
  });

  it("treats a network failure of the preview as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);

    expect(await screen.findByTestId("assign-preview-error")).toBeInTheDocument();
  });

  it("names the moves, removals and Centres no longer eligible that saving will remove", async () => {
    const { resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);
    await resolveNext(jsonResponse({ preview: preview() }));

    fireEvent.click(screen.getByRole("checkbox", { name: "Bhuj" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Anand" }));
    await resolveNext(
      jsonResponse({
        preview: preview({
          centres: [
            {
              centreId: 2,
              centreName: "Bhuj",
              currentPlan: { id: 8, title: "G11 HYD" },
              moves: true,
              uncoveredTracks: ["neet"],
            },
          ],
          moveCount: 1,
          removeCount: 2,
          removedCentres: [
            { centreId: 1, centreName: "Anand", eligible: true },
            { centreId: 9, centreName: "Vapi", eligible: false },
          ],
        }),
      })
    );

    expect(screen.getByTestId("assign-move-count")).toHaveTextContent(
      "1 Centre moves from another plan · 2 assignments removed"
    );
    expect(screen.getByTestId("assign-ineligible-removals")).toHaveTextContent(
      "Saving also removes 1 Centre no longer eligible for this plan: Vapi"
    );
    expect(screen.getByText("Moves from G11 HYD")).toBeInTheDocument();
    expect(screen.getByText("⚠ not covered: NEET")).toBeInTheDocument();
  });

  it("saves the ticked Centres and reloads the preview", async () => {
    const { fetchMock, resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);
    await resolveNext(jsonResponse({ preview: preview() }));

    fireEvent.click(saveButton());

    expect(await screen.findByRole("status")).toHaveTextContent("Assignments saved.");
    expect(fetchMock).toHaveBeenCalledWith("/api/curriculum/plans/7/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ centre_ids: [1] }),
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.getByText("Checking moves…")).toBeInTheDocument();
  });

  it.each([
    [jsonResponse({ errors: [{ message: "Centre 9 is not an eligible Centre for this plan" }] }, false), "Centre 9 is not an eligible Centre for this plan"],
    [jsonResponse({ error: "A Centre was assigned to another plan at the same time" }, false), "A Centre was assigned to another plan at the same time"],
    [jsonResponse({}, false), "Could not save the assignments"],
  ])("shows the save error", async (response, message) => {
    const { fetchMock, resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);
    await resolveNext(jsonResponse({ preview: preview() }));
    fetchMock.mockImplementationOnce(() => Promise.resolve(response));

    fireEvent.click(saveButton());

    expect(await screen.findByTestId("assign-error")).toHaveTextContent(message);
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("shows a save error when the request fails", async () => {
    const { fetchMock, resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly={false} />);
    await resolveNext(jsonResponse({ preview: preview() }));
    fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError("Failed to fetch")));

    fireEvent.click(saveButton());

    expect(await screen.findByTestId("assign-error")).toHaveTextContent("Could not save the assignments");
  });

  it("is read-only for a read-only Admin", async () => {
    const { resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={CENTRES} readOnly />);
    await resolveNext(jsonResponse({ preview: preview() }));

    expect(saveButton()).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Bhuj" })).toBeDisabled();
  });

  it("explains when no Centre is eligible", async () => {
    const { resolveNext } = deferredFetch();
    render(<CurriculumPlanAssignForm planId={7} centres={[]} readOnly={false} />);
    await resolveNext(jsonResponse({ preview: preview() }));

    expect(screen.getByText(/No eligible Centres/)).toBeInTheDocument();
  });
});
