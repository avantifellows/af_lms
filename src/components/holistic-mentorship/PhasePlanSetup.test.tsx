import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PhasePlanSetup from "./PhasePlanSetup";

describe("PhasePlanSetup", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: null }) }));
  });

  it("offers blank and prior-year copy paths when the current Plan does not exist", async () => {
    render(<PhasePlanSetup />);

    expect(await screen.findByRole("button", { name: "Create blank Plan" })).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toHaveValue("1");
    expect(screen.getByLabelText("Program")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Copy 2025-2026 Plan" })).toBeInTheDocument();
  });

  it("edits and reorders questions on an opened unused Phase after confirmation", async () => {
    const user = userEvent.setup();
    const phase = {
      id: 21, number: 1, grade: 11, title: "Opened title", state: "open",
      guidanceMarkdown: "Opened Guidance", revision: 2, frozen: false,
      everOpened: true, used: false, active: true,
      questions: [{ id: 41, text: "First Question" }, { id: 42, text: "Second Question" }],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: {
        id: 7, academicYear: "2026-2027", editable: true, phases: [phase],
      } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: {
        id: 7, academicYear: "2026-2027", editable: true, phases: [phase],
      } }) });
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PhasePlanSetup />);

    await user.click(await screen.findByRole("button", { name: /Opened title/ }));
    expect(screen.getByLabelText("Grade")).toBeEnabled();
    expect(screen.getByLabelText("Title")).toBeEnabled();
    expect(screen.getByLabelText("Question 1")).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Move Question 2 up" }));
    expect(screen.getByLabelText("Question 1")).toHaveValue("Second Question");
    expect(screen.getByRole("button", { name: "Move Question 1 up" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Save Phase" }));
    expect(confirm).toHaveBeenCalledWith("Save changes to this previously opened Phase?");
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      action: "update",
      confirmed: true,
      questions: [{ id: 42, text: "Second Question" }, { id: 41, text: "First Question" }],
    });
  });

  it("preserves unsaved text when an optimistic save conflicts", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: {
        id: 7, academicYear: "2026-2027", editable: true, phases: [{
          id: 21, number: 1, grade: 11, title: "Saved title", state: "locked",
          guidanceMarkdown: "Saved Guidance", revision: 2, frozen: false,
          everOpened: false, used: false, active: false,
          questions: [{ id: 41, text: "Saved Question" }],
        }],
      } }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "Phase changed", currentRevision: 3 }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PhasePlanSetup />);

    await user.click(await screen.findByRole("button", { name: /Saved title/ }));
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Unsaved title");
    await user.click(screen.getByRole("button", { name: "Save Phase" }));

    expect(title).toHaveValue("Unsaved title");
    expect(await screen.findByRole("alert")).toHaveTextContent("your unsaved text is preserved");
  });

  it("does not offer edits for a frozen Phase", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: {
      id: 7, academicYear: "2026-2027", editable: true, phases: [{
        id: 21, number: 1, grade: 11, title: "Frozen title", state: "open",
        guidanceMarkdown: "Frozen Guidance", revision: 3, frozen: true,
        everOpened: true, used: true, active: true,
        questions: [{ id: 41, text: "Frozen Question" }],
      }],
    } }) }));
    const user = userEvent.setup();
    render(<PhasePlanSetup />);

    await user.click(await screen.findByRole("button", { name: /Frozen title/ }));

    expect(screen.getByLabelText("Guidance Markdown")).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Save Phase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return to Locked" })).toBeDisabled();
  });
});
