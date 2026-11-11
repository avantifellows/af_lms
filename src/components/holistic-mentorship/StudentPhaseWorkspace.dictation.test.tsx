import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
  /** What the clip holds when the recorder stops; empty means nothing was recorded. */
  audio = "spoken clip";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

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
    this.ondataavailable?.({ data: new Blob([this.audio], { type: this.mimeType }) });
    this.onstop?.();
  }

  /** The browser reports a recorder error while still recording. */
  fail() {
    this.onerror?.(new Event("error"));
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

type Deferred = {
  resolve: (response: Response) => void;
  reject: (error: Error) => void;
  promise: Promise<Response>;
};

function deferred(): Deferred {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((done, fail) => { resolve = done; reject = fail; });
  return { resolve, reject, promise };
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
  const respond = async (body: unknown, status = 200) => {
    await act(async () => { pendingDictation.shift()!.resolve(json(body, status)); });
  };
  const dropConnection = async () => {
    await act(async () => { pendingDictation.shift()!.reject(new TypeError("Failed to fetch")); });
  };
  return { dictationCalls, notesCalls, transcribe, respond, dropConnection };
}

const bytesOf = async (form: FormData) =>
  Array.from(new Uint8Array(await (form.get("audio") as Blob).arrayBuffer()));

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

// ---- Saving while a clip is in progress ----

const SAVE_HINT = "Finish dictating first";

function expectSaveBlocked(button: HTMLElement) {
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(SAVE_HINT);
  expect(screen.getByText(SAVE_HINT)).toBeVisible();
}

function expectSaveAllowed(button: HTMLElement) {
  expect(button).toBeEnabled();
  expect(button).not.toHaveAccessibleDescription(SAVE_HINT);
  expect(screen.queryByText(SAVE_HINT)).not.toBeInTheDocument();
}

// These forms have no <form> element or keyboard shortcut, and React never runs
// onClick for a disabled button, so the only other way to reach the save
// handler is to call it directly. It must refuse on its own, not only by the
// button being disabled.
function callSaveHandler(button: HTMLElement) {
  const propsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"))!;
  (button as unknown as Record<string, { onClick: () => void }>)[propsKey].onClick();
}

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
    expect(mic("What helped?")).toBeDisabled();
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

    const finalWrites = (network: ReturnType<typeof stubNetwork>) =>
      network.notesCalls.filter(({ body }) => body.action !== "draft");

    // Submit and Save Changes wait while the clip records and while it is
    // transcribed, so its words are in what is saved.
    async function expectSaveWaitsForClip(network: ReturnType<typeof stubNetwork>, button: string) {
      await act(async () => fireEvent.click(mic("What helped?")));
      expectSaveBlocked(screen.getByRole("button", { name: button }));
      await act(async () => callSaveHandler(screen.getByRole("button", { name: button })));
      expect(finalWrites(network)).toHaveLength(0);
      expect(tracks[0].stop).not.toHaveBeenCalled();
      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "true");

      await act(async () => fireEvent.click(mic("What helped?")));
      expect(screen.getByText("Transcribing…")).toBeInTheDocument();
      expectSaveBlocked(screen.getByRole("button", { name: button }));
      await act(async () => callSaveHandler(screen.getByRole("button", { name: button })));
      expect(finalWrites(network)).toHaveLength(0);

      await network.transcribe("They agreed");
      expectSaveAllowed(screen.getByRole("button", { name: button }));
      await act(async () => fireEvent.click(screen.getByRole("button", { name: button })));
      expect(network.dictationCalls).toHaveLength(1);
    }

    it("Submit waits for a clip that is recording or transcribing, then submits its words", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(mentorDetail(withCategories(draft({ 91: "A plan", 92: "Review it" }))));

      await expectSaveWaitsForClip(network, "Submit Notes");

      expect(finalWrites(network)).toHaveLength(1);
      expect(finalWrites(network)[0].body).toMatchObject({
        action: "submit",
        answers: [{ question_id: 91, answer: "A plan They agreed" }, { question_id: 92, answer: "Review it" }],
      });
    });

    it("pagehide ignores a transcription that arrives late", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail(draft({ 91: "A plan", 92: "Review it" })));

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => fireEvent.click(mic("What helped?")));
      expect(network.dictationCalls).toHaveLength(1);
      await act(async () => { window.dispatchEvent(new Event("pagehide")); });
      await network.transcribe("late words");

      expect(box("What helped?")).toHaveValue("A plan");
      expect(screen.queryByText("Transcribing…")).not.toBeInTheDocument();
      expect(screen.queryByText("Finish dictating first")).not.toBeInTheDocument();
    });

    it("Save Changes waits for a clip in the author's Edit, then saves its words", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await expectSaveWaitsForClip(network, "Save Changes");

      expect(finalWrites(network)).toHaveLength(1);
      expect(finalWrites(network)[0].body).toMatchObject({
        action: "edit",
        answers: [{ question_id: 91, answer: "First answer They agreed" }, { question_id: 92, answer: "Then this" }],
      });
    });

    it("Cancel in Edit still drops a recording, releases the mic, and uploads nothing", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await act(async () => fireEvent.click(mic("What helped?")));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Edit Notes" })).toBeInTheDocument();
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

  describe("when Dictation can't produce text", () => {
    const micError = (name: string) => {
      const getUserMedia = vi.fn(async () => { throw new DOMException("mic", name); });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    };

    it("says the mic is blocked when permission is denied, keeps the box editable, and sends nothing", async () => {
      const network = stubNetwork();
      micError("NotAllowedError");
      renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

      await act(async () => fireEvent.click(mic("What helped?")));

      expect(screen.getByText(/Microphone is blocked\. Allow microphone access for this site/))
        .toHaveAttribute("aria-live", "polite");
      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
      fireEvent.change(box("What helped?"), { target: { value: "Met parents, typed instead" } });
      expect(box("What helped?")).toHaveValue("Met parents, typed instead");
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("says no microphone was found when the device has none", async () => {
      const network = stubNetwork();
      micError("NotFoundError");
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));

      expect(screen.getByText(/^No microphone found\./)).toHaveAttribute("aria-live", "polite");
      expect(box("What helped?")).toBeEnabled();
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("says this browser can't record when it has no MediaRecorder", async () => {
      const network = stubNetwork();
      const getUserMedia = installFakeMic();
      vi.stubGlobal("MediaRecorder", undefined);
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));

      expect(screen.getByText(/^This browser can't record audio\./)).toHaveAttribute("aria-live", "polite");
      expect(box("What helped?")).toBeEnabled();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("says this browser can't record when it has no getUserMedia", async () => {
      const network = stubNetwork();
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));

      expect(screen.getByText(/^This browser can't record audio\./)).toHaveAttribute("aria-live", "polite");
      expect(network.dictationCalls).toHaveLength(0);
    });
  });

  it("sends nothing when Stop ends a recording that holds no audio, and leaves the mics ready", async () => {
    const network = stubNetwork();
    renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

    await act(async () => fireEvent.click(mic("What helped?")));
    FakeMediaRecorder.instances[0].audio = "";
    await act(async () => fireEvent.click(mic("What helped?")));

    expect(network.dictationCalls).toHaveLength(0);
    expect(screen.getByText(/^Didn't catch anything\./)).toHaveAttribute("aria-live", "polite");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(tracks[0].stop).toHaveBeenCalled();
    expect(mic("What helped?")).toBeEnabled();
    expect(mic("What happens next?")).toBeEnabled();
    expect(box("What helped?")).toHaveValue("Met parents");
  });

  describe("when the browser stops the recording itself", () => {
    const CHECK_MIC = "Recording stopped. Check your microphone.";

    it("releases the mic, transcribes what was said, and says to check the microphone", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => vi.advanceTimersByTimeAsync(7_000));
      await act(async () => { FakeMediaRecorder.instances[0].stop(); });

      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
      expect(screen.queryByText(/^Recording \d:\d\d/)).not.toBeInTheDocument();
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(1);
      expect(network.dictationCalls[0].body.get("duration_ms")).toBe("7000");
      expect(await (network.dictationCalls[0].body.get("audio") as Blob).text()).toBe("spoken clip");

      await network.transcribe("met the student");
      expect(box("What helped?")).toHaveValue("Met parents met the student");
      expect(screen.getByText(CHECK_MIC)).toHaveAttribute("aria-live", "polite");
      expect(mic("What helped?")).toBeEnabled();
      expect(mic("What happens next?")).toBeEnabled();
      await act(async () => vi.advanceTimersByTimeAsync(130_000));
      expect(network.dictationCalls).toHaveLength(1);
    });

    it("uploads nothing and leaves the mics ready when nothing was recorded", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));
      FakeMediaRecorder.instances[0].audio = "";
      await act(async () => { FakeMediaRecorder.instances[0].stop(); });

      expect(screen.getByText(CHECK_MIC)).toHaveAttribute("aria-live", "polite");
      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
      expect(tracks[0].stop).toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(130_000));
      expect(network.dictationCalls).toHaveLength(0);
      expect(mic("What happens next?")).toBeEnabled();
      await act(async () => fireEvent.click(mic("What happens next?")));
      expect(mic("What happens next?")).toHaveAttribute("aria-pressed", "true");
    });

    it("says to check the microphone, not that nothing was heard, when Scribe hears nothing", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      await act(async () => { FakeMediaRecorder.instances[0].stop(); });
      expect(network.dictationCalls).toHaveLength(1);
      await network.respond({ outcome: "nothing_heard", remainingSeconds: 1_797 });

      expect(screen.getByText(CHECK_MIC)).toHaveAttribute("aria-live", "polite");
      expect(screen.queryByText(/^Didn't catch anything\./)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(box("What helped?")).toHaveValue("Met parents");
      expect(mic("What helped?")).toBeEnabled();
      expect(mic("What happens next?")).toBeEnabled();
    });

    it("ends the recording the same way when the recorder reports an error", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => vi.advanceTimersByTimeAsync(2_000));
      await act(async () => { FakeMediaRecorder.instances[0].fail(); });

      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(1);
      expect(network.dictationCalls[0].body.get("duration_ms")).toBe("2000");
      await network.transcribe("Review in a week");
      expect(box("What helped?")).toHaveValue("Review in a week");
      expect(screen.getByText(CHECK_MIC)).toBeInTheDocument();
    });
  });

  describe("Couldn't transcribe", () => {
    it("shows a 502 as Couldn't transcribe, and Retry resends the same clip and duration", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

      await dictate("What helped?", 4);
      await network.respond({ error: "Couldn't transcribe. Try again", remainingSeconds: 1_790 }, 502);

      expect(screen.getByText("Couldn't transcribe. Try again")).toHaveAttribute("aria-live", "polite");
      expect(box("What helped?")).toHaveValue("Met parents");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));

      expect(network.dictationCalls).toHaveLength(2);
      const [first, retry] = network.dictationCalls;
      expect(retry.body.get("duration_ms")).toBe("4000");
      expect(retry.body.get("kind")).toBe("post_session");
      expect(await bytesOf(retry.body)).toEqual(await bytesOf(first.body));
      expect(await bytesOf(retry.body)).toEqual(Array.from(new TextEncoder().encode("spoken clip")));
      expect(FakeMediaRecorder.instances).toHaveLength(1);

      await network.transcribe("met the student");
      expect(box("What helped?")).toHaveValue("Met parents met the student");
      expect(screen.queryByText("Couldn't transcribe. Try again")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("treats a dropped connection on upload the same as a 502", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await dictate("What happens next?", 2);
      await network.dropConnection();

      expect(screen.getByText("Couldn't transcribe. Try again")).toHaveAttribute("aria-live", "polite");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Retry" })));
      expect(network.dictationCalls).toHaveLength(2);
      expect(network.dictationCalls[1].body.get("duration_ms")).toBe("2000");
      expect(await bytesOf(network.dictationCalls[1].body)).toEqual(await bytesOf(network.dictationCalls[0].body));

      await network.transcribe("Review in a week");
      expect(box("What happens next?")).toHaveValue("Review in a week");
      expect(screen.queryByText("Couldn't transcribe. Try again")).not.toBeInTheDocument();
    });

    it.each([401, 403, 422])(
      "drops a clip the server refuses with a %i, says to reload, and offers no Retry",
      async (status) => {
        const network = stubNetwork();
        vi.useFakeTimers();
        renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

        await dictate("What helped?", 4);
        await network.respond({ error: "Refused" }, status);

        expect(screen.getByText("Couldn't send that recording. Reload the page and try again."))
          .toHaveAttribute("aria-live", "polite");
        expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
        expect(screen.queryByText("Couldn't transcribe. Try again")).not.toBeInTheDocument();
        expect(box("What helped?")).toHaveValue("Met parents");
        expect(mic("What helped?")).toBeEnabled();
        expect(mic("What happens next?")).toBeEnabled();
        expect(network.dictationCalls).toHaveLength(1);
      },
    );

    it("keeps Retry for a 429 that is not the daily limit", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await dictate("What helped?");
      await network.respond({ error: "Too many requests" }, 429);

      expect(screen.getByText("Couldn't transcribe. Try again")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    });

    // The device slept while recording: the wall clock jumps past the timer.
    it.each([[1_800, "120000"], [40, "40000"]])(
      "with %i s left today, sends at most the auto-stop length after the device slept",
      async (remainingSeconds, sent) => {
        const network = stubNetwork();
        vi.useFakeTimers();
        renderWorkspace(mentorDetail(), { enabled: true, remainingSeconds });

        await act(async () => fireEvent.click(mic("What helped?")));
        vi.setSystemTime(Date.now() + 200_000);
        await act(async () => fireEvent.click(mic("What helped?")));

        expect(network.dictationCalls[0].body.get("duration_ms")).toBe(sent);
      },
    );

    it("sends at most the auto-stop length when the auto-stop fires late after the device slept", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await act(async () => fireEvent.click(mic("What helped?")));
      vi.setSystemTime(Date.now() + 200_000);
      await act(async () => vi.advanceTimersByTimeAsync(120_000));

      expect(network.dictationCalls[0].body.get("duration_ms")).toBe("120000");
    });

    async function failOnce(network: ReturnType<typeof stubNetwork>, question: string) {
      await act(async () => fireEvent.click(mic(question)));
      await act(async () => fireEvent.click(mic(question)));
      await network.respond({ error: "Couldn't transcribe. Try again", remainingSeconds: 1_790 }, 502);
      expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    }

    const noRetry = () => {
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(screen.queryByText("Couldn't transcribe. Try again")).not.toBeInTheDocument();
    };

    it("a new recording in another box drops the failed clip and its message", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail());

      await failOnce(network, "What helped?");
      await act(async () => fireEvent.click(mic("What happens next?")));

      expect(mic("What happens next?")).toHaveAttribute("aria-pressed", "true");
      noRetry();
      await act(async () => fireEvent.click(mic("What happens next?")));
      await network.transcribe("Next steps");
      noRetry();
      expect(box("What helped?")).toHaveValue("");
      expect(network.dictationCalls).toHaveLength(2);
    });

    it("Submit drops the failed clip, even when the Mentor backs out of submitting", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWorkspace(mentorDetail(draft({ 91: "A plan", 92: "Review it" })));

      await failOnce(network, "What helped?");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Submit Notes" })));

      noRetry();
      expect(network.dictationCalls).toHaveLength(1);
    });

    it("Save Changes drops the failed clip", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await failOnce(network, "What helped?");
      await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save Changes" })));

      noRetry();
      expect(network.dictationCalls).toHaveLength(1);
    });

    it("Cancel in Edit drops the failed clip", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })));

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await failOnce(network, "What helped?");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));

      noRetry();
      expect(network.dictationCalls).toHaveLength(1);
    });

    it("pagehide drops the failed clip", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail());

      await failOnce(network, "What helped?");
      await act(async () => { window.dispatchEvent(new Event("pagehide")); });

      noRetry();
      expect(mic("What helped?")).toBeEnabled();
    });
  });

  it("says Didn't catch anything when nothing was heard, adds nothing, and leaves the mic ready", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

    await dictate("What helped?");
    await network.respond({ outcome: "nothing_heard", remainingSeconds: 1_797 });

    expect(screen.getByText(/^Didn't catch anything\. Try speaking closer to the mic or a little louder\./))
      .toHaveAttribute("aria-live", "polite");
    expect(box("What helped?")).toHaveValue("Met parents");
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(mic("What helped?")).toBeEnabled();
    expect(mic("What happens next?")).toBeEnabled();
    await act(async () => fireEvent.click(mic("What helped?")));
    expect(mic("What helped?")).toHaveAttribute("aria-pressed", "true");
  });

  describe("daily limit", () => {
    const LIMIT = "You've used today's 30 minutes of Dictation. You can keep typing.";

    it("shows the limit message after a 429 daily_limit and stops every mic accepting recordings", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail(draft({ 91: "Met parents" })), { enabled: true, remainingSeconds: 10 });

      await dictate("What helped?", 5);
      await network.respond({ error: "You've used today's Dictation time", code: "daily_limit" }, 429);

      const messages = screen.getAllByText(LIMIT);
      expect(messages.some((message) => message.closest("[aria-live='polite']"))).toBe(true);
      expect(mic("What helped?")).toBeDisabled();
      expect(mic("What happens next?")).toBeDisabled();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(box("What helped?")).toHaveValue("Met parents");
      fireEvent.change(box("What helped?"), { target: { value: "Met parents. Typed on." } });
      expect(box("What helped?")).toHaveValue("Met parents. Typed on.");
    });

    it("drops a clip longer than the time really left, says so, and uses that time for the next recording", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail(draft({ 91: "Met parents" })));

      await dictate("What helped?", 50);
      await network.respond({ error: "You've used today's Dictation time", code: "daily_limit", remainingSeconds: 40 }, 429);

      expect(screen.getByText("That recording is longer than the time you have left today."))
        .toHaveAttribute("aria-live", "polite");
      expect(screen.queryByText(LIMIT)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(box("What helped?")).toHaveValue("Met parents");
      expect(mic("What helped?")).toBeEnabled();
      expect(mic("What happens next?")).toBeEnabled();

      await act(async () => fireEvent.click(mic("What happens next?")));
      await act(async () => vi.advanceTimersByTimeAsync(40_000));
      expect(network.dictationCalls).toHaveLength(2);
      expect(network.dictationCalls[1].body.get("duration_ms")).toBe("40000");
    });

    it("still locks every mic when the 429 says no time is left", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await dictate("What helped?", 5);
      await network.respond({ error: "You've used today's Dictation time", code: "daily_limit", remainingSeconds: 0 }, 429);

      expect(screen.getAllByText(LIMIT)).toHaveLength(2);
      expect(mic("What helped?")).toBeDisabled();
      expect(mic("What happens next?")).toBeDisabled();
      expect(screen.queryByText("That recording is longer than the time you have left today.")).not.toBeInTheDocument();
    });

    it("unlocks the mics when a refresh brings the same count as the first load (a new day)", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      const detail = mentorDetail();
      const view = renderWorkspace(detail, { enabled: true, remainingSeconds: 1_800 });

      await dictate("What helped?");
      await network.transcribe("Last words today", 0);
      expect(mic("What helped?")).toBeDisabled();

      view.rerender(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027"
        detail={detail} dictation={{ enabled: true, remainingSeconds: 1_800 }} />);
      expect(mic("What helped?")).toBeEnabled();
      expect(screen.queryByText(LIMIT)).not.toBeInTheDocument();
      await act(async () => fireEvent.click(mic("What happens next?")));
      await act(async () => vi.advanceTimersByTimeAsync(120_000));
      expect(network.dictationCalls[1].body.get("duration_ms")).toBe("120000");
    });

    it("keeps a count a recorder reported when the page re-renders with the same server count", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      const detail = mentorDetail();
      const server = { enabled: true, remainingSeconds: 1_800 };
      const view = renderWorkspace(detail, server);

      await dictate("What helped?");
      await network.transcribe("First part", 25);
      view.rerender(<StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027"
        detail={detail} dictation={server} />);
      fireEvent.change(box("What helped?"), { target: { value: "First part, typed on" } });
      await act(async () => fireEvent.click(mic("What happens next?")));
      await act(async () => vi.advanceTimersByTimeAsync(24_999));
      expect(mic("What happens next?")).toHaveAttribute("aria-pressed", "true");
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(network.dictationCalls.map((call) => call.body.get("duration_ms"))).toEqual(["3000", "25000"]);
    });

    it("shows mics in the limit state from the start when the page loads with no time left", async () => {
      const network = stubNetwork();
      renderWorkspace(mentorDetail(), { enabled: true, remainingSeconds: 0 });

      expect(mic("What helped?")).toBeDisabled();
      expect(mic("What happens next?")).toBeDisabled();
      expect(screen.getAllByText(LIMIT)).toHaveLength(2);
      await act(async () => fireEvent.click(mic("What helped?")));
      expect(network.dictationCalls).toHaveLength(0);
      expect(box("What helped?")).toBeEnabled();
    });

    // jsdom has no layout, so this checks structure only: the shown-only limit
    // message shares one block with the polite live region instead of being a
    // separate item of the gapped status row (which put it 8 px right of the mic).
    it("keeps the shown-only limit message in the same block as the box's live region", () => {
      renderWorkspace(mentorDetail(), { enabled: true, remainingSeconds: 0 });

      for (const message of screen.getAllByText(LIMIT)) {
        const block = message.parentElement!;
        expect(block.querySelector("[aria-live='polite']")).toBeEmptyDOMElement();
        expect(block).not.toHaveClass("gap-2");
        expect(block.parentElement).toHaveClass("gap-2");
      }
    });

    it("keeps mics in the limit state after Cancel in Edit or pagehide", async () => {
      stubNetwork();
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" })),
        { enabled: true, remainingSeconds: 0 });

      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      expect(mic("What helped?")).toBeDisabled();
      await act(async () => { window.dispatchEvent(new Event("pagehide")); });

      expect(mic("What helped?")).toBeDisabled();
      expect(screen.getAllByText(LIMIT)).toHaveLength(2);
    });

    it("adds the words and then shows the limit when a transcription reports no time left", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(mentorDetail());

      await dictate("What helped?");
      await network.transcribe("Last words today", 0);

      expect(box("What helped?")).toHaveValue("Last words today");
      expect(mic("What helped?")).toBeDisabled();
      expect(mic("What happens next?")).toBeDisabled();
      expect(screen.getAllByText(LIMIT)).toHaveLength(2);
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
    await act(async () => vi.advanceTimersByTimeAsync(2_000));
    expect(network.notesCalls).toHaveLength(0);
  });
});

describe("Follow-up Note Dictation", () => {
  const CHALLENGES = "What challenges did the student talk about?";
  const SOLUTIONS = "What solutions did you suggest?";
  const ACTION_PLAN = "Was the student able to follow the action plan shared previously?";

  const completedDetail = () => mentorDetail(submitted({ 91: "First answer", 92: "Then this" }),
    { progress: "completed" });

  function openModal() {
    fireEvent.click(screen.getByRole("button", { name: "Add notes" }));
    return screen.getByRole("dialog", { name: "Add follow-up notes" });
  }

  const modalMic = (dialog: HTMLElement, question: string) =>
    within(dialog).getByRole("button", { name: `Dictate: ${question}` });
  const modalBox = (dialog: HTMLElement, question: string) =>
    within(dialog).getByRole("textbox", { name: question });

  beforeEach(() => {
    installFakeMic();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it("shows a mic beside each of the three boxes in the open modal, labelled with its Question", () => {
    renderWorkspace(completedDetail());
    expect(screen.queryByRole("button", { name: /^Dictate/ })).not.toBeInTheDocument();

    const dialog = openModal();

    for (const question of [CHALLENGES, SOLUTIONS, ACTION_PLAN]) {
      expect(modalMic(dialog, question)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("shows no mic in the modal when Dictation is off", () => {
    renderWorkspace(completedDetail(), { enabled: false, remainingSeconds: 1_800 });

    const dialog = openModal();

    expect(modalBox(dialog, CHALLENGES)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /^Dictate/ })).not.toBeInTheDocument();
  });

  async function dictate(dialog: HTMLElement, question: string, seconds = 3) {
    await act(async () => fireEvent.click(modalMic(dialog, question)));
    await act(async () => vi.advanceTimersByTimeAsync(seconds * 1_000));
    await act(async () => fireEvent.click(modalMic(dialog, question)));
  }

  it("uploads the clip as a Follow-up dictation and adds the words to that box, then saves them", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(completedDetail());
    const dialog = openModal();
    fireEvent.change(modalBox(dialog, SOLUTIONS), { target: { value: "Daily check-in" } });

    await dictate(dialog, SOLUTIONS, 4);
    expect(network.dictationCalls).toHaveLength(1);
    const [call] = network.dictationCalls;
    expect(call.url).toBe("/api/holistic-mentorship/students/41/phases/73/dictation"
      + "?school_code=SCH001&academic_year=2026-2027&program_id=1");
    expect(call.body.get("kind")).toBe("follow_up");
    expect(call.body.get("duration_ms")).toBe("4000");
    expect(within(dialog).getByText("Transcribing…")).toBeInTheDocument();

    fireEvent.change(modalBox(dialog, SOLUTIONS), { target: { value: "Daily check-in with the warden." } });
    await network.transcribe(" and a weekly call home ");
    expect(modalBox(dialog, SOLUTIONS)).toHaveValue("Daily check-in with the warden. and a weekly call home");
    expect(modalBox(dialog, CHALLENGES)).toHaveValue("");
    expect(modalBox(dialog, ACTION_PLAN)).toHaveValue("");

    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Save" })));
    expect(network.notesCalls).toHaveLength(1);
    expect(network.notesCalls[0].url).toBe("/api/holistic-mentorship/students/41/phases/73/follow-up-notes"
      + "?school_code=SCH001&academic_year=2026-2027&program_id=1");
    expect(network.notesCalls[0].body).toEqual({
      answers: { challenges: "", solutions: "Daily check-in with the warden. and a weekly call home", action_plan: "" },
    });
  });

  it("starts an empty box with the dictated words and no leading space", async () => {
    const network = stubNetwork();
    vi.useFakeTimers();
    renderWorkspace(completedDetail());
    const dialog = openModal();

    await dictate(dialog, ACTION_PLAN);
    await network.transcribe("Yes, mostly");

    expect(modalBox(dialog, ACTION_PLAN)).toHaveValue("Yes, mostly");
  });

  it("disables the other two mics while one box records or transcribes", async () => {
    const network = stubNetwork();
    renderWorkspace(completedDetail());
    const dialog = openModal();

    await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
    expect(modalMic(dialog, CHALLENGES)).toBeEnabled();
    expect(modalMic(dialog, SOLUTIONS)).toBeDisabled();
    expect(modalMic(dialog, ACTION_PLAN)).toBeDisabled();

    await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
    expect(modalMic(dialog, CHALLENGES)).toBeDisabled();
    expect(modalMic(dialog, SOLUTIONS)).toBeDisabled();
    expect(modalMic(dialog, ACTION_PLAN)).toBeDisabled();

    await network.transcribe("Homesick");
    for (const question of [CHALLENGES, SOLUTIONS, ACTION_PLAN]) expect(modalMic(dialog, question)).toBeEnabled();
  });

  describe("dropping a recording", () => {
    it("Save waits for a clip that is recording or transcribing, then saves its words", async () => {
      const network = stubNetwork();
      renderWorkspace(completedDetail());
      const dialog = openModal();
      const save = () => within(dialog).getByRole("button", { name: "Save" });
      fireEvent.change(modalBox(dialog, CHALLENGES), { target: { value: "Homesick" } });
      expectSaveAllowed(save());

      await act(async () => fireEvent.click(modalMic(dialog, SOLUTIONS)));
      expectSaveBlocked(save());
      await act(async () => callSaveHandler(save()));
      expect(network.notesCalls).toHaveLength(0);
      expect(tracks[0].stop).not.toHaveBeenCalled();
      expect(modalMic(dialog, SOLUTIONS)).toHaveAttribute("aria-pressed", "true");

      await act(async () => fireEvent.click(modalMic(dialog, SOLUTIONS)));
      expect(within(dialog).getByText("Transcribing…")).toBeInTheDocument();
      expectSaveBlocked(save());
      await act(async () => callSaveHandler(save()));
      expect(network.notesCalls).toHaveLength(0);

      await network.transcribe("Daily check-in");
      expectSaveAllowed(save());
      await act(async () => fireEvent.click(save()));

      expect(network.dictationCalls).toHaveLength(1);
      expect(network.notesCalls).toHaveLength(1);
      expect(network.notesCalls[0].body).toEqual({
        answers: { challenges: "Homesick", solutions: "Daily check-in", action_plan: "" },
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("Cancel stops the recording, releases the mic, and uploads nothing", async () => {
      const network = stubNetwork();
      renderWorkspace(completedDetail());
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })));

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closing with Escape stops the recording, releases the mic, and uploads nothing", async () => {
      const network = stubNetwork();
      renderWorkspace(completedDetail());
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => fireEvent.keyDown(document, { key: "Escape" }));

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("closing while transcribing ignores the late words and reopens a blank, idle modal", async () => {
      const network = stubNetwork();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(completedDetail());
      let dialog = openModal();
      fireEvent.change(modalBox(dialog, CHALLENGES), { target: { value: "Homesick" } });

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      expect(within(dialog).getByText("Transcribing…")).toBeInTheDocument();
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await network.transcribe("Late words");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      dialog = openModal();
      expect(modalBox(dialog, CHALLENGES)).toHaveValue("");
      expect(within(dialog).queryByText("Transcribing…")).not.toBeInTheDocument();
      for (const question of [CHALLENGES, SOLUTIONS, ACTION_PLAN]) expect(modalMic(dialog, question)).toBeEnabled();
    });

    it("Cancel stops the recording even when the Mentor keeps the note open", async () => {
      const network = stubNetwork();
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWorkspace(completedDetail());
      const dialog = openModal();
      fireEvent.change(modalBox(dialog, CHALLENGES), { target: { value: "Homesick" } });

      await act(async () => fireEvent.click(modalMic(dialog, SOLUTIONS)));
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })));

      expect(confirm).toHaveBeenCalledWith("Discard this follow-up note?");
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
      expect(modalBox(dialog, CHALLENGES)).toHaveValue("Homesick");
      expect(modalMic(dialog, SOLUTIONS)).toHaveAttribute("aria-pressed", "false");
    });

    it("pagehide stops the recording and uploads nothing", async () => {
      const network = stubNetwork();
      renderWorkspace(completedDetail());
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => { window.dispatchEvent(new Event("pagehide")); });

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("leaving the page stops the recording, releases the mic, and uploads nothing", async () => {
      const network = stubNetwork();
      const { unmount } = renderWorkspace(completedDetail());
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      unmount();

      expect(tracks[0].stop).toHaveBeenCalled();
      expect(network.dictationCalls).toHaveLength(0);
    });
  });

  describe("when Dictation can't produce text", () => {
    const LIMIT = "You've used today's 30 minutes of Dictation. You can keep typing.";

    it("shows Couldn't transcribe, and Retry resends the same clip as a Follow-up dictation", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(completedDetail());
      const dialog = openModal();

      await dictate(dialog, CHALLENGES, 4);
      await network.respond({ error: "Couldn't transcribe. Try again", remainingSeconds: 1_790 }, 502);
      expect(within(dialog).getByText("Couldn't transcribe. Try again")).toHaveAttribute("aria-live", "polite");
      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Retry" })));

      const [first, retry] = network.dictationCalls;
      expect(retry.body.get("kind")).toBe("follow_up");
      expect(retry.body.get("duration_ms")).toBe("4000");
      expect(await bytesOf(retry.body)).toEqual(await bytesOf(first.body));
      expect(FakeMediaRecorder.instances).toHaveLength(1);
      await network.transcribe("Homesick");
      expect(modalBox(dialog, CHALLENGES)).toHaveValue("Homesick");
      expect(within(dialog).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("closing the modal drops a failed clip", async () => {
      const network = stubNetwork();
      renderWorkspace(completedDetail());
      let dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await network.respond({ error: "Couldn't transcribe. Try again" }, 502);
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      dialog = openModal();

      expect(within(dialog).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
      expect(within(dialog).queryByText("Couldn't transcribe. Try again")).not.toBeInTheDocument();
      expect(network.dictationCalls).toHaveLength(1);
    });

    it("says Didn't catch anything when nothing was heard and adds nothing", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(completedDetail());
      const dialog = openModal();
      fireEvent.change(modalBox(dialog, SOLUTIONS), { target: { value: "Daily check-in" } });

      await dictate(dialog, SOLUTIONS);
      await network.respond({ outcome: "nothing_heard", remainingSeconds: 1_797 });

      expect(within(dialog).getByText(/^Didn't catch anything\./)).toHaveAttribute("aria-live", "polite");
      expect(modalBox(dialog, SOLUTIONS)).toHaveValue("Daily check-in");
      expect(modalMic(dialog, SOLUTIONS)).toBeEnabled();
    });

    it("says the mic is blocked when permission is denied and uploads nothing", async () => {
      const network = stubNetwork();
      const getUserMedia = vi.fn(async () => { throw new DOMException("mic", "NotAllowedError"); });
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
      renderWorkspace(completedDetail());
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));

      expect(within(dialog).getByText(/^Microphone is blocked\./)).toBeInTheDocument();
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("shows the daily limit after a 429 and stops all three mics accepting recordings", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(completedDetail(), { enabled: true, remainingSeconds: 10 });
      const dialog = openModal();

      await dictate(dialog, CHALLENGES, 5);
      await network.respond({ error: "You've used today's Dictation time", code: "daily_limit" }, 429);

      expect(within(dialog).getAllByText(LIMIT)).toHaveLength(3);
      for (const question of [CHALLENGES, SOLUTIONS, ACTION_PLAN]) expect(modalMic(dialog, question)).toBeDisabled();
      expect(within(dialog).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    });

    it("opens with all three mics in the limit state when there is no time left today", async () => {
      const network = stubNetwork();
      renderWorkspace(completedDetail(), { enabled: true, remainingSeconds: 0 });
      const dialog = openModal();

      for (const question of [CHALLENGES, SOLUTIONS, ACTION_PLAN]) expect(modalMic(dialog, question)).toBeDisabled();
      expect(within(dialog).getAllByText(LIMIT)).toHaveLength(3);
      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      expect(network.dictationCalls).toHaveLength(0);
    });

    it("stops by itself at the Mentor's remaining time for today", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(completedDetail(), { enabled: true, remainingSeconds: 45 });
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => vi.advanceTimersByTimeAsync(45_000));

      expect(network.dictationCalls).toHaveLength(1);
      expect(network.dictationCalls[0].body.get("duration_ms")).toBe("45000");
    });

    it("refuses words that would push the answer past 10,000 characters and keeps the answer", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(completedDetail());
      const dialog = openModal();
      fireEvent.change(modalBox(dialog, CHALLENGES), { target: { value: "a".repeat(9_995) } });

      await dictate(dialog, CHALLENGES);
      await network.transcribe("hello");

      expect(modalBox(dialog, CHALLENGES)).toHaveValue("a".repeat(9_995));
      expect(within(dialog).getByText("Not added: the answer would go over 10,000 characters."))
        .toHaveAttribute("aria-live", "polite");
    });
  });

  describe("one recording at a time on the page", () => {
    const followUpMics = (dialog: HTMLElement) =>
      [CHALLENGES, SOLUTIONS, ACTION_PLAN].map((question) => modalMic(dialog, question));

    async function recordInEditThenOpenModal() {
      renderWorkspace(completedDetail());
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      await act(async () => fireEvent.click(mic("What helped?")));
      return openModal();
    }

    it("disables every Follow-up mic while a Post-Session answer records, until its words arrive", async () => {
      const network = stubNetwork();
      const getUserMedia = installFakeMic();
      vi.useFakeTimers();
      const dialog = await recordInEditThenOpenModal();

      for (const button of followUpMics(dialog)) expect(button).toBeDisabled();
      expect(dialog).not.toHaveTextContent(/Recording|Transcribing|Dictation/);
      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      expect(getUserMedia).toHaveBeenCalledTimes(1);
      expect(FakeMediaRecorder.instances).toHaveLength(1);

      await act(async () => vi.advanceTimersByTimeAsync(120_000));
      expect(network.dictationCalls).toHaveLength(1);
      for (const button of followUpMics(dialog)) expect(button).toBeDisabled();
      await network.transcribe("Spoken in Notes");

      expect(box("What helped?")).toHaveValue("First answer Spoken in Notes");
      for (const button of followUpMics(dialog)) expect(button).toBeEnabled();
      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      expect(modalMic(dialog, CHALLENGES)).toHaveAttribute("aria-pressed", "true");
      expect(getUserMedia).toHaveBeenCalledTimes(2);
    });

    it("enables the Follow-up mics again once the Post-Session recording is dropped", async () => {
      stubNetwork();
      let dialog = await recordInEditThenOpenModal();
      for (const button of followUpMics(dialog)) expect(button).toBeDisabled();

      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(tracks[0].stop).toHaveBeenCalled();
      dialog = openModal();

      for (const button of followUpMics(dialog)) expect(button).toBeEnabled();
    });

    it("lets go of the mic and leaves the Follow-up mics enabled when the recorder can't start", async () => {
      const network = stubNetwork();
      vi.stubGlobal("MediaRecorder", class extends FakeMediaRecorder {
        start() { throw new DOMException("The stream is inactive", "NotSupportedError"); }
      });
      const dialog = await recordInEditThenOpenModal();

      expect(screen.getByText(/^This browser can't record audio\./)).toHaveAttribute("aria-live", "polite");
      expect(tracks[0].stop).toHaveBeenCalled();
      expect(mic("What helped?")).toHaveAttribute("aria-pressed", "false");
      expect(mic("What helped?")).toBeEnabled();
      for (const button of followUpMics(dialog)) expect(button).toBeEnabled();
      expect(network.dictationCalls).toHaveLength(0);
    });

    // The open modal covers the page, so a Mentor can't reach these mics; the
    // shared count still keeps them disabled while the Follow-up form records.
    it("disables the Post-Session mics while a Follow-up answer records, until the modal drops it", async () => {
      stubNetwork();
      const getUserMedia = installFakeMic();
      renderWorkspace(completedDetail());
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      const dialog = openModal();

      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      expect(mic("What helped?")).toBeDisabled();
      expect(mic("What happens next?")).toBeDisabled();
      // Only a form's own clip holds its save back.
      expect(screen.getByRole("button", { name: "Save Changes" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Save Changes" })).not.toHaveAccessibleDescription(SAVE_HINT);
      expect(screen.getAllByText(SAVE_HINT)).toEqual([within(dialog).getByText(SAVE_HINT)]);
      await act(async () => fireEvent.click(mic("What helped?")));
      expect(getUserMedia).toHaveBeenCalledTimes(1);

      await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" })));
      expect(mic("What helped?")).toBeEnabled();
      expect(mic("What happens next?")).toBeEnabled();
    });
  });

  describe("one daily count for both forms", () => {
    const LIMIT = "You've used today's 30 minutes of Dictation. You can keep typing.";

    it("stops a Follow-up recording at the time left after a Post-Session dictation", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      renderWorkspace(completedDetail());
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));

      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => vi.advanceTimersByTimeAsync(3_000));
      await act(async () => fireEvent.click(mic("What helped?")));
      await network.transcribe("Spoken in Notes", 30);
      const dialog = openModal();
      await act(async () => fireEvent.click(modalMic(dialog, CHALLENGES)));
      await act(async () => vi.advanceTimersByTimeAsync(30_000));

      expect(network.dictationCalls).toHaveLength(2);
      expect(network.dictationCalls[1].body.get("kind")).toBe("follow_up");
      expect(network.dictationCalls[1].body.get("duration_ms")).toBe("30000");
    });

    it("locks the Post-Session mics when a Follow-up dictation uses up today's time", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWorkspace(completedDetail());
      fireEvent.click(screen.getByRole("button", { name: "Edit Notes" }));
      const dialog = openModal();

      await dictate(dialog, CHALLENGES);
      await network.transcribe("Last words today", 0);
      expect(modalMic(dialog, SOLUTIONS)).toBeDisabled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(mic("What helped?")).toBeDisabled();
      expect(mic("What happens next?")).toBeDisabled();
      expect(screen.getAllByText(LIMIT)).toHaveLength(2);
      await act(async () => fireEvent.click(mic("What helped?")));
      expect(network.dictationCalls).toHaveLength(1);
    });

    it("takes a new count from the server when the page refreshes", async () => {
      const network = stubNetwork();
      vi.useFakeTimers();
      const detail = mentorDetail();
      const view = renderWorkspace(detail);
      const refresh = (remainingSeconds: number) => view.rerender(
        <StudentPhaseWorkspace schoolCode="SCH001" academicYear="2026-2027"
          detail={detail} dictation={{ enabled: true, remainingSeconds }} />);

      refresh(0);
      expect(mic("What helped?")).toBeDisabled();
      expect(screen.getAllByText(LIMIT)).toHaveLength(2);

      refresh(20);
      expect(mic("What helped?")).toBeEnabled();
      expect(screen.queryByText(LIMIT)).not.toBeInTheDocument();
      await act(async () => fireEvent.click(mic("What helped?")));
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
      expect(network.dictationCalls[0].body.get("duration_ms")).toBe("20000");
    });
  });

  describe("where the mic shows", () => {
    const savedNote = {
      id: 503, submittedAt: "2026-07-03T10:00:00Z", authorName: "Anita Sharma",
      answers: [{ key: "challenges" as const, answer: "Homesick" }],
    };

    it("shows no mic on saved Follow-up Note cards", () => {
      renderWorkspace(mentorDetail(submitted({ 91: "First answer", 92: "Then this" }),
        { progress: "completed", followUpNotes: [savedNote] }));

      expect(screen.getByText("Homesick")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Dictate/ })).not.toBeInTheDocument();
    });

    it("shows no mic on a read-only workspace, even with Dictation on", () => {
      const detail = mentorDetail(submitted({ 91: "First answer" }),
        { progress: "completed", canEditNotes: false, followUpNotes: [savedNote] });
      renderWorkspace({ ...detail, readOnly: true });

      expect(screen.getByText("Homesick")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Add notes" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Dictate/ })).not.toBeInTheDocument();
    });
  });
});
