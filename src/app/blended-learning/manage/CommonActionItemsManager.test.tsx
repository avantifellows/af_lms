import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import type { CommonActionItem } from "@/lib/blended-learning-common-action-items";

import { CommonActionItemsManager } from "./CommonActionItemsManager";

const mockFetch = vi.fn();
const MENTORS = [
  { userId: 77, name: "Faizan Khan", students: 3 },
  { userId: 78, name: "Juned Ali", students: 1 },
];
const ITEMS: CommonActionItem[] = [
  {
    id: 8, text: "Fill in the scholarship form", owner: "student", target: { kind: "mentor", mentorUserId: 77 },
    targetMentorName: "Faizan Khan", openCount: 2, doneCount: 1, notYetAdded: 1, createdOn: "2026-10-27",
  },
  {
    id: 7, text: "Bring the admit card", owner: "parent", target: { kind: "grade", grade: 13 },
    targetMentorName: null, openCount: 1, doneCount: 0, notYetAdded: 0, createdOn: "2026-10-26",
  },
];

// The preview route answers with previewCount (and any unmatched IDs), or
// with previewReply when a test sets it; writes answer by queue.
const writes: Response[] = [];
let previewCount = 5;
let unmatched = { notFound: [] as string[], noMentor: [] as string[] };
let previewReply: (() => Promise<Response>) | null = null;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function writeCalls() {
  return mockFetch.mock.calls
    .filter(([url]) => !String(url).includes("/preview"))
    .map(([url, init]) => ({ url, method: init?.method, body: init?.body ? JSON.parse(init.body) : undefined }));
}

function previewBodies() {
  return mockFetch.mock.calls
    .filter(([url]) => String(url).includes("/preview"))
    .map(([url, init]) => ({ url, method: init?.method, body: JSON.parse(init.body) }));
}

beforeEach(() => {
  writes.length = 0;
  previewCount = 5;
  unmatched = { notFound: [], noMentor: [] };
  previewReply = null;
  mockRefresh.mockReset();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) =>
    url.includes("/preview")
      ? (previewReply?.() ?? json({ count: previewCount, ...unmatched }))
      : (writes.shift() ?? json({ error: "Unexpected" }, 500))
  );
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CommonActionItemsManager — pushed items", () => {
  it("lists each item with its owner, target and open, done and not-yet-added counts", () => {
    render(<CommonActionItemsManager items={ITEMS} mentors={MENTORS} />);

    const [first, second] = within(screen.getByRole("list", { name: "Program action items" })).getAllByRole("listitem");
    expect(first).toHaveTextContent("StudentFill in the scholarship form");
    expect(first).toHaveTextContent("Faizan Khan's students");
    expect(first).toHaveTextContent("Open2Done1Not yet added1");
    expect(second).toHaveTextContent("Grade 13 students");
    expect(second).not.toHaveTextContent("Not yet added");
    expect(within(second).getByRole("button", { name: "Push again: Bring the admit card" })).toBeDisabled();
  });

  it("says so when nothing has been pushed", () => {
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    expect(screen.getByText("None yet.")).toBeInTheDocument();
  });

  it("pushes again after confirming how many it adds", async () => {
    const user = userEvent.setup();
    writes.push(json({ added: 1 }));
    render(<CommonActionItemsManager items={ITEMS} mentors={MENTORS} />);

    await user.click(screen.getByRole("button", { name: "Push again: Fill in the scholarship form" }));
    const dialog = screen.getByRole("dialog", { name: "Push this action item again?" });
    expect(dialog).toHaveTextContent("Will be added to 1 student who doesn't have it yet.");
    await user.click(within(dialog).getByRole("button", { name: "Push" }));

    expect(writeCalls()).toEqual([{ url: "/api/blended-learning/common-action-items/8/push", method: "POST", body: undefined }]);
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Added to 1 student.");
  });

  it("says when pushing again added it to no one, as when they got it meanwhile", async () => {
    const user = userEvent.setup();
    writes.push(json({ added: 0 }));
    render(<CommonActionItemsManager items={ITEMS} mentors={MENTORS} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();

    await user.click(screen.getByRole("button", { name: "Push again: Fill in the scholarship form" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Push" }));

    expect(screen.getByRole("status")).toHaveTextContent("Added to 0 students.");
  });

  it("removes after confirming what is deleted and kept, and shows a failure in the dialog", async () => {
    const user = userEvent.setup();
    writes.push(json({ error: "Not found" }, 404));
    render(<CommonActionItemsManager items={ITEMS} mentors={MENTORS} />);

    await user.click(screen.getByRole("button", { name: "Remove: Fill in the scholarship form" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this action item?" });
    expect(dialog).toHaveTextContent("Deletes it from the 2 students who still have it open. The 1 done stays in their history.");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(writeCalls()).toEqual([{ url: "/api/blended-learning/common-action-items/8", method: "DELETE", body: undefined }]);
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Not found");
    expect(mockRefresh).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // One open, none done: no word about done ones.
    await user.click(screen.getByRole("button", { name: "Remove: Bring the admit card" }));
    const single = screen.getByRole("dialog", { name: "Remove this action item?" });
    expect(single).toHaveTextContent("Deletes it from the 1 student who still has it open.");
    expect(single).not.toHaveTextContent(/done/);
  });

  it("edits the text and owner of an item in place", async () => {
    const user = userEvent.setup();
    writes.push(json({ error: "Enter the action item.", fieldErrors: { text: "Enter the action item." } }, 422));
    writes.push(json({ updatedOpen: 2 }));
    render(<CommonActionItemsManager items={ITEMS} mentors={MENTORS} />);

    await user.click(screen.getByRole("button", { name: "Edit: Fill in the scholarship form" }));
    const form = screen.getByRole("form", { name: "Edit program action item" });
    expect(form).toHaveTextContent("Changes the 2 students who still have it open.");
    await user.click(within(form).getByRole("button", { name: "Save" }));
    expect(within(form).getByText("Enter the action item.")).toBeInTheDocument();

    await user.clear(within(form).getByLabelText("Action item"));
    await user.type(within(form).getByLabelText("Action item"), "Submit the scholarship form");
    await user.selectOptions(within(form).getByLabelText("Who does it"), "parent");
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(writeCalls()[1]).toEqual({
      url: "/api/blended-learning/common-action-items/8",
      method: "PATCH",
      body: { text: "Submit the scholarship form", owner: "parent" },
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("form", { name: "Edit program action item" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit: Bring the admit card" }));
    expect(screen.getByRole("form", { name: "Edit program action item" })).toHaveTextContent(
      "Changes the 1 student who still has it open."
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form", { name: "Edit program action item" })).not.toBeInTheDocument();
  });
});

describe("CommonActionItemsManager — a new item", () => {
  it("previews the target's count, confirms, pushes and resets", async () => {
    const user = userEvent.setup();
    writes.push(json({ id: 9, added: 3 }, 201));
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });

    expect(await within(form).findByText("Will be added to 5 students.")).toBeInTheDocument();
    expect(previewBodies()).toEqual([
      {
        url: "/api/blended-learning/common-action-items/preview",
        method: "POST",
        body: { kind: "all", grade: "12", mentorUserId: "", studentIds: "" },
      },
    ]);

    // One line, as on the Mentor's log form, capped at 200 (the DB allows 500).
    const text = within(form).getByLabelText("Action item");
    expect(text.tagName).toBe("INPUT");
    expect(text).toHaveAttribute("maxlength", "200");
    await user.type(text, "Fill in the scholarship form");
    expect(within(form).getByText("28/200")).toBeInTheDocument();
    await user.selectOptions(within(form).getByLabelText("Who does it"), "mentor");
    await user.click(within(form).getByRole("radio", { name: "One mentor's students" }));
    expect(within(form).getByText("Choose a mentor to see how many students get it.")).toBeInTheDocument();
    previewCount = 3;
    await user.selectOptions(within(form).getByLabelText("Mentor"), "77");
    expect(await within(form).findByText("Will be added to 3 students.")).toBeInTheDocument();
    expect(previewBodies().at(-1)?.body).toEqual({ kind: "mentor", grade: "12", mentorUserId: "77", studentIds: "" });

    await user.click(within(form).getByRole("button", { name: "Push to students" }));
    const dialog = screen.getByRole("dialog", { name: "Push this action item?" });
    expect(dialog).toHaveTextContent("Fill in the scholarship form");
    expect(dialog).toHaveTextContent("Faizan Khan's students · Will be added to 3 students.");
    await user.click(within(dialog).getByRole("button", { name: "Push" }));

    expect(writeCalls()).toEqual([
      {
        url: "/api/blended-learning/common-action-items",
        method: "POST",
        body: {
          text: "Fill in the scholarship form",
          owner: "mentor",
          target: { kind: "mentor", grade: "12", mentorUserId: "77", studentIds: "" },
        },
      },
    ]);
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(form).getByLabelText("Action item")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Added to 3 students.");
  });

  it("previews pasted Student IDs, naming the ones not found or with no mentor, and pushes to the rest", async () => {
    const user = userEvent.setup();
    writes.push(json({ id: 10, added: 2 }, 201));
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });
    await within(form).findByText("Will be added to 5 students.");

    await user.type(within(form).getByLabelText("Action item"), "Bring the signed form");
    await user.click(within(form).getByRole("radio", { name: "Specific students" }));
    expect(within(form).getByText("Paste Student IDs to see how many students get it.")).toBeInTheDocument();
    previewCount = 2;
    unmatched = { notFound: ["99999999"], noMentor: ["0012345678", "0087654321"] };
    await user.type(within(form).getByLabelText("Student IDs"), "01234567890, 12345678{Enter}99999999 0012345678 0087654321");

    expect(await within(form).findByText("Will be added to 2 students.")).toBeInTheDocument();
    expect(form).toHaveTextContent("1 ID not found: 99999999");
    expect(form).toHaveTextContent("2 IDs found but with no active mentor: 0012345678, 0087654321");
    expect(previewBodies().at(-1)?.body).toEqual({
      kind: "students",
      grade: "12",
      mentorUserId: "",
      studentIds: "01234567890, 12345678\n99999999 0012345678 0087654321",
    });

    await user.click(within(form).getByRole("button", { name: "Push to students" }));
    const dialog = screen.getByRole("dialog", { name: "Push this action item?" });
    expect(dialog).toHaveTextContent("Specific students (5 IDs listed) · Will be added to 2 students.");
    expect(dialog).toHaveTextContent("1 ID not found: 99999999");
    await user.click(within(dialog).getByRole("button", { name: "Push" }));
    expect(writeCalls()[0].body.target).toMatchObject({ kind: "students" });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it("checks the form before confirming, and blocks a target with no students", async () => {
    const user = userEvent.setup();
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });

    await user.click(within(form).getByRole("radio", { name: "One mentor's students" }));
    await user.click(within(form).getByRole("button", { name: "Push to students" }));
    expect(within(form).getByText("Enter the action item.")).toBeInTheDocument();
    expect(within(form).getByText("Choose a mentor.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    previewCount = 0;
    await user.click(within(form).getByRole("radio", { name: "One grade" }));
    await user.selectOptions(within(form).getByLabelText("Grade"), "13");
    expect(await within(form).findByText("No students match this target.")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Push to students" })).toBeDisabled();
  });

  it("keeps Push off while counting, including while typing pauses, and for each new target", async () => {
    const user = userEvent.setup();
    let answer: (response: Response) => void = () => {};
    previewReply = () => new Promise((resolve) => (answer = resolve));
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });
    const pushButton = within(form).getByRole("button", { name: "Push to students" });

    await user.type(within(form).getByLabelText("Action item"), "Fill in the form");
    expect(within(form).getByText("Counting students…")).toBeInTheDocument();
    expect(pushButton).toBeDisabled();
    answer(json({ count: 5, notFound: [], noMentor: [] }));
    expect(await within(form).findByText("Will be added to 5 students.")).toBeInTheDocument();
    expect(pushButton).toBeEnabled();

    // Typing IDs: off at once, through the pause and until that count lands.
    await user.click(within(form).getByRole("radio", { name: "Specific students" }));
    await user.type(within(form).getByLabelText("Student IDs"), "12345678");
    expect(within(form).getByText("Counting students…")).toBeInTheDocument();
    expect(pushButton).toBeDisabled();
    await user.click(pushButton);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(previewBodies()).toHaveLength(2));
    expect(pushButton).toBeDisabled();
    answer(json({ count: 1, notFound: [], noMentor: [] }));
    expect(await within(form).findByText("Will be added to 1 student.")).toBeInTheDocument();
    expect(pushButton).toBeEnabled();
  });

  it("shows why the preview turned pasted IDs down and keeps Push off", async () => {
    const user = userEvent.setup();
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });
    await within(form).findByText("Will be added to 5 students.");

    previewReply = async () =>
      json({ error: "Check the target.", fieldErrors: { studentIds: "Paste at most 1000 Student IDs." } }, 422);
    await user.type(within(form).getByLabelText("Action item"), "Fill in the form");
    await user.click(within(form).getByRole("radio", { name: "Specific students" }));
    await user.type(within(form).getByLabelText("Student IDs"), "12345678");

    expect(await within(form).findByRole("alert")).toHaveTextContent("Paste at most 1000 Student IDs.");
    expect(within(form).queryByText("Counting students…")).not.toBeInTheDocument();
    expect(within(form).getByLabelText("Student IDs")).toHaveAttribute("aria-invalid", "true");
    // Retrying the same IDs can't help; editing them asks again.
    expect(within(form).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Push to students" })).toBeDisabled();

    previewReply = null;
    previewCount = 1;
    await user.type(within(form).getByLabelText("Student IDs"), "9");
    expect(await within(form).findByText("Will be added to 1 student.")).toBeInTheDocument();
    expect(within(form).getByLabelText("Student IDs")).toHaveAttribute("aria-invalid", "false");
    expect(within(form).getByRole("button", { name: "Push to students" })).toBeEnabled();
  });

  it("says when the preview fails, keeps Push off and counts again on Retry", async () => {
    const user = userEvent.setup();
    previewReply = async () => json({ error: "Something broke" }, 500);
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });

    expect(await within(form).findByRole("alert")).toHaveTextContent("Couldn't count students. Something broke");
    expect(within(form).getByRole("button", { name: "Push to students" })).toBeDisabled();

    // A network error says so too.
    previewReply = async () => {
      throw new TypeError("Failed to fetch");
    };
    await user.click(within(form).getByRole("button", { name: "Retry" }));
    expect(await within(form).findByText("Couldn't count students. Couldn't reach the server. Try again.")).toBeInTheDocument();
    expect(previewBodies()).toHaveLength(2);

    previewReply = null;
    await user.click(within(form).getByRole("button", { name: "Retry" }));
    expect(await within(form).findByText("Will be added to 5 students.")).toBeInTheDocument();
    expect(within(form).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Push to students" })).toBeEnabled();
  });

  it("puts a 422's field errors back on the form, and keeps a server error in the dialog", async () => {
    const user = userEvent.setup();
    writes.push(json({ error: "Forbidden" }, 403));
    writes.push(
      json({ error: "No students", fieldErrors: { target: "No students match this target. Choose another." } }, 422)
    );
    render(<CommonActionItemsManager items={[]} mentors={MENTORS} />);
    const form = screen.getByRole("form", { name: "New program action item" });
    await within(form).findByText("Will be added to 5 students.");

    await user.type(within(form).getByLabelText("Action item"), "Fill in the form");
    await user.click(within(form).getByRole("button", { name: "Push to students" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Push" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Forbidden");

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Push" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(form).getByText("No students match this target. Choose another.")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();

    await user.click(within(form).getByRole("button", { name: "Push to students" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
