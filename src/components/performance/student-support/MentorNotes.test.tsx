import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JsonReply, stubJsonFetch } from "./__test-utils__/json-fetch";
import MentorNotes, { NotesCell } from "./MentorNotes";
import type { MentorInteraction } from "@/types/student-support";

const mockFetch = (reply: JsonReply) => stubJsonFetch(() => reply);

const INTERACTIONS: MentorInteraction[] = [
  {
    title: "Session 3",
    date: "2026-10-12T10:00:00Z",
    mentor: "Ravi",
    answers: [
      { question: "How is the student doing?", answer: "Better in Physics" },
      { question: "Concerns?", answer: "  " },
    ],
  },
  { title: "Session 2", date: "not a date", mentor: null, answers: [{ question: "Notes", answer: null }] },
  { title: "Imported session", date: null, mentor: "Meera", answers: [] },
];

function renderNotes() {
  const onClose = vi.fn();
  render(<MentorNotes schoolUdise="70705" grade={12} program="JNV CoE" uid="101" name="Asha" onClose={onClose} />);
  return onClose;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MentorNotes", () => {
  it("asks for the student's notes and shows loading", () => {
    const fetchMock = mockFetch("pending");
    renderNotes();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/quiz-analytics/70705/student-support/notes?grade=12&program=JNV+CoE&student=101",
      expect.anything()
    );
    expect(screen.getByText("Mentor notes · Asha")).toBeInTheDocument();
    expect(screen.getByText("Loading notes…")).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    mockFetch({ ok: false, body: { error: "Not found" } });
    renderNotes();
    expect(await screen.findByText("Not found")).toBeInTheDocument();
  });

  it("says so when there are no notes", async () => {
    mockFetch({ ok: true, body: { interactions: [] } });
    renderNotes();
    expect(await screen.findByText("No notes yet.")).toBeInTheDocument();
  });

  it("shows one interaction at a time, newest first, answers as written", async () => {
    mockFetch({ ok: true, body: { interactions: INTERACTIONS } });
    renderNotes();
    expect(await screen.findByText("Session 3")).toBeInTheDocument();
    expect(screen.getByText("Interaction 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("12 Oct 2026 · Ravi")).toBeInTheDocument();
    expect(screen.getByText("Better in Physics")).toBeInTheDocument();
    // A blank answer reads as a dash.
    expect(screen.getByText("Concerns?").nextSibling).toHaveTextContent("—");
    const newer = screen.getByRole("button", { name: "‹ Newer" });
    const older = screen.getByRole("button", { name: "Older ›" });
    expect(newer).toBeDisabled();

    await userEvent.click(older);
    expect(screen.getByText("Session 2")).toBeInTheDocument();
    // A date that can't be read is shown as sent; no mentor, no name.
    expect(screen.getByText("not a date")).toBeInTheDocument();
    expect(screen.getByText("Notes").nextSibling).toHaveTextContent("—");

    await userEvent.click(older);
    expect(screen.getByText("Imported session")).toBeInTheDocument();
    expect(screen.getByText("Imported · Meera")).toBeInTheDocument();
    expect(older).toBeDisabled();

    await userEvent.click(newer);
    expect(screen.getByText("Interaction 2 of 3")).toBeInTheDocument();
  });

  it("closes from the Close button", async () => {
    mockFetch({ ok: true, body: { interactions: [] } });
    const onClose = renderNotes();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("NotesCell", () => {
  it("is a dash without notes, and a button with them", async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<NotesCell count={undefined} onOpen={onOpen} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    rerender(<NotesCell count={0} onOpen={onOpen} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(<NotesCell count={1} onOpen={onOpen} />);
    await userEvent.click(screen.getByRole("button", { name: "1 note" }));
    expect(onOpen).toHaveBeenCalled();
  });
});
