import { act, render, screen, within } from "@testing-library/react";
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
      "/api/holistic-mentorship/phase-plans?academic_year=2025-2026&program_id=1"
    );
    expect(screen.getByText(/copy last year's definitions/)).toBeInTheDocument();
  });

  it("ignores an old Phase Plan response after switching Programs", async () => {
    let finishJnv!: (response: unknown) => void;
    let finishEmrs!: (response: unknown) => void;
    const jnvResponse = new Promise((resolve) => { finishJnv = resolve; });
    const emrsResponse = new Promise((resolve) => { finishEmrs = resolve; });
    vi.stubGlobal("fetch", vi.fn()
      .mockReturnValueOnce(jnvResponse)
      .mockReturnValueOnce(emrsResponse));
    const plan = (title: string) => ({
      plan: {
        id: 7,
        academicYear: "2026-2027",
        editable: true,
        phases: [{
          id: 21,
          number: 1,
          grade: 11,
          title,
          state: "locked",
          guidanceMarkdown: "Guidance",
          revision: 1,
          frozen: false,
          everOpened: false,
          used: false,
          active: false,
          questions: [{ id: 41, text: "Question" }],
        }],
      },
    });
    const view = render(<PhasePlanSetup programId={1} />);
    view.rerender(<PhasePlanSetup programId={78} />);

    await act(async () => {
      finishEmrs({ ok: true, json: async () => plan("EMRS Plan") });
    });
    expect(await screen.findByRole("button", { name: /EMRS Plan/ })).toBeInTheDocument();

    await act(async () => {
      finishJnv({ ok: true, json: async () => plan("JNV Plan") });
    });
    expect(screen.getByRole("button", { name: /EMRS Plan/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /JNV Plan/ })).not.toBeInTheDocument();
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

  it("allows more than four Questions", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: {
      id: 7, academicYear: "2026-2027", editable: true, phases: [{
        id: 21, number: 1, grade: 11, title: "Saved title", state: "locked",
        guidanceMarkdown: "Saved Guidance", revision: 2, frozen: false,
        everOpened: false, used: false, active: false,
        questions: [1, 2, 3, 4].map((id) => ({ id, text: `Question ${id}` })),
      }],
    } }) }));
    render(<PhasePlanSetup />);

    await user.click(await screen.findByRole("button", { name: /Saved title/ }));
    await user.click(screen.getByRole("button", { name: "Add Question" }));

    expect(screen.getByLabelText("Question 5")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add Question" })).toBeEnabled();
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

  it("renders an otherwise editable Phase Plan without mutation controls when access is read-only", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ plan: {
      id: 7, academicYear: "2026-2027", editable: true, phases: [{
        id: 21, number: 1, grade: 11, title: "Current title", state: "locked",
        guidanceMarkdown: "Current Guidance", revision: 2, frozen: false,
        everOpened: false, used: false, active: false,
        questions: [{ id: 41, text: "Current Question" }],
      }],
    } }) }));

    render(<PhasePlanSetup canEdit={false} />);

    expect(await screen.findByRole("button", { name: /Current title/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Phase" })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Guidance Markdown")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "Save Phase" })).not.toBeInTheDocument();
  });

  describe("Phase state changes", () => {
    const planWith = (state: "locked" | "open") => ({ plan: {
      id: 7, academicYear: "2026-2027", editable: true, phases: [{
        id: 21, number: 1, grade: 11, title: "Lifecycle title", state,
        guidanceMarkdown: "Guidance", revision: 4, frozen: false,
        everOpened: state === "open", used: false, active: state === "open",
        questions: [{ id: 41, text: "Question" }],
      }],
    } });

    it("opens a Locked Phase after confirmation and keeps it selected after the reload", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => planWith("locked") })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce({ ok: true, json: async () => planWith("open") });
      vi.stubGlobal("fetch", fetchMock);
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Lifecycle title/ }));
      await user.click(screen.getByRole("button", { name: "Open Phase" }));

      expect(confirm).toHaveBeenCalledWith("Open Phase 1?");
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "PATCH" });
      expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({
        action: "state", phase_id: 21, expected_revision: 4, state: "open", confirmed: true, program_id: 1,
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(await screen.findByRole("button", { name: "Return to Locked" })).toBeInTheDocument();
      expect(screen.getByLabelText("Title")).toHaveValue("Lifecycle title");
    });

    it("leaves an Open Phase unchanged when the return to Locked is cancelled", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => planWith("open") });
      vi.stubGlobal("fetch", fetchMock);
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Lifecycle title/ }));
      await user.click(screen.getByRole("button", { name: "Return to Locked" }));

      expect(confirm).toHaveBeenCalledWith("Return to Locked Phase 1?");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps the Phase selected without reloading when the state change fails", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => planWith("open") })
        .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ error: "Phase has Notes" }) });
      vi.stubGlobal("fetch", fetchMock);
      vi.spyOn(window, "confirm").mockReturnValue(true);
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Lifecycle title/ }));
      await user.click(screen.getByRole("button", { name: "Return to Locked" }));

      expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({ state: "locked" });
      expect(await screen.findByText("Phase has Notes")).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(screen.getByLabelText("Title")).toHaveValue("Lifecycle title");
    });
  });

  describe("Challenge Category placement hints", () => {
    const academicHint = "Academic Challenge Categories appear above this question";
    const nonAcademicHint = "Non-academic Challenge Categories appear above this question";
    const planWithQuestions = (questions: Array<{ id: number; text: string }>) => ({ plan: {
      id: 7, academicYear: "2026-2027", editable: true, phases: [{
        id: 21, number: 1, grade: 11, title: "Hint title", state: "locked",
        guidanceMarkdown: "Guidance", revision: 2, frozen: false,
        everOpened: false, used: false, active: false, questions,
      }],
    } });

    it("shows each group's hint on the first matching Question only", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => planWithQuestions([
        { id: 41, text: "How was the week?" },
        { id: 42, text: "Describe the academic challenges the student is facing." },
        { id: 43, text: "Describe any non-academic challenges the student mentioned." },
        { id: 44, text: "Any other academic challenges?" },
      ]) }));
      render(<PhasePlanSetup />);

      expect(await screen.findByLabelText("Question 2")).toHaveAccessibleDescription(academicHint);
      expect(screen.getByLabelText("Question 3")).toHaveAccessibleDescription(nonAcademicHint);
      expect(screen.getByLabelText("Question 1")).toHaveAccessibleDescription("");
      expect(screen.getByLabelText("Question 4")).toHaveAccessibleDescription("");
      expect(screen.getAllByText(academicHint)).toHaveLength(1);
      expect(screen.getAllByText(nonAcademicHint)).toHaveLength(1);
    });

    it("moves the hints live as unsaved Question text is edited", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => planWithQuestions([
        { id: 41, text: "How was the week?" },
        { id: 42, text: "Describe the academic challenges the student is facing." },
      ]) }));
      render(<PhasePlanSetup />);

      const first = await screen.findByLabelText("Question 1");
      expect(screen.getByLabelText("Question 2")).toHaveAccessibleDescription(academicHint);
      expect(screen.queryByText(nonAcademicHint)).not.toBeInTheDocument();

      await user.clear(first);
      await user.type(first, "Any NON-ACADEMIC CHALLENGES?");
      expect(first).toHaveAccessibleDescription(nonAcademicHint);

      const second = screen.getByLabelText("Question 2");
      await user.clear(second);
      await user.type(second, "What support did you agree on?");
      expect(second).toHaveAccessibleDescription("");
      expect(screen.queryByText(academicHint)).not.toBeInTheDocument();
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
  });

  // Issue #516: the list is grouped by Grade, numbered 1-3 and 4-6, and a Grade holds 3 Phases.
  describe("Grades", () => {
    const phase = (id: number, number: number, grade: 11 | 12, title: string, overrides = {}) => ({
      id, number, grade, title, state: "locked",
      guidanceMarkdown: "Guidance", revision: 1, frozen: false,
      everOpened: false, used: false, active: false,
      questions: [{ id: id * 10, text: "Question" }],
      ...overrides,
    });
    const planResponse = (phases: unknown[]) => ({
      ok: true, json: async () => ({ plan: { id: 7, academicYear: "2026-2027", editable: true, phases } }),
    });
    const listed = (grade: 11 | 12) =>
      within(screen.getByRole("region", { name: `Grade ${grade} Phases` })).getAllByRole("button")
        .map((button) => button.textContent);

    it("lists a mixed Plan in two groups, Grade 11 then Grade 12, each in Plan order", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([
        phase(1, 1, 11, "Building Relationship"),
        phase(2, 4, 12, "Better Stress Management"),
        phase(15, 2, 11, "Improved Self-Discipline"),
        phase(16, 5, 12, "Strategic Preparation"),
      ])));
      render(<PhasePlanSetup />);

      await screen.findByRole("region", { name: "Grade 11 Phases" });
      expect(listed(11)).toEqual(["1Building RelationshipLocked", "2Improved Self-DisciplineLocked"]);
      expect(listed(12)).toEqual(["4Better Stress ManagementLocked", "5Strategic PreparationLocked"]);
      const groups = within(screen.getByRole("navigation", { name: "Ordered Phase Plan" }))
        .getAllByRole("region").map((group) => group.getAttribute("aria-label"));
      expect(groups).toEqual(["Grade 11 Phases", "Grade 12 Phases"]);
    });

    it("says so when one Grade has no Phases yet, and shows no groups for an empty Plan", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([phase(1, 1, 11, "Building Relationship")])));
      const view = render(<PhasePlanSetup />);

      expect(await screen.findByText("No Grade 12 Phases yet.")).toBeInTheDocument();
      expect(screen.queryByText("No Grade 11 Phases yet.")).not.toBeInTheDocument();

      view.unmount();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([])));
      render(<PhasePlanSetup />);

      expect(await screen.findByText("No Phases configured.")).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Grade 11 Phases" })).not.toBeInTheDocument();
    });

    it("moves a Phase past its Grade neighbour and leaves the other Grade's Phase in place", async () => {
      const user = userEvent.setup();
      const phases = [
        phase(21, 1, 11, "First Grade 11"), phase(31, 4, 12, "Only Grade 12"), phase(22, 2, 11, "Second Grade 11"),
      ];
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(planResponse(phases))
        .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
        .mockResolvedValueOnce(planResponse(phases));
      vi.stubGlobal("fetch", fetchMock);
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Second Grade 11/ }));
      await user.click(screen.getByRole("button", { name: "Move Phase 2 up" }));

      expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toMatchObject({
        action: "reorder",
        phases: [{ id: 22 }, { id: 31 }, { id: 21 }],
      });
    });

    it("does not offer to move a Phase across the other Grade", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([
        phase(21, 1, 11, "First Grade 11"), phase(31, 4, 12, "Only Grade 12"), phase(22, 2, 11, "Second Grade 11"),
      ])));
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Only Grade 12/ }));

      expect(screen.getByRole("button", { name: "Move Phase 4 up" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Phase 4 down" })).toBeDisabled();
    });

    it("does not move a Phase past a Grade neighbour that has been opened", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([
        phase(21, 1, 11, "Opened Grade 11", { state: "open", everOpened: true }),
        phase(22, 2, 11, "Second Grade 11"),
      ])));
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Second Grade 11/ }));

      expect(screen.getByRole("button", { name: "Move Phase 2 up" })).toBeDisabled();
    });

    it("starts a new Phase in the Grade that still has room and blocks the full Grade", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([
        phase(21, 1, 11, "One"), phase(22, 2, 11, "Two"), phase(23, 3, 11, "Three"), phase(31, 4, 12, "Four"),
      ])));
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: "Add Phase" }));

      expect(screen.getByRole("heading", { name: "New Phase" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Grade 12" })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: "Grade 11" })).toBeDisabled();
      expect(screen.getByText("Grade 11 already has 3 Phases.")).toBeInTheDocument();
    });

    it("lets a Phase stay in its own full Grade but not move into the other full Grade", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([
        phase(21, 1, 11, "One"), phase(22, 2, 11, "Two"), phase(23, 3, 11, "Three"),
        phase(31, 4, 12, "Four"), phase(32, 5, 12, "Five"), phase(33, 6, 12, "Six"),
      ])));
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: /Three/ }));

      expect(screen.getByRole("button", { name: "Grade 11" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Grade 12" })).toBeDisabled();
      expect(screen.getByText("Grade 12 already has 3 Phases.")).toBeInTheDocument();
      expect(screen.queryByText("Grade 11 already has 3 Phases.")).not.toBeInTheDocument();
    });

    it("turns Add Phase off and says why when both Grades have 3 Phases", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(planResponse([
        phase(21, 1, 11, "One"), phase(22, 2, 11, "Two"), phase(23, 3, 11, "Three"),
        phase(31, 4, 12, "Four"), phase(32, 5, 12, "Five"), phase(33, 6, 12, "Six"),
      ])));
      render(<PhasePlanSetup />);

      expect(await screen.findByRole("button", { name: "Add Phase" })).toBeDisabled();
      expect(screen.getByText("Each Grade already has 3 Phases.")).toBeInTheDocument();
    });

    it("shows the server's refusal when a 4th Phase is saved anyway", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(planResponse([phase(21, 1, 11, "One")]))
        .mockResolvedValueOnce({
          ok: false, status: 422, json: async () => ({ error: "Grade 11 already has 3 Phases" }),
        });
      vi.stubGlobal("fetch", fetchMock);
      render(<PhasePlanSetup />);

      await user.click(await screen.findByRole("button", { name: "Add Phase" }));
      await user.type(screen.getByLabelText("Title"), "Late addition");
      await user.type(screen.getByLabelText("Question 1"), "What next?");
      await user.click(screen.getByRole("button", { name: "Save Phase" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Grade 11 already has 3 Phases");
      expect(screen.getByLabelText("Title")).toHaveValue("Late addition");
    });
  });
});
