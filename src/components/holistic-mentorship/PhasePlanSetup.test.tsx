import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import PhasePlanSetup from "./PhasePlanSetup";

describe("PhasePlanSetup", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: null }) }));
  });

  it("only offers a blank Plan when no prior-year Plan exists", async () => {
    render(<PhasePlanSetup />);

    expect(await screen.findByRole("button", { name: "Start blank" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy previous year" })).not.toBeInTheDocument();
    expect(screen.getByText("Start with no Phases and add them from this workspace.")).toBeInTheDocument();
    expect(screen.getByText(`Create the 2026-2027 Phase Plan`)).toBeInTheDocument();
  });

  it("offers to copy when a prior-year Plan exists", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: { id: 6 } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<PhasePlanSetup />);

    expect(await screen.findByRole("button", { name: "Copy previous year" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/holistic-mentorship/phase-plans?academic_year=2025-2026"
    );
    expect(screen.getByText(/copy last year's definitions/)).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Grade 11" })).toBeEnabled();
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

  it("disables Save and Discard until the draft has unsaved changes", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: {
      id: 7, academicYear: "2026-2027", editable: true, phases: [{
        id: 21, number: 1, grade: 11, title: "Saved title", state: "locked",
        guidanceMarkdown: "Saved Guidance", revision: 2, frozen: false,
        everOpened: false, used: false, active: false,
        questions: [{ id: 41, text: "Saved Question" }],
      }],
    } }) }));
    render(<PhasePlanSetup />);

    await user.click(await screen.findByRole("button", { name: /Saved title/ }));
    expect(screen.getByRole("button", { name: "Save Phase" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeDisabled();
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Title"), "!");
    expect(screen.getByRole("button", { name: "Save Phase" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByLabelText("Title")).toHaveValue("Saved title");
    expect(screen.getByRole("button", { name: "Save Phase" })).toBeDisabled();
  });

  it("keeps the moved Phase selected after a reorder", async () => {
    const user = userEvent.setup();
    const lockedPhase = (id: number, number: number, title: string) => ({
      id, number, grade: 11, title, state: "locked",
      guidanceMarkdown: "Guidance", revision: 1, frozen: false,
      everOpened: false, used: false, active: false,
      questions: [{ id: id * 10, text: "Question" }],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: {
        id: 7, academicYear: "2026-2027", editable: true,
        phases: [lockedPhase(21, 1, "First title"), lockedPhase(22, 2, "Second title")],
      } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ plan: {
        id: 7, academicYear: "2026-2027", editable: true,
        phases: [lockedPhase(22, 1, "Second title"), lockedPhase(21, 2, "First title")],
      } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<PhasePlanSetup />);

    await user.click(await screen.findByRole("button", { name: /Second title/ }));
    await user.click(screen.getByRole("button", { name: "Move Phase 2 up" }));

    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
      action: "reorder",
      phases: [{ id: 22, expected_revision: 1 }, { id: 21, expected_revision: 1 }],
    });
    expect(await screen.findByRole("heading", { name: "Phase 1 - Second title" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Second title/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /First title/ })).toHaveAttribute("aria-pressed", "false");
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
    expect(screen.getByRole("button", { name: /Saved title/ })).toHaveAttribute("aria-pressed", "true");
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
