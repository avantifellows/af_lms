import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
type Notes = OpenPhase["notes"];

// ---- Browser recording boundary: getUserMedia + MediaRecorder ----

type FakeTrack = { stop: ReturnType<typeof vi.fn> };

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = (type: string) => type === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(public stream: { getTracks: () => FakeTrack[] }, public options: MediaRecorderOptions = {}) {
    this.mimeType = options.mimeType ?? "";
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["spoken clip"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

let tracks: FakeTrack[] = [];

function installFakeMic() {
  FakeMediaRecorder.instances = [];
  tracks = [];
  const getUserMedia = vi.fn(async () => {
    const track = { stop: vi.fn() };
    tracks.push(track);
    return { getTracks: () => [track] };
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  return getUserMedia;
}

// ---- Network boundary: the Dictation route and the Notes route ----

type Deferred = { resolve: (response: Response) => void; promise: Promise<Response> };

function deferred(): Deferred {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { resolve, promise };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function stubNetwork() {
  const dictationCalls: Array<{ url: string; body: FormData }> = [];
  const notesCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const pendingDictation: Deferred[] = [];
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.includes("/dictation")) {
      dictationCalls.push({ url, body: init!.body as FormData });
      const response = deferred();
      pendingDictation.push(response);
      return response.promise;
    }
    if (init?.body) notesCalls.push({ url, body: JSON.parse(String(init.body)) });
    return Promise.resolve(json({ revision: notesCalls.length }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const transcribe = async (text: string, remainingSeconds = 1_700) => {
    await act(async () => {
      pendingDictation.shift()!.resolve(json({ outcome: "ok", text, remainingSeconds }));
    });
  };
  return { dictationCalls, notesCalls, transcribe };
}

// ---- Fixtures ----

const questions = [
  { questionId: 91, text: "What helped?", position: 1 },
  { questionId: 92, text: "What happens next?", position: 2 },
];

const mentorDetail = (notes: Notes = null, overrides: Partial<OpenPhase> = {}): HolisticStudentPhaseDetail => ({
  student: { id: 41, name: "Asha Rao", externalStudentId: "S41", grade: 11 as const },
  phases: [{ phaseId: 73, number: 1, title: "Belonging", locked: false as const, active: true, progress: "pending" as const, draftSaved: false, grade: 11 as const, academicYear: "2026-2027" }],
  selectedPhase: {
    phaseId: 73, number: 1, title: "Belonging", locked: false as const, active: true,
    progress: "pending" as const, draftSaved: false, grade: 11 as const, academicYear: "2026-2027",
    revision: 5, mappingId: 300, notesRevision: notes?.revision ?? 0, canEditNotes: true, guidanceMarkdown: "Listen.",
    context: { label: null, items: [] as [], missing: "No previous session notes available" as const },
    questions,
    notes,
    followUpNotes: [],
    ...overrides,
  },
  readOnly: false,
});

const draft = (answers: Record<number, string>): Notes => ({
  state: "draft",
  revision: 1,
  authorName: null,
  firstSubmittedAt: null,
  lastEditedAt: "2026-07-02T00:00:00Z",
  answers: Object.entries(answers).map(([questionId, answer]) => ({
    questionId: Number(questionId), question: "", answer,
  })),
});

const submitted = (answers: Record<number, string>): Notes => ({
  state: "submitted",
  revision: 3,
  authorName: "Anita Sharma",
  firstSubmittedAt: "2026-07-02T00:00:00Z",
  lastEditedAt: "2026-07-02T00:00:00Z",
  answers: Object.entries(answers).map(([questionId, answer]) => ({
    questionId: Number(questionId), question: "", answer,
  })),
  challengeCategories: ["academic.other", "non_academic.other"],
});

const ON = { enabled: true, remainingSeconds: 1_800 };

function renderWorkspace(detail: HolisticStudentPhaseDetail, dictation = ON) {
  return render(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027"
    detail={detail} dictation={dictation} />);
}

const mic = (question: string) => screen.getByRole("button", { name: `Dictate: ${question}` });
const box = (question: string) => screen.getByRole("textbox", { name: question });

describe("StudentPhaseWorkspace Dictation", () => {
  beforeEach(() => {
    installFakeMic();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("shows a mic beside every Question box in a draft", () => {
    renderWorkspace(mentorDetail());

    expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
    expect(mic("What happens next?")).toHaveAttribute("aria-pressed", "false");
  });

  it("shows no mic anywhere when Dictation is off", () => {
    renderWorkspace(mentorDetail(), { enabled: false, remainingSeconds: 1_800 });

    expect(box("What helped?")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Dictate/ })).not.toBeInTheDocument();
  });

  it("records while pressed, uploads the clip once on stop, and appends the words", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

    await act(async () => fireEvent.click(mic("What helped?")));
    expect(mic("What helped?")).toHaveAttribute("aria-pressed", "true");
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(screen.getByText("Recording 0:05")).toBeInTheDocument();

    await act(async () => fireEvent.click(mic("What helped?")));
    expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
    expect(network.dictationCalls).toHaveLength(1);
    const [call] = network.dictationCalls;
    expect(call.url).toBe("/api/holistic-mentorship/students/41/phases/73/dictation"
      + "?school_code=SCH001&academic_year=2026-2027&program_id=1");
    expect(call.body.get("kind")).toBe("post_session");
    expect(call.body.get("duration_ms")).toBe("5000");
    expect(await (call.body.get("audio") as Blob).text()).toBe("spoken clip");
    expect(screen.getByText("Transcribing…")).toBeInTheDocument();

    await network.transcribe(" met the student ");
    expect(box("What helped?")).toHaveValue("Met parents met the student");
    expect(screen.queryByText("Transcribing…")).not.toBeInTheDocument();
    expect(network.dictationCalls).toHaveLength(1);
  });

  async function dictate(question: string, seconds = 3) {
    await act(async () => fireEvent.click(mic(question)));
    await act(async () => vi.advanceTimersByTimeAsync(seconds * 1_000));
    await act(async () => fireEvent.click(mic(question)));
  }

  it("keeps text typed while the clip is transcribed and adds the words after it", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

    await dictate("What helped?");
    expect(box("What helped?")).toBeEnabled();
    fireEvent.change(box("What helped?"), { target: { value: "Met parents and teachers." } });
    await network.transcribe("They agreed on a plan");

    expect(box("What helped?")).toHaveValue("Met parents and teachers. They agreed on a plan");
  });

  it("starts a blank draft with the first dictated words, autosaved like typing", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail());

    await dictate("What helped?");
    await network.transcribe("Met parents");
    expect(box("What helped?")).toHaveValue("Met parents");
    await act(async () => vi.advanceTimersByTimeAsync(750));

    expect(network.notesCalls).toHaveLength(1);
    expect(network.notesCalls[0].url).toBe("/api/holistic-mentorship/students/41/phases/73"
      + "?school_code=SCH001&academic_year=2026-2027&program_id=1");
    expect(network.notesCalls[0].body).toMatchObject({
      action: "draft",
      answers: [{ question_id: 91, answer: "Met parents" }, { question_id: 92, answer: "" }],
    });
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("stops by itself at 2 minutes, transcribes the clip, and says it stopped", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail());

    await act(async () => fireEvent.click(mic("What helped?")));
    await act(async () => vi.advanceTimersByTimeAsync(119_999));
    expect(network.dictationCalls).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(network.dictationCalls).toHaveLength(1);
    expect(network.dictationCalls[0].body.get("duration_ms")).toBe("120000");
    expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
    await network.transcribe("A long story");
    expect(box("What helped?")).toHaveValue("A long story");
    expect(screen.getByText("Recording stopped at 2 minutes.")).toBeInTheDocument();
  });

  it("stops by itself when the Mentor's remaining time for today is under 2 minutes", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail(), { enabled: true, remainingSeconds: 45 });

    await act(async () => fireEvent.click(mic("What helped?")));
    await act(async () => vi.advanceTimersByTimeAsync(44_999));
    expect(network.dictationCalls).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(network.dictationCalls[0].body.get("duration_ms")).toBe("45000");
    await network.transcribe("Short one", 0);
    expect(screen.getByText("Recording stopped: today's Dictation time ran out.")).toBeInTheDocument();
  });

  it("uses the remaining time the last transcription reported for the next recording", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail());

    await dictate("What helped?");
    await network.transcribe("First part", 30);
    await act(async () => fireEvent.click(mic("What happens next?")));
    await act(async () => vi.advanceTimersByTimeAsync(30_000));

    expect(network.dictationCalls).toHaveLength(2);
    expect(network.dictationCalls[1].body.get("duration_ms")).toBe("30000");
  });

  it("disables every other mic while one box records or transcribes", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail());

    await act(async () => fireEvent.click(mic("What helped?")));
    expect(mic("What happens next?")).toBeDisabled();
    expect(mic("What helped?")).toBeEnabled();

    await act(async () => fireEvent.click(mic("What helped?")));
    expect(mic("What happens next?")).toBeDisabled();
    expect(mic("What helped?")).toBeDisabled();

    await network.transcribe("Done");
    expect(mic("What happens next?")).toBeEnabled();
    expect(mic("What helped?")).toBeEnabled();
  });

  describe("dropping a recording", () => {
    const withCategories = (notes: Notes): Notes => ({
      ...notes!, challengeCategories: ["academic.other", "non_academic.other"],
    });

    it("Submit stops the recording, releases the mic, and uploads nothing", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(mentorDetail(withCategories(draft({ 91: "A plan", 92: "Review it" }))));

      await act(async () => fireEvent.click(mic("What helped?")));
      expect(tracks[0].stop).not.toHaveBeenCalled();
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit Notes" })));

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(network.notesCalls.at(-1)!.body).toMatchObject({
        action: "submit",
        answers: [{ question_id: 91, answer: "A plan" }, { question_id: 92, answer: "Review it" }],
      });
    });

    it("Submit ignores a transcription that arrives late", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(mentorDetail(withCategories(draft({ 91: "A plan", 92: "Review it" }))));

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => fireEvent.click(mic("What helped?")));
      expect(network.dictationCalls).toHaveLength(1);
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit Notes" })));
      await network.transcribe("late words");

      expect(screen.getByText("A plan")).toBeInTheDocument();
      expect(screen.queryByText(/late words/)).not.toBeInTheDocument();
    });

    it("Save changes stops a recording in the author's Edit and uploads nothing", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save Changes" })));

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(network.notesCalls[0].body).toMatchObject({
        action: "edit",
        answers: [{ question_id: 91, answer: "First answer" }, { question_id: 92, answer: "Then this" }],
      });
    });

    it("Cancel in Edit ignores a transcription that arrives late", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => fireEvent.click(mic("What helped?")));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await network.transcribe("late words");

      expect(tracks[0].stop).toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      expect(box("What helped?")).toHaveValue("First answer");
      expect(screen.queryByText("Transcribing…")).not.toBeInTheDocument();
    });

    it("leaving the page stops the recording, releases the mic, and uploads nothing", async () => {
      const network = stubNetwork();
      const { unmount } = renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));
      unmount();

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("pagehide stops the recording and uploads nothing", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => { window.dispatchEvent(new Event("pagehide")); });

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
    });
  });

  describe("where the mic shows", () => {
    const noMic = () => expect(screen.queryByRole("button", { name: /^Dictate/ })).not.toBeInTheDocument();

    it("shows a mic beside every answer box in the author's Edit, not on the submitted view", () => {
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));
      noMic();

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      expect(mic("What helped?")).toBeInTheDocument();
      expect(mic("What happens next?")).toBeInTheDocument();
    });

    it("shows no mic on another Mentor's submitted Notes", () => {
      renderWorkspace(mentorDetail(submitted({ 91: "Prior answer" }), { canEditNotes: false }));
      noMic();
    });

    it("shows no mic on an Admin or Program Manager read-only workspace", () => {
      const detail = mentorDetail(submitted({ 91: "Submitted answer" }), { canEditNotes: false });
      renderWorkspace({ ...detail, readOnly: true });
      noMic();
    });

    it("shows no mic on a locked Phase", () => {
      const detail = mentorDetail();
      renderWorkspace({ ...detail, selectedPhase: { phaseId: 74, number: 2, title: "Later", locked: true } });
      noMic();
    });
  });

  it("refuses words that would push the answer past 10,000 characters and keeps the answer", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail(draft({ 91: "a".repeat(9_995) })));

    await dictate("What helped?");
    await network.transcribe("hello");

    expect(box("What helped?")).toHaveValue("a".repeat(9_995));
    expect(screen.getByText("Not added: the answer would go over 10,000 characters."))
      .toHaveAttribute("aria-live", "polite");
  });
});
