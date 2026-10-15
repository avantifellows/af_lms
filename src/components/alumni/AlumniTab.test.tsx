import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AlumniTab from "./AlumniTab";

// The form is exercised through its own test; here it's a stub that can report a save.
vi.mock("./AlumniForm", () => ({
  default: ({ entry, onSaved }: { entry: { kind: string; id: string }; onSaved?: () => void }) => (
    <div data-testid="alumni-form">
      form for {entry.kind} {entry.id}
      <button type="button" onClick={() => onSaved?.()}>fake save</button>
    </div>
  ),
}));

const fetchMock = vi.fn();
const pendingRow = (userId: string, name: string, cohortYear = "2025-2026") =>
  ({ userId, afid: `A${userId}`, name, cohortYear, program: "JNV CoE", gender: "", stream: "" });
const alumniRow = (userId: string, name: string, cohortYear = "2019-2020") =>
  ({ alumniId: `9${userId}`, userId, afid: `B${userId}`, name, cohortYear, ugStatus: "Graduated", currentStatus: "", collegeUg: "NIT Calicut" });

function respond(body: unknown, ok = true) {
  fetchMock.mockResolvedValue({ ok, json: async () => body });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AlumniTab", () => {
  it("loads the school's lists and starts on 'To add' when there are pass-outs", async () => {
    respond({ pending: [pendingRow("1", "Asha Rao")], alumni: [alumniRow("2", "Ravi Kumar")] });
    render(<AlumniTab schoolCode="59525" />);

    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/alumni/school/59525");
    expect(screen.getByRole("tab", { name: /To add · 1/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Pick a student to begin")).toBeInTheDocument();
  });

  it("starts on Existing alumni when nobody is left to add", async () => {
    respond({ pending: [], alumni: [alumniRow("2", "Ravi Kumar")] });
    render(<AlumniTab schoolCode="59525" />);
    expect(await screen.findByText("Ravi Kumar")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Existing alumni · 1/ })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the student passed in from search, in either list", async () => {
    respond({ pending: [pendingRow("1", "Asha Rao")], alumni: [alumniRow("2", "Ravi Kumar")] });
    const { unmount } = render(<AlumniTab schoolCode="59525" initialStudentId="2" />);
    // An existing alumnus is opened by alumni id, a pass-out by user id.
    expect(await screen.findByTestId("alumni-form")).toHaveTextContent("form for alumnus 92");
    unmount();

    render(<AlumniTab schoolCode="59525" initialStudentId="1" />);
    expect(await screen.findByTestId("alumni-form")).toHaveTextContent("form for pass-out 1");
  });

  it("filters by name or AFID, and by year when there is more than one", async () => {
    respond({
      pending: [pendingRow("1", "Asha Rao"), pendingRow("3", "Zara Khan", "2019-2020")],
      alumni: [],
    });
    render(<AlumniTab schoolCode="59525" />);
    await screen.findByText("Asha Rao");

    fireEvent.change(screen.getByPlaceholderText("Filter by name or AFID"), { target: { value: "a3" } });
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByText("Zara Khan")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter by name or AFID"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Pass-out year"), { target: { value: "2025-2026" } });
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("Zara Khan")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Filter by name or AFID"), { target: { value: "nobody" } });
    expect(screen.getByText("No students match.")).toBeInTheDocument();
  });

  it("switches lists and shows the empty messages", async () => {
    respond({ pending: [], alumni: [] });
    render(<AlumniTab schoolCode="59525" />);
    expect(await screen.findByText("No alumni recorded for this school.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /To add · 0/ }));
    expect(screen.getByText("Everyone who passed out is added.")).toBeInTheDocument();
    expect(screen.getByText(/Passed out \(any year\)/)).toBeInTheDocument();
  });

  it("opens the form on click, and after a save reloads the lists and marks the student Saved", async () => {
    respond({ pending: [pendingRow("1", "Asha Rao")], alumni: [alumniRow("2", "Ravi Kumar")] });
    render(<AlumniTab schoolCode="59525" />);
    fireEvent.click(await screen.findByText("Asha Rao"));
    expect(screen.getByTestId("alumni-form")).toHaveTextContent("form for pass-out 1");

    // After saving, the student has moved to Existing alumni.
    respond({ pending: [], alumni: [alumniRow("1", "Asha Rao", "2025-2026"), alumniRow("2", "Ravi Kumar")] });
    fireEvent.click(screen.getByText("fake save"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    fireEvent.click(await screen.findByRole("tab", { name: /Existing alumni · 2/ }));
    const row = screen.getByText("Asha Rao").closest("button")!;
    expect(within(row).getByText("Saved")).toBeInTheDocument();
  });

  it("shows the error when the lists can't load", async () => {
    respond({ error: "Access denied" }, false);
    render(<AlumniTab schoolCode="59525" />);
    expect(await screen.findByText("Access denied")).toBeInTheDocument();
  });

  it("treats a reply without lists as empty instead of crashing", async () => {
    respond({});
    render(<AlumniTab schoolCode="59525" />);
    expect(await screen.findByText("No alumni recorded for this school.")).toBeInTheDocument();
  });
});
