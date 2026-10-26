import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mockPush, refresh: vi.fn() }) }));

import CurriculumPlanCopy from "./CurriculumPlanCopy";

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

describe("CurriculumPlanCopy", () => {
  it.each([
    ["Copy plan", "same_year"],
    ["Copy to next year", "next_year"],
  ])("%s opens the new Draft", async (button, mode) => {
    const fetchMock = respond({ plan: { id: 12 } });
    render(<CurriculumPlanCopy planId={7} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: button }));

    await vi.waitFor(() => expect(mockPush).toHaveBeenCalledWith("/curriculum-summary/plans/12"));
    expect(fetchMock).toHaveBeenCalledWith("/api/curriculum/plans/7/copy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
  });

  it.each([
    [() => respond({ error: "Curriculum Plan not found" }, false), "Curriculum Plan not found"],
    [() => respond({}, false), "Could not copy the plan"],
    [() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))), "Could not copy the plan"],
  ])("shows the copy error and re-enables the buttons", async (stub, message) => {
    stub();
    render(<CurriculumPlanCopy planId={7} readOnly={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy plan" }));

    expect(await screen.findByTestId("plan-copy-error")).toHaveTextContent(message);
    expect(screen.getByRole("button", { name: "Copy plan" })).toBeEnabled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("is disabled for a read-only Admin", () => {
    render(<CurriculumPlanCopy planId={7} readOnly />);

    expect(screen.getByRole("button", { name: "Copy plan" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy to next year" })).toBeDisabled();
  });
});
