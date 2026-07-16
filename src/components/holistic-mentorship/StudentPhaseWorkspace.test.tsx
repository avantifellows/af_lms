import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HolisticStudentPhaseDetail } from "@/lib/holistic-student-phase";
import StudentPhaseWorkspace from "./StudentPhaseWorkspace";

type OpenPhase = Extract<HolisticStudentPhaseDetail["selectedPhase"], { guidanceMarkdown: string }>;

const teacherDetail = (notes: OpenPhase["notes"] = null): HolisticStudentPhaseDetail => ({
  student: { id: 41, name: "Asha Rao", externalStudentId: "S41", grade: 11 as const },
  phases: [{ phaseId: 73, number: 1, title: "Belonging", locked: false as const, active: true, progress: "pending" as const, draftSaved: false, grade: 11 as const, academicYear: "2026-2027" }],
  selectedPhase: {
    phaseId: 73, number: 1, title: "Belonging", locked: false as const, active: true,
    progress: "pending" as const, draftSaved: false, grade: 11 as const, academicYear: "2026-2027",
    revision: 5, mappingId: 300, notesRevision: notes?.revision ?? 0, canEditNotes: true, guidanceMarkdown: "Listen.",
    context: { label: null, items: [] as [], missing: "No previous session notes available" as const },
    questions: [{ questionId: 91, text: "What helped?", position: 1 }],
    notes,
  },
  readOnly: false,
});

describe("StudentPhaseWorkspace", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders live Context and stable Phase navigation without authoring controls", () => {
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={{
      student: { id: 41, name: "Asha Rao", externalStudentId: "S41", grade: 12 },
      phases: [
        { phaseId: 70, number: 4, title: "Building confidence", locked: false, active: false, progress: "completed", draftSaved: false, grade: 11, academicYear: "2025-2026" },
        { phaseId: 73, number: 5, title: "Next steps", locked: false, active: true, progress: "pending", draftSaved: false, grade: 12, academicYear: "2026-2027" },
      ],
      selectedPhase: {
        phaseId: 73, number: 5, title: "Next steps", locked: false, active: true,
        progress: "pending", draftSaved: false, grade: 12, academicYear: "2026-2027",
        guidanceMarkdown: "## Prepare\nListen first.",
        context: { label: "From Phase 4 - Building confidence", items: [{ label: "What helped?", content: "A weekly plan" }], lastUpdatedAt: "2026-05-03T00:00:00Z" },
        questions: [{ questionId: 91, text: "What will you try next?", position: 1 }],
        notes: null,
      },
      readOnly: true,
    }} />);

    expect(screen.getByRole("heading", { name: "Asha Rao" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Phase 4/ })).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027"
    );
    expect(screen.getByText("From Phase 4 - Building confidence")).toBeInTheDocument();
    expect(screen.getByText("A weekly plan")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("autosaves a partial answer only after a short pause", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ ok: true, changed: true, revision: 1 }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);
    vi.useFakeTimers();

    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), {
      target: { value: "A weekly plan" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(749));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("keeps one autosave in flight and sends the latest queued text next", async () => {
    let finishFirst!: (response: Response) => void;
    const first = new Promise<Response>((resolve) => { finishFirst = resolve; });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);
    vi.useFakeTimers();

    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "First" } });
    await act(async () => vi.advanceTimersByTimeAsync(750));
    fireEvent.change(textbox, { target: { value: "Latest" } });
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst(new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).answers).toEqual([
      { question_id: 91, answer: "Latest" },
    ]);
  });

  it("retains local text after a failed save and retries visibly", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Could not save Notes" }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 3 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);
    vi.useFakeTimers();

    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Keep this text" } });
    await act(async () => vi.advanceTimersByTimeAsync(750));

    expect(screen.getByText("Could not save Notes")).toBeInTheDocument();
    expect(textbox).toHaveValue("Keep this text");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("preserves local text without retrying over a stale server revision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Notes changed; reload the latest version", currentRevision: 3 }),
      { status: 409 }
    ));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);
    vi.useFakeTimers();

    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Keep this text" } });
    await act(async () => vi.advanceTimersByTimeAsync(750));

    expect(screen.getByText("Notes changed; reload the latest version")).toBeInTheDocument();
    expect(textbox).toHaveValue("Keep this text");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("edits submitted Notes only after confirmation and never autosaves the correction", async () => {
    const detail = teacherDetail({
      state: "submitted" as const,
      revision: 3,
      firstSubmittedAt: "2026-07-02T00:00:00Z",
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "First answer" }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 4 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);
    vi.useFakeTimers();

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Corrected answer" } });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save Changes" })));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("edit");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
