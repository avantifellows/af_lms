import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationNotes } from "./ConversationNotes";

// The notes route is the component's network boundary.
const mockFetch = vi.fn();

function answer(body: unknown, status = 200) {
  mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConversationNotes", () => {
  it("loads the notes on first expand and keeps them for later expands", async () => {
    const user = userEvent.setup();
    answer({ notesHtml: "<h3>Academics</h3><p>Physics is weak</p>" });
    render(<ConversationNotes conversationId={12} />);
    expect(mockFetch).not.toHaveBeenCalled();

    const toggle = screen.getByRole("button", { name: "Show notes" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "conversation-12-notes");
    await user.click(toggle);

    expect(await screen.findByRole("heading", { name: "Academics" })).toBeInTheDocument();
    expect(screen.getByText("Physics is weak")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/blended-learning/conversations/12/notes");
    expect(screen.getByRole("button", { name: "Hide notes" })).toHaveAttribute("aria-expanded", "true");

    await user.click(screen.getByRole("button", { name: "Hide notes" }));
    expect(screen.queryByText("Physics is weak")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show notes" }));
    expect(screen.getByText("Physics is weak")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("shows a loading line while the notes are on their way", async () => {
    const user = userEvent.setup();
    let resolve!: (res: Response) => void;
    mockFetch.mockReturnValueOnce(new Promise<Response>((r) => (resolve = r)));
    render(<ConversationNotes conversationId={12} />);

    await user.click(screen.getByRole("button", { name: "Show notes" }));
    expect(screen.getByText("Loading notes…")).toBeInTheDocument();

    // Collapsing and expanding again while loading does not fetch twice.
    await user.click(screen.getByRole("button", { name: "Hide notes" }));
    await user.click(screen.getByRole("button", { name: "Show notes" }));
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await act(async () => resolve(new Response(JSON.stringify({ notesHtml: "<p>Done</p>" }))));
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Loading notes…")).not.toBeInTheDocument();
  });

  it("shows an empty panel for a Conversation saved without notes", async () => {
    const user = userEvent.setup();
    answer({ notesHtml: null });
    render(<ConversationNotes conversationId={12} />);

    await user.click(screen.getByRole("button", { name: "Show notes" }));

    await vi.waitFor(() => expect(screen.queryByText("Loading notes…")).not.toBeInTheDocument());
    expect(screen.queryByText(/Couldn't load/)).not.toBeInTheDocument();
    expect(document.getElementById("conversation-12-notes")).toBeInTheDocument();
  });

  it("offers a retry after a failed load", async () => {
    const user = userEvent.setup();
    answer({ error: "Not found" }, 404);
    render(<ConversationNotes conversationId={12} />);

    await user.click(screen.getByRole("button", { name: "Show notes" }));
    expect(await screen.findByText("Couldn't load the notes. Try again.")).toBeInTheDocument();

    answer({ notesHtml: "<p>Second time lucky</p>" });
    await user.click(screen.getByRole("button", { name: "Hide notes" }));
    await user.click(screen.getByRole("button", { name: "Show notes" }));

    expect(await screen.findByText("Second time lucky")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the notes. Try again.")).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("shows the error when the network request itself fails", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ConversationNotes conversationId={12} />);

    await user.click(screen.getByRole("button", { name: "Show notes" }));

    expect(await screen.findByText("Couldn't load the notes. Try again.")).toBeInTheDocument();
  });
});
