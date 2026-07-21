import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockPush, mockRefresh } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import type { HolisticStudentPhaseDetail } from "@/lib/holistic-student-phase";
import StudentPhaseWorkspace from "./StudentPhaseWorkspace";

type OpenPhase = Extract<HolisticStudentPhaseDetail["selectedPhase"], { guidanceMarkdown: string }>;

function stubBrowserNavigation() {
  const navigation = new EventTarget() as EventTarget & {
    traverseTo: ReturnType<typeof vi.fn>;
  };
  navigation.traverseTo = vi.fn(() => ({ committed: Promise.resolve() }));
  vi.stubGlobal("navigation", navigation);
  return navigation;
}

function dispatchTraverse(navigation: EventTarget, destinationKey: string) {
  const event = new Event("navigate", { cancelable: true }) as Event & {
    navigationType: string;
    destination: { key: string };
  };
  event.navigationType = "traverse";
  event.destination = { key: destinationKey };
  navigation.dispatchEvent(event);
  return event;
}

const adminDetail = (overrides: Partial<OpenPhase> = {}): HolisticStudentPhaseDetail => ({
  student: { id: 41, name: "Meera Singh", externalStudentId: "S41", grade: 12 as const },
  phases: [
    { phaseId: 70, number: 5, title: "Reconnecting", locked: false as const, active: false, progress: "completed" as const, draftSaved: false, grade: 12 as const, academicYear: "2026-2027" },
    { phaseId: 73, number: 6, title: "Decision Making", locked: false as const, active: true, progress: "pending" as const, draftSaved: false, grade: 12 as const, academicYear: "2026-2027" },
  ],
  selectedPhase: {
    phaseId: 73, number: 6, title: "Decision Making", locked: false as const, active: true,
    progress: "pending" as const, draftSaved: false, grade: 12 as const, academicYear: "2026-2027",
    revision: 5, mappingId: 300, notesRevision: 0, canEditNotes: false,
    guidanceMarkdown: "## Prepare\nListen first.",
    context: {
      label: "From Phase 5 - Reconnecting",
      items: [{ label: "What changed?", content: "More settled" }],
      lastUpdatedAt: "2026-07-13T00:00:00Z",
    },
    questions: [{ questionId: 91, text: "Which decision is the student working through?", position: 1 }],
    notes: null,
    ...overrides,
  },
  readOnly: true,
});

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
    window.sessionStorage.clear();
    mockPush.mockReset();
    mockRefresh.mockReset();
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
    const priorTab = screen.getByRole("tab", { name: /Phase 4/ });
    expect(priorTab).toHaveAttribute(
      "href",
      "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027"
    );
    const inactivePanel = document.getElementById(priorTab.getAttribute("aria-controls")!);
    expect(inactivePanel).toHaveAttribute("role", "tabpanel");
    expect(inactivePanel).toHaveAttribute("aria-labelledby", priorTab.id);
    expect(inactivePanel).toHaveAttribute("hidden");
    const selectedTab = screen.getByRole("tab", { name: /Phase 5/ });
    const phasePanel = screen.getByRole("tabpanel");
    expect(selectedTab).toHaveAttribute("aria-controls", phasePanel.id);
    expect(phasePanel).toHaveAttribute("aria-labelledby", selectedTab.id);
    expect(screen.getByText("From Phase 4 - Building confidence")).toBeInTheDocument();
    expect(screen.getByText("A weekly plan")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the Admin read-only header with back navigation and underline Phase tabs", () => {
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027"
      backHref="/admin/holistic-mentorship" detail={adminDetail()} />);

    const back = screen.getByRole("link", { name: "Back to Students and Progress" });
    expect(back).toHaveAttribute("href", "/admin/holistic-mentorship");
    expect(screen.getByRole("heading", { name: "Meera Singh" })).toBeInTheDocument();
    expect(screen.getByText("Admin read-only view")).toBeInTheDocument();
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Phase 6 - Decision Making" })).toBeInTheDocument();
    expect(screen.getByText("Open Phase - Pending")).toBeInTheDocument();
    const selectedTab = screen.getByRole("tab", { name: /Phase 6/ });
    expect(selectedTab).toHaveAttribute("aria-selected", "true");
    expect(selectedTab.className).toContain("border-accent");
    expect(screen.getByRole("tab", { name: /Phase 5/ })).toHaveAttribute("aria-selected", "false");
  });

  it("shows submitted Notes with answers and an Admin read-only notice", () => {
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={adminDetail({
      notes: {
        state: "submitted",
        revision: 3,
        authorName: "Divya Menon",
        firstSubmittedAt: "2026-07-14T09:48:00Z",
        lastEditedAt: "2026-07-14T09:48:00Z",
        answers: [{
          questionId: 91,
          question: "Which decision is the student working through?",
          answer: "Comparing engineering pathways",
        }],
      },
    })} />);

    expect(screen.getByText(/Submitted by Divya Menon on/)).toBeInTheDocument();
    expect(screen.getByText("Comparing engineering pathways")).toBeInTheDocument();
    expect(screen.getByText("Read-only for Admins")).toBeInTheDocument();
    expect(screen.getByText("Only the author while currently assigned can edit submitted Notes."))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Notes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("hides Mentor draft answers from Admins while the Phase is Pending", () => {
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={adminDetail({
      notes: {
        state: "draft",
        revision: 2,
        authorName: "Divya Menon",
        firstSubmittedAt: null,
        lastEditedAt: "2026-07-14T09:48:00Z",
      },
    })} />);

    expect(screen.getByText("Mentor draft is not visible")).toBeInTheDocument();
    expect(screen.getByText("This Phase is Pending. Admins can read Notes only after the Mentor submits them."))
      .toBeInTheDocument();
    expect(screen.queryByText(/Draft saved/)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("offers Profile regeneration when the Context source is the Student Profile", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(
      JSON.stringify({ requestKey: "request-1", state: "queued" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    ));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={adminDetail({
      context: { label: "Student Profile", items: [{ label: "Journey", content: "Summary" }] },
    })} />);

    expect(screen.getByText("Student Profile context")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Request Profile regeneration" }));
    await screen.findByText("Regeneration queued.");
    expect(window.confirm).toHaveBeenCalledWith("Request Profile regeneration?");
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(post[0]).toBe("/api/holistic-mentorship/profiles/41");
    expect(JSON.parse(String(post[1].body))).toMatchObject({ force: true });
  });

  it("polls a queued Profile request and explains a missing questionnaire", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      regeneration: {
        requestKey: "request-1",
        state: "failed",
        errorCode: "no_questionnaire_submission",
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={adminDetail({
      context: {
        label: "Student Profile",
        items: [{ label: "Journey", content: "Existing summary" }],
        regeneration: { requestKey: "request-1", state: "queued", errorCode: null },
      },
    })} />);

    expect(screen.getByText("Existing summary")).toBeInTheDocument();
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request Profile regeneration" })).not.toBeInTheDocument();

    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/holistic-mentorship/profiles/41?academic_year=2026-2027",
      { cache: "no-store" }
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This Student has not submitted the profile questionnaire."
    );
    expect(screen.getByRole("button", { name: "Request Profile regeneration" })).toBeEnabled();
  });

  it("shows the same Profile failure reason to Mentors without an Admin action", () => {
    const detail = teacherDetail();
    (detail.selectedPhase as OpenPhase).context = {
      label: null,
      items: [],
      missing: "Profile unavailable",
      regeneration: {
        requestKey: "request-1",
        state: "failed",
        errorCode: "no_questionnaire_submission",
      },
    };

    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This Student has not submitted the profile questionnaire."
    );
    expect(screen.queryByRole("button", { name: "Request Profile regeneration" })).not.toBeInTheDocument();
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
    expect(JSON.parse(window.sessionStorage.getItem("holistic-notes-refresh-urls") ?? "[]"))
      .toContain(window.location.href);
  });

  it("restores an authored draft after the page reloads", () => {
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail({
      state: "draft",
      revision: 2,
      authorName: "Anita Sharma",
      firstSubmittedAt: null,
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Saved draft answer" }],
    })} />);

    expect(screen.getByRole("textbox", { name: "What helped?" })).toHaveValue("Saved draft answer");
    expect(screen.getByText("Prep material stays read-only. Complete Notes after the offline conversation."))
      .toBeInTheDocument();
    expect(screen.getByText("All answers are required before submission.")).toBeInTheDocument();
    expect(screen.getAllByText("*")).toHaveLength(1);
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("rehydrates a saved draft when refreshed server props advance", async () => {
    const { rerender } = render(
      <StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />
    );
    const refreshed = teacherDetail({
      state: "draft",
      revision: 1,
      authorName: "Anita Sharma",
      firstSubmittedAt: null,
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Persisted after traversal" }],
    });

    rerender(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={refreshed} />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "What helped?" }))
      .toHaveValue("Persisted after traversal"));
  });

  it("reloads a saved draft when browser history restores a cached Phase", async () => {
    window.sessionStorage.setItem("holistic-notes-refresh-urls", JSON.stringify([window.location.href]));
    const refreshed = teacherDetail({
      state: "draft",
      revision: 1,
      authorName: "Anita Sharma",
      firstSubmittedAt: null,
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Restored from the server" }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(refreshed), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);

    await waitFor(() => expect(screen.getByRole("textbox", { name: "What helped?" }))
      .toHaveValue("Restored from the server"));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/holistic-mentorship/students/41/phases/73"),
      expect.objectContaining({ cache: "no-store" }));
    expect(JSON.parse(window.sessionStorage.getItem("holistic-notes-refresh-urls") ?? "[]"))
      .toContain(window.location.href);
  });

  it("keeps the old revision token when newer server props arrive over a dirty draft", async () => {
    const revisionTwo = teacherDetail({
      state: "draft",
      revision: 2,
      authorName: "Anita Sharma",
      firstSubmittedAt: null,
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Revision two" }],
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Notes changed; reload the latest version" }),
      { status: 409 }
    ));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={revisionTwo} />
    );
    vi.useFakeTimers();

    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), {
      target: { value: "My unsaved local edit" },
    });
    expect(screen.getByRole("textbox", { name: "What helped?" })).toHaveValue("My unsaved local edit");
    const revisionThree = teacherDetail({
      state: "draft",
      revision: 3,
      authorName: "Anita Sharma",
      firstSubmittedAt: null,
      lastEditedAt: "2026-07-03T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Other tab won" }],
    });
    rerender(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={revisionThree} />);
    await act(async () => vi.advanceTimersByTimeAsync(750));

    expect(screen.getByRole("textbox", { name: "What helped?" })).toHaveValue("My unsaved local edit");
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH");
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall![1]?.body)).expected_revision).toBe(2);
  });

  it("does not roll back a saved local revision when stale server props arrive", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 2 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />
    );
    vi.useFakeTimers();

    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), {
      target: { value: "Locally saved revision two" },
    });
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    rerender(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail({
      state: "draft",
      revision: 1,
      authorName: "Anita Sharma",
      firstSubmittedAt: null,
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Stale revision one" }],
    })} />);

    expect(screen.getByRole("textbox", { name: "What helped?" })).toHaveValue("Locally saved revision two");
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
      authorName: "Anita Sharma",
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

    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), {
      target: { value: "Discard this second edit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Corrected answer")).toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalledWith("Save changes to submitted Notes?");
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved Notes changes?");
  });

  it("freezes a correction while its final write is in flight", async () => {
    const detail = teacherDetail({
      state: "submitted",
      revision: 3,
      authorName: "Anita Sharma",
      firstSubmittedAt: "2026-07-02T00:00:00Z",
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "First answer" }],
    });
    let finishEdit!: (response: Response) => void;
    const editResponse = new Promise<Response>((resolve) => { finishEdit = resolve; });
    const fetchMock = vi.fn().mockReturnValue(editResponse);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Stable correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(textbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      action: "edit",
      answers: [{ question_id: 91, answer: "Stable correction" }],
    });

    await act(async () => {
      finishEdit(new Response(JSON.stringify({ revision: 4 }), { status: 200 }));
      await editResponse;
    });
    expect(await screen.findByText("Submitted Notes updated.")).toBeInTheDocument();
  });

  it("shows eight ordered stage tabs and keeps locked tabs disabled", () => {
    const base = teacherDetail();
    const selected = base.selectedPhase as OpenPhase;
    const detail: HolisticStudentPhaseDetail = {
      ...base,
      student: { ...base.student, grade: 12 },
      phases: [
        ...[1, 2, 3, 4].map((number) => ({ phaseId: null, number, title: `Phase ${number}`, placeholder: true as const })),
        { phaseId: 75, number: 5, title: "Start Grade 12", locked: false, active: true, progress: "completed", draftSaved: false, grade: 12, academicYear: "2026-2027" },
        { phaseId: 76, number: 6, title: "Study choices", locked: false, active: false, progress: "pending", draftSaved: false, grade: 12, academicYear: "2026-2027" },
        { phaseId: 77, number: 7, title: "Staying on track", locked: false, active: false, progress: "skipped", draftSaved: false, grade: 12, academicYear: "2026-2027" },
        { phaseId: 78, number: 8, title: "Next steps", locked: true },
      ],
      selectedPhase: {
        ...selected,
        phaseId: 75,
        number: 5,
        title: "Start Grade 12",
        grade: 12,
        progress: "completed",
      },
    };

    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(8);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Phase 1Locked", "Phase 2Locked", "Phase 3Locked", "Phase 4Locked",
      "Phase 5Completed", "Phase 6Open", "Phase 7Skipped", "Phase 8Locked",
    ]);
    expect(screen.getByRole("tab", { name: "Phase 5 - Start Grade 12 - Completed" }))
      .toHaveAttribute("aria-selected", "true");
    expect(tabs[0]).toBeDisabled();
    expect(tabs[7]).toBeDisabled();
    expect(screen.getByRole("banner")).toHaveTextContent("Asha Rao");
    expect(screen.getByRole("banner")).not.toHaveTextContent("Grade 12");
  });

  it("flushes a pending draft before controlled Phase navigation", async () => {
    const base = teacherDetail();
    const detail: HolisticStudentPhaseDetail = {
      ...base,
      phases: [
        ...base.phases,
        { phaseId: 74, number: 2, title: "Follow up", locked: false, active: false, progress: "pending", draftSaved: false, grade: 11, academicYear: "2026-2027" },
      ],
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), {
      target: { value: "Save before leaving" },
    });
    fireEvent.click(screen.getByRole("tab", { name: /Phase 2/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(
      "/holistic-mentorship/students/41/phases/74?school_code=SCH001&academic_year=2026-2027"
    ));
  });

  it("flushes a pending draft before browser Back navigation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ revision: 1 }), { status: 200 }));
    const navigation = stubBrowserNavigation();
    vi.stubGlobal("fetch", fetchMock);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);

    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), {
      target: { value: "Save before browser Back" },
    });
    let navigateEvent!: Event;
    await act(async () => {
      navigateEvent = dispatchTraverse(navigation, "previous-entry");
      await Promise.resolve();
    });

    expect(navigateEvent.defaultPrevented).toBe(true);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
    await waitFor(() => expect(navigation.traverseTo).toHaveBeenCalledWith("previous-entry"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    const patchCall = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(patchCall[1].body).answers).toEqual([
      { question_id: 91, answer: "Save before browser Back" },
    ]);
  });

  it("keeps a dirty submitted correction when browser Back is cancelled", async () => {
    const detail = teacherDetail({
      state: "submitted",
      revision: 3,
      authorName: "Anita Sharma",
      firstSubmittedAt: "2026-07-02T00:00:00Z",
      lastEditedAt: "2026-07-02T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "First answer" }],
    });
    const navigation = stubBrowserNavigation();
    vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Do not lose this" } });
    let navigateEvent!: Event;
    await act(async () => {
      navigateEvent = dispatchTraverse(navigation, "previous-entry");
      await Promise.resolve();
    });

    expect(navigateEvent.defaultPrevented).toBe(true);
    expect(navigation.traverseTo).not.toHaveBeenCalled();
    expect(window.confirm).toHaveBeenCalledWith("Discard unsaved Notes changes?");
    expect(textbox).toHaveValue("Do not lose this");

    await act(async () => {
      dispatchTraverse(navigation, "previous-entry");
      await Promise.resolve();
    });
    await waitFor(() => expect(navigation.traverseTo).toHaveBeenCalledWith("previous-entry"));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("First answer")).toBeInTheDocument();
  });

  it("submits immediately without racing its debounce and updates the Phase stage", async () => {
    const base = teacherDetail();
    const selected = base.selectedPhase as OpenPhase;
    const detail: HolisticStudentPhaseDetail = {
      ...base,
      selectedPhase: {
        ...selected,
        questions: [
          { questionId: 91, text: "What helped?", position: 1 },
          { questionId: 92, text: "What happens next?", position: 2 },
        ],
      },
    };
    const submittedDetail = teacherDetail({
      state: "submitted",
      revision: 2,
      authorName: "Anita Sharma",
      firstSubmittedAt: "2026-07-03T00:00:00Z",
      lastEditedAt: "2026-07-03T00:00:00Z",
      answers: [
        { questionId: 91, question: "What helped?", answer: "A plan" },
        { questionId: 92, question: "What happens next?", answer: "Review it" },
      ],
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 2 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(submittedDetail), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    fireEvent.change(screen.getByRole("textbox", { name: "What helped?" }), { target: { value: "A plan" } });
    fireEvent.change(screen.getByRole("textbox", { name: "What happens next?" }), { target: { value: "Review it" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Notes" }));

    await screen.findByText("Notes submitted. Phase completed.");
    await screen.findByText(/Submitted by Anita Sharma on/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("tab", { name: /Completed/ })).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("freezes the submitted answer while the final write is in flight", async () => {
    let finishSubmit!: (response: Response) => void;
    const submitResponse = new Promise<Response>((resolve) => { finishSubmit = resolve; });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 1 }), { status: 200 }))
      .mockReturnValueOnce(submitResponse);
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);

    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Stable final answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Notes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(textbox).toBeDisabled();
    expect(screen.getByRole("button", { name: "Submit Notes" })).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).answers).toEqual([
      { question_id: 91, answer: "Stable final answer" },
    ]);

    await act(async () => {
      finishSubmit(new Response(JSON.stringify({ revision: 2 }), { status: 200 }));
      await submitResponse;
    });
    expect(await screen.findByText("Notes submitted. Phase completed.")).toBeInTheDocument();
  });

  it("focuses the first missing answer before Submit", () => {
    const base = teacherDetail();
    const selected = base.selectedPhase as OpenPhase;
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={{
      ...base,
      selectedPhase: {
        ...selected,
        questions: [
          { questionId: 91, text: "First answer", position: 1 },
          { questionId: 92, text: "Second answer", position: 2 },
        ],
      },
    }} />);

    fireEvent.click(screen.getByRole("button", { name: "Submit Notes" }));
    const first = screen.getByRole("textbox", { name: "First answer" });
    const second = screen.getByRole("textbox", { name: "Second answer" });
    const validation = screen.getByRole("alert");
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-invalid", "true");
    expect(first).toHaveAttribute("aria-describedby", validation.id);
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(second).toHaveAttribute("aria-describedby", validation.id);

    fireEvent.change(first, { target: { value: "First response" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Answer every Question before submitting");
    expect(first).toHaveAttribute("aria-invalid", "false");
    expect(first).not.toHaveAttribute("aria-describedby");
    expect(second).toHaveAttribute("aria-describedby", validation.id);

    fireEvent.change(second, { target: { value: "Second response" } });
    expect(screen.queryByText("Answer every Question before submitting")).not.toBeInTheDocument();
    expect(second).toHaveAttribute("aria-invalid", "false");
    expect(second).not.toHaveAttribute("aria-describedby");
  });

  it("shows prior-author submitted Notes read-only with submitter and timestamps", () => {
    const detail = teacherDetail({
      state: "submitted",
      revision: 3,
      authorName: "Divya Rao",
      firstSubmittedAt: "2026-07-02T00:00:00Z",
      lastEditedAt: "2026-07-03T00:00:00Z",
      answers: [{ questionId: 91, question: "What helped?", answer: "Prior Mentor answer" }],
    });
    (detail.selectedPhase as OpenPhase).canEditNotes = false;

    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    expect(screen.getByText(/Submitted by Divya Rao on/)).toBeInTheDocument();
    expect(screen.getByText("Prior Mentor answer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Notes" })).not.toBeInTheDocument();
  });

  it("keeps a Skipped Phase editable and switches preparation panels on mobile", () => {
    const detail = teacherDetail();
    (detail.phases[0] as Extract<HolisticStudentPhaseDetail["phases"][number], { locked: false }>).progress = "skipped";
    (detail.selectedPhase as OpenPhase).progress = "skipped";

    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={detail} />);

    expect(screen.getByRole("textbox", { name: "What helped?" })).toBeInTheDocument();
    const guidance = screen.getByRole("button", { name: "Phase Guidance" });
    fireEvent.click(guidance);
    expect(guidance).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Student Context" })).toHaveAttribute("aria-pressed", "false");
  });

  it("uses a useful error for non-JSON failures and retains the draft", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("upstream unavailable", { status: 502 })));
    render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027" detail={teacherDetail()} />);
    vi.useFakeTimers();

    const textbox = screen.getByRole("textbox", { name: "What helped?" });
    fireEvent.change(textbox, { target: { value: "Keep this answer" } });
    await act(async () => vi.advanceTimersByTimeAsync(750));

    expect(screen.getByText("Could not save Notes")).toBeInTheDocument();
    expect(textbox).toHaveValue("Keep this answer");
  });
});
