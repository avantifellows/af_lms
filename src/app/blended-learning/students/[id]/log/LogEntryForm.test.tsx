import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Dispatch, SetStateAction } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MenteeRow } from "@/lib/blended-learning-mentees";

import type { PickedPhoto } from "./PhotoPicker";

// The notes editor, photo picker and recording upload have their own tests;
// here they are stand-ins that report what the form gives them.
vi.mock("./NotesEditor", () => ({
  NotesEditor: ({ initialHtml, onChange }: { initialHtml?: string; onChange: (html: string) => void }) => (
    <textarea aria-label="Notes" defaultValue={initialHtml} onChange={(event) => onChange(event.target.value)} />
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
vi.mock("./RecordingUpload", () => ({
  RecordingUpload: ({ sessionDetails }: { sessionDetails: unknown }) => (
    <p data-testid="recording-upload">{JSON.stringify(sessionDetails)}</p>
  ),
}));

import { LogEntryForm, type ReviewDraft } from "./LogEntryForm";

const TODAY = "2026-10-22";
const OPEN_ITEMS = [
  { id: 7, text: "Bring the admit card", owner: "student" as const, dueOn: null, agreedOn: "2026-10-01" },
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
  actionItems: [{ owner: "student", text: "Revise optics", dueOn: null }],
  notesHtml: "<p>Drafted</p>",
  itemsToVerify: ["The mock test date"],
};

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
      forOwnList
      lastConversationPanel={<p>Last conversation panel</p>}
      openActionItems={OPEN_ITEMS}
      hasOpenDraft={false}
      {...props}
    />
  );
}

async function fillConversation() {
  await userEvent.click(screen.getByRole("radio", { name: "Call" }));
  await userEvent.click(screen.getByRole("radio", { name: "Student" }));
  await userEvent.type(screen.getByLabelText("Duration (minutes)"), "30");
  await userEvent.type(screen.getByLabelText("Summary"), "Talked about the mock test.");
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LogEntryForm: Conversation", () => {
  it("saves a Conversation with its Action Items, photo, flags and ticks, then confirms", async () => {
    renderForm();
    expect(screen.getByText("Last conversation panel")).toBeInTheDocument();
    await fillConversation();
    expect(screen.getByTestId("recording-upload")).toHaveTextContent(
      JSON.stringify({ occurredOn: TODAY, mode: "call", spokeWith: "student", durationMinutes: 30 })
    );

    await userEvent.click(screen.getByRole("button", { name: "Add Action Item" }));
    const item = screen.getByRole("group", { name: "Action Item 1" });
    await userEvent.selectOptions(within(item).getByLabelText("Owner"), "mentor");
    await userEvent.type(within(item).getByLabelText("What"), "Share the notes");
    await userEvent.type(within(item).getByLabelText("Due (optional)"), "2026-10-30");
    await userEvent.click(screen.getByRole("button", { name: "Add uploaded photo" }));
    await userEvent.click(screen.getByRole("switch", { name: "Physics Teacher" }));
    await userEvent.type(screen.getByLabelText("Comment for Physics Teacher (optional)"), "Optics");
    await userEvent.click(screen.getByRole("checkbox", { name: /Bring the admit card/ }));
    await userEvent.type(screen.getByLabelText("Notes"), "<p>Fine</p>");

    answer({ entry: { id: 9 }, mentee: { ...MENTEE, reasons: ["gap_30"] } });
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));

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
      notesHtml: "<p>Fine</p>",
      actionItems: [{ owner: "mentor", text: "Share the notes", dueOn: "2026-10-30" }],
      photoKeys: ["photo-key"],
      flags: [{ recipient: "physics", comment: "Optics" }],
      completeActionItemIds: [7],
    });

    const saved = await screen.findByRole("region", { name: "Saved" });
    expect(within(saved).getByRole("heading", { name: "Conversation saved" })).toBeInTheDocument();
    expect(saved).toHaveTextContent("Your Mentee list now shows Asha Rao in Talk to First.");
    expect(within(saved).getByText("Why now")).toBeInTheDocument();
    expect(within(saved).getByRole("link", { name: "View Asha's history" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501"
    );
    expect(within(saved).getByRole("link", { name: "Back to Mentees" })).toHaveAttribute("href", "/blended-learning");
  });

  it("turns a flag off again and removes an Action Item", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("switch", { name: "Maths Teacher" }));
    expect(screen.getByLabelText("Comment for Maths Teacher (optional)")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Maths Teacher" }));
    expect(screen.queryByLabelText("Comment for Maths Teacher (optional)")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add Action Item" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByRole("group", { name: "Action Item 1" })).not.toBeInTheDocument();
  });

  it("shows the server's field errors by their fields and clears per-item ones when the list changes", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add Action Item" }));
    await userEvent.click(screen.getByRole("switch", { name: "Chemistry Teacher" }));

    answer(
      {
        error: "Add a summary.",
        fieldErrors: {
          summary: "Add a summary.",
          mode: "Choose call or in person.",
          "actionItems.0.text": "Add the Action Item.",
          "flags.0.comment": "The comment must be text.",
          flags: "Mentor Flags must be a list.",
          photoKeys: "Photos must be a list.",
        },
      },
      422
    );
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));

    expect(await screen.findByText("Add a summary.")).toBeInTheDocument();
    expect(screen.getByText("Choose call or in person.")).toBeInTheDocument();
    expect(screen.getByText("Add the Action Item.")).toBeInTheDocument();
    expect(screen.getByText("The comment must be text.")).toBeInTheDocument();
    expect(screen.getByText("Mentor Flags must be a list.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(screen.queryByText("Add the Action Item.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Chemistry Teacher" }));
    expect(screen.queryByText("Mentor Flags must be a list.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add uploaded photo" }));
    expect(screen.queryByText("Photos must be a list.")).not.toBeInTheDocument();
    expect(screen.getByText("Add a summary.")).toBeInTheDocument();
  });

  it("waits for photos still uploading", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Add uploading photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Wait for the photos to finish uploading, or remove the ones that failed."
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows the server's message, and a connection error, and keeps the form", async () => {
    renderForm();
    await fillConversation();

    answer({ error: "Not found" }, 404);
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not found");

    mockFetch.mockRejectedValueOnce(new TypeError("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save. Check your connection and try again.");
    expect(screen.getByRole("button", { name: "Save Conversation" })).toBeEnabled();
  });

  it("says no recording can be uploaded while the Mentee has an open draft", () => {
    renderForm({ hasOpenDraft: true });
    expect(screen.getByText("Asha already has a Conversation Draft, so no recording can be uploaded now.")).toBeInTheDocument();
    expect(screen.queryByTestId("recording-upload")).not.toBeInTheDocument();
  });
});

describe("LogEntryForm: Attempt", () => {
  it("saves an Attempt with only its date and note, then confirms on the mapped Mentor's list", async () => {
    renderForm({ forOwnList: false });
    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    expect(screen.queryByLabelText("Summary")).not.toBeInTheDocument();
    expect(screen.getByText("Only a Conversation can tick these done.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /Bring the admit card/ })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Note (optional)"), "No answer");

    answer({ entry: { id: 10 }, mentee: MENTEE });
    await userEvent.click(screen.getByRole("button", { name: "Save Attempt" }));

    expect(sentBody()).toEqual({ kind: "attempt", occurredOn: TODAY, note: "No answer" });
    const saved = await screen.findByRole("region", { name: "Saved" });
    expect(within(saved).getByRole("heading", { name: "Attempt saved" })).toBeInTheDocument();
    expect(saved).toHaveTextContent("The Mentee list now shows Asha Rao in Everyone else.");
    expect(within(saved).queryByText("Why now")).not.toBeInTheDocument();
  });

  it("confirms without the list summary when the Mentee is no longer listed", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    answer({ entry: { id: 11 }, mentee: null });
    await userEvent.click(screen.getByRole("button", { name: "Save Attempt" }));

    const saved = await screen.findByRole("region", { name: "Saved" });
    expect(saved).not.toHaveTextContent("Mentee list now shows");
  });

  it("clears errors when switching between a Conversation and an Attempt, and changes the date", async () => {
    renderForm();
    answer({ error: "Bad", fieldErrors: { occurredOn: "Enter the date." } }, 422);
    await userEvent.clear(screen.getByLabelText("Date"));
    await userEvent.type(screen.getByLabelText("Date"), "2026-10-21");
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));
    expect(await screen.findByText("Enter the date.")).toBeInTheDocument();
    expect(sentBody().occurredOn).toBe("2026-10-21");

    await userEvent.click(screen.getByRole("radio", { name: "Attempt" }));
    expect(screen.queryByText("Enter the date.")).not.toBeInTheDocument();
  });
});

describe("LogEntryForm: reviewing a draft", () => {
  it("opens prefilled as a Conversation, lists Items to Verify and saves the draft", async () => {
    renderForm({ draft: DRAFT });
    expect(screen.queryByRole("radio", { name: "Attempt" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("recording-upload")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-20");
    expect(screen.getByLabelText("Summary")).toHaveValue("Discussed the mock test.");

    const verify = screen.getByRole("region", { name: "Items to Verify" });
    const check = within(verify).getByRole("checkbox", { name: "The mock test date" });
    await userEvent.click(check);
    expect(check).toBeChecked();
    await userEvent.click(check);
    expect(check).not.toBeChecked();

    answer({ entry: { id: 12 }, mentee: MENTEE });
    await userEvent.click(screen.getByRole("button", { name: "Save Conversation" }));

    expect(sentBody()).toMatchObject({
      kind: "conversation",
      occurredOn: "2026-10-20",
      mode: "call",
      spokeWith: "both",
      durationMinutes: 35,
      notesHtml: "<p>Drafted</p>",
      actionItems: [{ owner: "student", text: "Revise optics", dueOn: null }],
      draftId: 44,
    });
    expect(await screen.findByRole("heading", { name: "Conversation saved" })).toBeInTheDocument();
  });

  it("shows no Items to Verify panel when the draft has none, nor Open Action Items when there are none", () => {
    renderForm({ draft: { ...DRAFT, itemsToVerify: [] }, openActionItems: [] });
    expect(screen.queryByRole("region", { name: "Items to Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Open Action Items" })).not.toBeInTheDocument();
  });
});
