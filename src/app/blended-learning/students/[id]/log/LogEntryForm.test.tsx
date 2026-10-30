import { render, screen, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MenteeRow } from "@/lib/blended-learning-mentees";

import type { PickedPhoto } from "./PhotoPicker";

// The notes editor, photo picker and recording upload have their own tests;
// here they are stand-ins that report what the form gives them.
vi.mock("./NotesEditor", () => ({
  NotesEditor: ({
    initialHtml,
    onChange,
    onEdit,
  }: {
    initialHtml?: string;
    onChange: (html: string) => void;
    onEdit?: () => void;
  }) => (
    <textarea
      aria-label="Notes"
      defaultValue={initialHtml}
      onChange={(event) => {
        onChange(event.target.value);
        onEdit?.();
      }}
    />
  ),
}));
vi.mock("./PhotoPicker", () => ({
  PhotoPicker: ({
    setPhotos,
    errors,
  }: {
    setPhotos: Dispatch<SetStateAction<PickedPhoto[]>>;
    errors: Record<string, string>;
  }) => (
    <div>
      <button
        type="button"
        onClick={() => setPhotos((current) => [...current, { id: 1, previewUrl: null, status: "done", s3Key: "photo-key" }])}
      >
        Add uploaded photo
      </button>
      <button type="button" onClick={() => setPhotos((current) => [...current, { id: 2, previewUrl: null, status: "uploading" }])}>
        Add uploading photo
      </button>
      {errors.photoKeys && <p>{errors.photoKeys}</p>}
    </div>
  ),
}));
// The draft's progress has its own tests; this stand-in shows the state and
// lets a test say the draft turned ready.
vi.mock("../DraftStatus", () => ({
  DraftStatus: ({ initialState, onReady }: { initialState: string; onReady?: () => void }) => (
    <div data-testid="draft-status">
      {initialState}
      <button type="button" onClick={onReady}>
        Draft turned ready
      </button>
    </div>
  ),
}));
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
// A test can say the picked recording's length was read.
vi.mock("./RecordingUpload", () => ({
  RecordingUpload: ({ sessionDetails, onDuration }: { sessionDetails: unknown; onDuration?: (minutes: number) => void }) => (
    <>
      <p data-testid="recording-upload">{JSON.stringify(sessionDetails)}</p>
      <button type="button" onClick={() => onDuration?.(42)}>
        Recording read as 42 minutes
      </button>
    </>
  ),
}));

import { LogEntryForm, type ReviewDraft } from "./LogEntryForm";

const TODAY = "2026-10-22";
const OPEN_ITEMS = [
  { id: 7, text: "Bring the admit card", owner: "student" as const, agreedOn: "2026-10-01", source: "conversation" as const },
];
const MENTEE: MenteeRow = {
  studentId: 501,
  name: "Asha Rao",
  gender: null,
  grade: 11,
  programId: 80,
  programName: null,
  lastContact: "2026-10-22",
  lastContactSource: "conversation",
  latestEntryKind: "conversation",
  openDraftState: null,
  reasons: [],
  daysSince: 0,
};
const DRAFT: ReviewDraft = {
  id: 44,
  occurredOn: "2026-10-20",
  mode: "call",
  spokeWith: "both",
  durationMinutes: 35,
  summary: "Discussed the mock test.",
  actionItems: [{ owner: "student", text: "Revise optics" }],
  notesHtml: "<p>Drafted</p>",
};

// No delay between keystrokes: these tests type a lot.
let userEvent: ReturnType<typeof userEventLib.setup>;

// The entries route is the form's network boundary.
const mockFetch = vi.fn();

function answer(body: unknown, status = 201) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

function sentBody(): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(String(init.body));
}

function renderForm(props: Partial<Parameters<typeof LogEntryForm>[0]> = {}) {
  return render(
    <LogEntryForm
      studentId={501}
      name="Asha Rao"
      firstName="Asha"
      today={TODAY}
      listGroup="Talk to first"
      subtitle="Asha Rao · Grade 11"
      lastConversationPanel={<p>Last conversation panel</p>}
      openActionItems={OPEN_ITEMS}
      hasOpenDraft={false}
      {...props}
    />
  );
}

// Call and Student are preselected; only the duration and summary are needed.
async function fillConversation() {
  await userEvent.type(screen.getByLabelText("Duration (minutes)"), "30");
  await userEvent.type(screen.getByLabelText("Summary"), "Talked about the mock test.");
}

function save(name = "Save conversation") {
  return userEvent.click(screen.getByRole("button", { name }));
}

// The saved confirmation's rows, as label → value.
function savedRows(saved: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    within(saved)
      .getAllByRole("term")
      .map((term) => [term.textContent, term.nextElementSibling?.textContent ?? ""])
  );
}

beforeEach(() => {
  userEvent = userEventLib.setup({ delay: null });
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LogEntryForm: layout", () => {
  it("titles the page and groups the form into Session details, Recording and Write-up cards", () => {
    renderForm();
    expect(screen.getByRole("heading", { level: 1, name: "Log a conversation" })).toBeInTheDocument();
    expect(screen.getByText("Asha Rao · Grade 11")).toBeInTheDocument();
    for (const card of ["Session details", "Recording", "Write-up"]) {
      expect(screen.getByRole("region", { name: card })).toBeInTheDocument();
    }
    const details = screen.getByRole("region", { name: "Session details" });
    expect(within(details).getByLabelText("Date")).toHaveValue(TODAY);
    expect(within(details).getByLabelText("Duration (minutes)")).toBeInTheDocument();
    expect(within(details).getByText("min")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Recording" })).getByTestId("recording-upload")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cancel" })).toHaveAttribute("href", "/blended-learning/students/501");
  });

  it("preselects a call with the Student, with Both as the third Spoke with option", () => {
    renderForm();
    expect(screen.getByRole("radio", { name: "Conversation" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Call" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Student" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Both" })).not.toBeChecked();
    expect(screen.getByRole("group", { name: "How" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Spoke with" })).toBeInTheDocument();
  });

  it("puts the write-up first, then photos, then Mentor Flags below the notes", () => {
    renderForm();
    const notes = screen.getByLabelText("Notes");
    const photos = screen.getByRole("button", { name: "Add uploaded photo" });
    const flags = screen.getByRole("group", { name: "Mentor Flags (optional)" });
    const summary = screen.getByLabelText("Summary");
    const actions = screen.getByRole("group", { name: "Action items" });
    expect(summary.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(actions.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notes.compareDocumentPosition(photos) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(photos.compareDocumentPosition(flags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("LogEntryForm: Action items", () => {
  it("starts with a blank Student row and a blank Mentor row, owned by Student, Mentor or Parent", () => {
    renderForm();
    expect(screen.getByLabelText("Who does action item 1")).toHaveValue("student");
    expect(screen.getByLabelText("Who does action item 2")).toHaveValue("mentor");
    expect(screen.getByLabelText("Action item 1")).toHaveValue("");
    expect(screen.getByLabelText("Action item 2")).toHaveValue("");
    const owners = within(screen.getByLabelText("Who does action item 1")).getAllByRole("option");
    expect(owners.map((option) => option.textContent)).toEqual(["Student", "Mentor", "Parent"]);
    expect(screen.queryByLabelText(/Due/)).not.toBeInTheDocument();
  });

  it("adds rows owned by the Student and removes them", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add an action" }));
    expect(screen.getByLabelText("Who does action item 3")).toHaveValue("student");
    await userEvent.click(screen.getByRole("button", { name: "Remove action item 1" }));
    expect(screen.queryByLabelText("Action item 3")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Who does action item 1")).toHaveValue("mentor");
  });

  it("saves only the rows with text, so blank starter rows never block saving", async () => {
    renderForm();
    await fillConversation();
    await userEvent.type(screen.getByLabelText("Action item 2"), "Share the notes");
    expect(screen.getByRole("button", { name: "Save conversation" })).toBeEnabled();

    answer({ entry: { id: 9 }, mentee: MENTEE });
    await save();
    expect(sentBody().actionItems).toEqual([{ owner: "mentor", text: "Share the notes" }]);
  });
});

describe("LogEntryForm: Conversation", () => {
  it("saves a Conversation's session details and Action Items, then confirms on the Mentor's own list", async () => {
    renderForm();
    expect(screen.getByText("Last conversation panel")).toBeInTheDocument();
    await fillConversation();
    expect(screen.getByTestId("recording-upload")).toHaveTextContent(
      JSON.stringify({ occurredOn: TODAY, mode: "call", spokeWith: "student", durationMinutes: 30 })
    );
    await userEvent.selectOptions(screen.getByLabelText("Who does action item 1"), "mentor");
    await userEvent.type(screen.getByLabelText("Action item 1"), "Share the notes");

    answer({ entry: { id: 9 }, mentee: { ...MENTEE, reasons: ["gap_30"] } });
    await save();

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/blended-learning/students/501/entries",
      expect.objectContaining({ method: "POST" })
    );
    expect(sentBody()).toEqual({
      kind: "conversation",
      occurredOn: TODAY,
      mode: "call",
      spokeWith: "student",
      durationMinutes: 30,
      summary: "Talked about the mock test.",
      notesHtml: "",
      actionItems: [{ owner: "mentor", text: "Share the notes" }],
      photoKeys: [],
      flags: [],
      completeActionItemIds: [],
    });

    const saved = await screen.findByRole("region", { name: "Saved" });
    const heading = within(saved).getByRole("heading", { name: "Conversation saved" });
    expect(heading).toHaveFocus();
    expect(saved).toHaveTextContent('Asha is still in "Talk to first" in your student list.');
    expect(savedRows(saved)).toMatchObject({
      Conversation: "22 Oct 2026 · Call · Student",
      Duration: "30 min",
      "Action items added": "1",
    });
    expect(within(saved).getByText("Why now")).toBeInTheDocument();
    expect(within(saved).getByText("Last contact")).toBeInTheDocument();
    expect(within(saved).queryByText("Action items closed")).not.toBeInTheDocument();
    expect(within(saved).getByRole("link", { name: "View Asha's history" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501"
    );
    expect(within(saved).getByRole("link", { name: "Back to students" })).toHaveAttribute("href", "/blended-learning");
    // The page title stays above the confirmation.
    expect(screen.getByRole("heading", { level: 1, name: "Log a conversation" })).toBeInTheDocument();
  });

  it("lists a Profile Doc item with the others, marked as from the Profile Doc, and ticks it the same way", async () => {
    renderForm({
      openActionItems: [
        ...OPEN_ITEMS,
        { id: 8, text: "Synthetic: pay the hostel fee", owner: "parent", agreedOn: "2026-06-14", source: "profile_doc" },
      ],
    });
    const panel = screen.getByRole("region", { name: "Open Action Items" });
    expect(within(panel).getByText("From 1 Oct 2026")).toBeInTheDocument();
    expect(within(panel).getByText("From Profile Doc · 14 Jun 2026")).toBeInTheDocument();
    await fillConversation();
    await userEvent.click(screen.getByRole("checkbox", { name: /Synthetic: pay the hostel fee/ }));

    answer({ entry: { id: 9 }, mentee: MENTEE });
    await save();

    expect(sentBody()).toMatchObject({ completeActionItemIds: [8] });
  });

  it("sends a Conversation's photo, Mentor Flags, ticks and notes, and lists them once saved", async () => {
    renderForm();
    await fillConversation();
    await userEvent.click(screen.getByRole("radio", { name: "Both" }));
    await userEvent.click(screen.getByRole("radio", { name: "In person" }));
    await userEvent.click(screen.getByRole("button", { name: "Add uploaded photo" }));
    await userEvent.click(screen.getByRole("switch", { name: "Flag to Physics teacher" }));
    await userEvent.type(screen.getByLabelText("Comment for the Physics teacher (optional)"), "Optics");
    await userEvent.click(screen.getByRole("switch", { name: /Flag to Shalini/ }));
    await userEvent.click(screen.getByRole("checkbox", { name: /Bring the admit card/ }));
    await userEvent.type(screen.getByLabelText("Notes"), "Fine");

    answer({ entry: { id: 9 }, mentee: MENTEE });
    await save();

    expect(sentBody()).toMatchObject({
      mode: "in_person",
      spokeWith: "both",
      notesHtml: "Fine",
      photoKeys: ["photo-key"],
      flags: [
        { recipient: "emotional_wellbeing", comment: null },
        { recipient: "physics", comment: "Optics" },
      ],
      completeActionItemIds: [7],
    });
    const saved = await screen.findByRole("region", { name: "Saved" });
    expect(savedRows(saved)).toMatchObject({
      Conversation: "22 Oct 2026 · In person · Student and parent",
      "Action items added": "0",
      "Action items closed": "1",
      "Photos attached": "1",
      "Flagged to Shalini": "No comment",
      "Flagged to the Physics teacher": "With your comment",
    });
    expect(saved).toHaveTextContent('Asha moved from "Talk to first" to "Everyone else" in your student list.');
  });

  it("explains only the well-being flag under its comment, not the subject flags", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("switch", { name: /Flag to Shalini/ }));
    for (const subject of ["Physics", "Chemistry", "Maths"]) {
      await userEvent.click(screen.getByRole("switch", { name: `Flag to ${subject} teacher` }));
    }

    expect(
      screen.getByText("Use this when something about the student's emotional well-being needs her attention. Shalini is emailed when you save.")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Comment for the Maths teacher (optional)")).toBeInTheDocument();
    expect(screen.queryByText(/teacher's attention/)).not.toBeInTheDocument();
  });

  it("turns a flag off again", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("switch", { name: "Flag to Maths teacher" }));
    expect(screen.getByLabelText("Comment for the Maths teacher (optional)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Flag to Maths teacher" }));
    expect(screen.queryByLabelText("Comment for the Maths teacher (optional)")).not.toBeInTheDocument();
  });

  it("shows the server's field errors by their fields and clears per-item ones when the list changes", async () => {
    renderForm();
    await fillConversation();
    // The second row is the only one sent, so the server calls it item 0.
    await userEvent.type(screen.getByLabelText("Action item 2"), "x");
    await userEvent.click(screen.getByRole("switch", { name: "Flag to Chemistry teacher" }));

    answer(
      {
        error: "Add a summary.",
        fieldErrors: {
          summary: "Add a summary.",
          mode: "Choose call or in person.",
          "actionItems.0.text": "Keep the Action Item shorter.",
          "flags.0.comment": "The comment must be text.",
          flags: "Mentor Flags must be a list.",
          photoKeys: "Photos must be a list.",
        },
      },
      422
    );
    await save();

    expect(await screen.findByText("Add a summary.")).toBeInTheDocument();
    expect(screen.getByText("Choose call or in person.")).toBeInTheDocument();
    expect(screen.getByText("Keep the Action Item shorter.")).toBeInTheDocument();
    expect(screen.getByLabelText("Action item 2")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Action item 1")).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByText("The comment must be text.")).toBeInTheDocument();
    expect(screen.getByText("Mentor Flags must be a list.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove action item 1" }));
    expect(screen.queryByText("Keep the Action Item shorter.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Flag to Chemistry teacher" }));
    expect(screen.queryByText("Mentor Flags must be a list.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add uploaded photo" }));
    expect(screen.queryByText("Photos must be a list.")).not.toBeInTheDocument();
    expect(screen.getByText("Add a summary.")).toBeInTheDocument();
  });

  it("waits for photos still uploading", async () => {
    renderForm();
    await fillConversation();
    await userEvent.click(screen.getByRole("button", { name: "Add uploading photo" }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wait for the photos to finish uploading, or remove the ones that failed."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows the server's message, and a connection error, and keeps the form", async () => {
    renderForm();
    await fillConversation();

    answer({ error: "Not found" }, 404);
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");

    mockFetch.mockRejectedValueOnce(new TypeError("offline"));
    await save();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Check your connection and try again.");
    expect(screen.getByRole("button", { name: "Save conversation" })).toBeEnabled();
  });

  it("says no recording can be uploaded while the Mentee has an open draft", () => {
    renderForm({ hasOpenDraft: true });
    expect(screen.getByText("Asha already has a Conversation Draft, so no recording can be uploaded now.")).toBeInTheDocument();
    expect(screen.queryByTestId("recording-upload")).not.toBeInTheDocument();
  });
});

describe("LogEntryForm: Duration from the recording", () => {
  it("fills a blank Duration from the recording's length, and it stays editable", async () => {
    renderForm();
    const duration = screen.getByLabelText("Duration (minutes)");
    await userEvent.click(screen.getByRole("button", { name: "Recording read as 42 minutes" }));
    expect(duration).toHaveValue(42);
    await userEvent.clear(duration);
    await userEvent.type(duration, "40");
    expect(duration).toHaveValue(40);
  });

  it("keeps a Duration the Mentor already typed", async () => {
    renderForm();
    const duration = screen.getByLabelText("Duration (minutes)");
    await userEvent.type(duration, "30");
    await userEvent.click(screen.getByRole("button", { name: "Recording read as 42 minutes" }));
    expect(duration).toHaveValue(30);
  });
});

describe("LogEntryForm: Attempt", () => {
  it("tells a Conversation's Mentor what ticking an Open Action Item does", () => {
    renderForm();
    expect(
      within(screen.getByRole("region", { name: "Open Action Items" })).getByText(
        "Tick what's done. Ticked items are removed when you save."
      )
    ).toBeInTheDocument();
  });

  it("saves an Attempt with only its date and note, then names the list group neutrally when the earlier one is unknown", async () => {
    renderForm({ listGroup: null });
    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    expect(screen.getByRole("heading", { level: 1, name: "Log an attempt" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Attempt details" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recording" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Write-up" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Summary")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Duration (minutes)")).not.toBeInTheDocument();
    expect(screen.getByText("Only a conversation can tick these done.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Bring the admit card/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Note (optional)"), "No answer");

    answer({ entry: { id: 10 }, mentee: MENTEE });
    await save("Log attempt");

    expect(sentBody()).toEqual({ kind: "attempt", occurredOn: TODAY, note: "No answer" });
    const saved = await screen.findByRole("region", { name: "Saved" });
    expect(within(saved).getByRole("heading", { name: "Attempt logged" })).toBeInTheDocument();
    expect(saved).toHaveTextContent('Asha is in "Everyone else" in the student list.');
    expect(savedRows(saved)).toMatchObject({ Attempt: "22 Oct 2026" });
    expect(within(saved).queryByText("Duration")).not.toBeInTheDocument();
    expect(within(saved).queryByText("Why now")).not.toBeInTheDocument();
  });

  it("confirms without the list summary when the Mentee is no longer listed", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    answer({ entry: { id: 11 }, mentee: null });
    await save("Log attempt");

    const saved = await screen.findByRole("region", { name: "Saved" });
    expect(saved).not.toHaveTextContent("student list");
    expect(within(saved).queryByText("Last contact")).not.toBeInTheDocument();
  });

  it("clears errors when switching between a Conversation and an Attempt, and changes the date", async () => {
    renderForm();
    await fillConversation();
    answer({ error: "Bad", fieldErrors: { occurredOn: "Enter the date." } }, 422);
    await userEvent.clear(screen.getByLabelText("Date"));
    await userEvent.type(screen.getByLabelText("Date"), "2026-10-21");
    await save();
    expect(await screen.findByText("Enter the date.")).toBeInTheDocument();
    expect(sentBody().occurredOn).toBe("2026-10-21");

    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    expect(screen.queryByText("Enter the date.")).not.toBeInTheDocument();
  });
});

describe("LogEntryForm: reviewing a draft", () => {
  it("opens prefilled as a Conversation and saves the draft", async () => {
    renderForm({ draft: DRAFT });
    expect(screen.getByRole("heading", { level: 1, name: "Review the draft for Asha Rao" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Attempt" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("recording-upload")).not.toBeInTheDocument();
    const recording = screen.getByRole("region", { name: "Recording" });
    expect(recording).toHaveTextContent("Call recording");
    expect(within(recording).getByRole("status")).toHaveTextContent("Drafted. Check and edit below");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-20");
    expect(screen.getByRole("radio", { name: "Both" })).toBeChecked();
    expect(screen.getByLabelText("Summary")).toHaveValue("Discussed the mock test.");
    // Only the draft's rows, no blank starter rows.
    expect(screen.getByLabelText("Action item 1")).toHaveValue("Revise optics");
    expect(screen.queryByLabelText("Action item 2")).not.toBeInTheDocument();

    answer({ entry: { id: 12 }, mentee: MENTEE });
    await save();

    expect(sentBody()).toMatchObject({
      kind: "conversation",
      occurredOn: "2026-10-20",
      mode: "call",
      spokeWith: "both",
      durationMinutes: 35,
      notesHtml: "<p>Drafted</p>",
      actionItems: [{ owner: "student", text: "Revise optics" }],
      draftId: 44,
    });
    expect(await screen.findByRole("heading", { name: "Conversation saved" })).toBeInTheDocument();
  });

  it("marks the summary, action items and notes as drafted until each is edited", async () => {
    renderForm({ draft: DRAFT });
    expect(screen.getAllByText("Drafted from the recording")).toHaveLength(2);
    expect(screen.getByText("Written from the recording")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Summary"), " More.");
    expect(screen.getAllByText("Drafted from the recording")).toHaveLength(1);
    await userEvent.type(screen.getByLabelText("Action item 1"), " today");
    expect(screen.queryByText("Drafted from the recording")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Notes"), "!");
    expect(screen.queryByText("Written from the recording")).not.toBeInTheDocument();
  });

  it("opens the starter rows for a draft without Action Items", () => {
    renderForm({ draft: { ...DRAFT, actionItems: [] } });
    expect(screen.getByLabelText("Who does action item 1")).toHaveValue("student");
    expect(screen.getByLabelText("Who does action item 2")).toHaveValue("mentor");
  });

  it("shows no drafted marks on a new log", () => {
    renderForm();
    expect(screen.queryByText("Drafted from the recording")).not.toBeInTheDocument();
    expect(screen.queryByText("Written from the recording")).not.toBeInTheDocument();
  });

  it("shows no Open Action Items when there are none", () => {
    renderForm({ draft: DRAFT, openActionItems: [] });
    expect(screen.queryByRole("region", { name: "Open Action Items" })).not.toBeInTheDocument();
  });
});

describe("LogEntryForm: a draft being drafted", () => {
  it("shows its progress in the Recording card, holds the write-up under its labels and refreshes once ready", async () => {
    mockRefresh.mockReset();
    renderForm({ hasOpenDraft: true, pendingDraft: { id: 44, state: "transcribing", retryOffered: false } });
    const recording = screen.getByRole("region", { name: "Recording" });
    expect(within(recording).getByTestId("draft-status")).toHaveTextContent("transcribing");
    expect(screen.queryByTestId("recording-upload")).not.toBeInTheDocument();

    const writeUp = screen.getByRole("region", { name: "Write-up" });
    expect(within(writeUp).queryByLabelText("Summary")).not.toBeInTheDocument();
    expect(within(writeUp).queryByRole("group", { name: "Action items" })).not.toBeInTheDocument();
    for (const label of ["Summary", "Action items", "Notes"]) {
      expect(within(writeUp).getByText(label)).toBeInTheDocument();
    }
    expect(within(writeUp).getAllByText("Filling in from the recording…")).toHaveLength(3);
    // Photos and flags can still be added.
    expect(within(writeUp).getByRole("button", { name: "Add uploaded photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drafting…" })).toBeDisabled();
    expect(screen.queryByText(/To save, fill in/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Draft turned ready" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("still saves an Attempt while drafting", async () => {
    renderForm({ hasOpenDraft: true, pendingDraft: { id: 44, state: "transcribing", retryOffered: false } });
    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    expect(screen.getByRole("button", { name: "Log attempt" })).toBeEnabled();
  });

  it("lets a failed draft be retried or discarded while the write-up can be typed", async () => {
    renderForm({ hasOpenDraft: true, pendingDraft: { id: 44, state: "failed", retryOffered: true } });
    expect(screen.getByTestId("draft-status")).toHaveTextContent("failed");
    await fillConversation();
    expect(screen.getByRole("button", { name: "Save conversation" })).toBeEnabled();
  });
});

describe("LogEntryForm: required fields", () => {
  it("keeps Save conversation disabled, saying what is missing, until the required fields are filled", async () => {
    renderForm();
    const save = screen.getByRole("button", { name: "Save conversation" });
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("To save, fill in: Duration, Summary.");

    await userEvent.type(screen.getByLabelText("Duration (minutes)"), "30");
    expect(save).toHaveAccessibleDescription("To save, fill in: Summary.");
    // Spaces alone are not a summary.
    await userEvent.type(screen.getByLabelText("Summary"), "   ");
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText("Summary"), "Talked.");
    expect(save).toBeEnabled();
    expect(screen.queryByText(/To save, fill in/)).not.toBeInTheDocument();
  });

  it("asks how and who for a draft that has neither", () => {
    renderForm({ draft: { ...DRAFT, mode: null, spokeWith: null } });
    expect(screen.getByRole("button", { name: "Save conversation" })).toHaveAccessibleDescription(
      "To save, fill in: How, Spoke with."
    );
    expect(screen.getByRole("radio", { name: "Call" })).not.toBeChecked();
  });

  it("needs only the date for an Attempt", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    const save = screen.getByRole("button", { name: "Log attempt" });
    expect(save).toBeEnabled();
    await userEvent.clear(screen.getByLabelText("Date"));
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription("To save, fill in: Date.");
  });
});
