import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The URL as Next.js keeps it: useSearchParams follows history.pushState /
// replaceState, so the mock re-renders on every history write.
const { listeners } = vi.hoisted(() => ({ listeners: new Set<() => void>() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/blended-learning/jee-form",
  useSearchParams: () =>
    new URLSearchParams(
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => window.location.search
      )
    ),
}));

import type { JeeFormRow, JeeFormUpdate, JeeFormView } from "@/lib/blended-learning-jee-form-input";

import { JeeFormTab } from "./JeeFormTab";

const FILLED: JeeFormUpdate = {
  id: 3,
  status: "filled",
  applicationNumber: "270310000001",
  hasConfirmation: false,
  reasons: [],
  details: null,
  recordedOn: "2026-11-10",
  flagRaised: false,
};
const NOT_FILLED: JeeFormUpdate = {
  id: 4,
  status: "not_filled",
  applicationNumber: null,
  hasConfirmation: false,
  reasons: ["not_aware", "other"],
  details: "Moving house",
  recordedOn: "2026-11-11",
  flagRaised: true,
};
const REMINDER = { id: 81, text: "JEE Form Filling (Reminder)", status: "open" as const };

function row(studentId: number, name: string, current: JeeFormUpdate | null, mentor = 9001): JeeFormRow {
  return {
    studentId,
    programStudentId: `00${studentId}`,
    name,
    mentorUserId: mentor,
    mentorName: mentor === 9001 ? "Mentor Alpha" : "Mentor Beta",
    form: { current, earlier: [], reminderItems: [REMINDER], passwordSaved: false },
  };
}

const ROWS = [
  row(501, "Asha Testcase", null),
  row(502, "Biren Sample", FILLED),
  row(503, "Chitra Example", NOT_FILLED),
  row(601, "Dev Placeholder", null, 9002),
];

let fetchMock: ReturnType<typeof vi.fn>;

function goTo(search: string) {
  window.history.replaceState(null, "", `/blended-learning/jee-form${search}`);
}

function counts() {
  const tiles = within(screen.getByLabelText("JEE form counts"));
  return Object.fromEntries(
    tiles.getAllByRole("term").map((term) => [term.textContent, term.nextElementSibling?.textContent])
  );
}

function listedNames() {
  const list = screen.getByRole("list", { name: "Students" });
  return [...list.children].map((item) => item.querySelector("button .font-bold")?.textContent);
}

function rowOf(name: string) {
  return screen.getByText(name).closest("li") as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  goTo("");
  const notify = () => listeners.forEach((listener) => listener());
  for (const method of ["pushState", "replaceState"] as const) {
    const original = History.prototype[method];
    vi.spyOn(window.history, method).mockImplementation(function (this: History, ...args) {
      original.apply(window.history, args);
      notify();
    });
  }
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("JeeFormTab list", () => {
  it("counts Filled, Not filled and Not recorded, and lists every Student A–Z as given", () => {
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor={false} />);

    expect(counts()).toEqual({ Filled: "1", "Not filled": "1", "Not recorded": "2" });
    const biren = rowOf("Biren Sample");
    expect(within(biren).getByText("00502")).toHaveClass("font-mono");
    expect(within(biren).getByText("Filled")).toBeInTheDocument();
    expect(within(biren).getByText("270310000001")).toHaveClass("font-mono");
    expect(within(biren).getByText(/^Recorded/)).toHaveTextContent("Recorded 10 Nov 2026");
    expect(within(rowOf("Chitra Example")).getByText("Not aware about the exam; Other")).toBeInTheDocument();
    expect(within(rowOf("Asha Testcase")).getByText("Not recorded")).toBeInTheDocument();
    // A Mentor's own list names no Mentor and has no Mentor filter.
    expect(screen.queryByText(/Mentor Alpha/)).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Mentor" })).not.toBeInTheDocument();
  });

  it("filters by status from the URL and writes the filter to it", async () => {
    goTo("?status=not_recorded");
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor={false} />);
    const status = screen.getByRole("group", { name: "Status" });
    expect(within(status).getByRole("button", { name: "Not recorded" })).toHaveAttribute("aria-pressed", "true");
    expect(listedNames()).toEqual(["Asha Testcase", "Dev Placeholder"]);
    // The counts stay for everyone in view.
    expect(counts()).toEqual({ Filled: "1", "Not filled": "1", "Not recorded": "2" });

    await userEvent.click(within(status).getByRole("button", { name: "Filled" }));
    expect(window.location.search).toBe("?status=filled");
    expect(listedNames()).toEqual(["Biren Sample"]);

    await userEvent.click(within(status).getByRole("button", { name: "All" }));
    expect(window.location.search).toBe("");
    expect(listedNames()).toHaveLength(4);
  });

  it("says when nothing matches", () => {
    goTo("?status=filled");
    render(<JeeFormTab rows={[ROWS[0]]} canRecord canReveal showMentor={false} />);
    expect(screen.getByText("No students match this filter.")).toBeInTheDocument();
  });
});

describe("JeeFormTab rows", () => {
  it("opens a row in place to the form, linkable as ?student=, and closes it again", async () => {
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor={false} />);
    const toggle = within(rowOf("Asha Testcase")).getByRole("button", { expanded: false });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(window.location.search).toBe("?student=501");
    expect(within(rowOf("Asha Testcase")).getByRole("group", { name: "Has the student filled the form?" })).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("group", { name: "Has the student filled the form?" })).not.toBeInTheDocument();
  });

  it("opens and scrolls to the linked Student's row on arrival", () => {
    goTo("?student=503");
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor={false} />);
    expect(within(rowOf("Chitra Example")).getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Not filled" })).toBeChecked();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("saves in place: the row and the counts update, and it stays listed under the filter", async () => {
    const saved: JeeFormView = {
      current: { ...FILLED, id: 9, applicationNumber: "2703" },
      earlier: [],
      reminderItems: [],
      passwordSaved: true,
    };
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ form: saved }), { status: 201 }));
    goTo("?status=not_recorded&student=501");
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor={false} />);

    const asha = rowOf("Asha Testcase");
    await userEvent.click(within(asha).getByRole("radio", { name: "Filled" }));
    await userEvent.type(within(asha).getByLabelText("Application number"), "2703");
    await userEvent.type(within(asha).getByLabelText("Exam portal password"), "fake-portal-pass-1");
    await userEvent.click(within(asha).getByRole("button", { name: "Save" }));

    expect(await within(asha).findByRole("status")).toHaveTextContent("Saved");
    expect(fetchMock).toHaveBeenCalledWith("/api/blended-learning/students/501/jee-form", expect.anything());
    expect(counts()).toEqual({ Filled: "2", "Not filled": "1", "Not recorded": "1" });
    expect(within(asha).getAllByText("2703").length).toBeGreaterThan(0);
    expect(listedNames()).toEqual(["Asha Testcase", "Dev Placeholder"]);
    expect(window.location.pathname).toBe("/blended-learning/jee-form");

    // Changing the filter drops it: it is Filled now.
    const status = screen.getByRole("group", { name: "Status" });
    await userEvent.click(within(status).getByRole("button", { name: "Filled" }));
    expect(listedNames()).toEqual(["Asha Testcase", "Biren Sample"]);
    await userEvent.click(within(status).getByRole("button", { name: "Not recorded" }));
    expect(listedNames()).toEqual(["Dev Placeholder"]);
  });

  it.each([
    ["an admin", true],
    ["a read-only account", false],
  ] as const)("lets a viewer (%s) open a row but not edit it", async (_who, canReveal) => {
    const rows = ROWS.map((row) => (row.studentId === 502 ? { ...row, form: { ...row.form, passwordSaved: true } } : row));
    render(<JeeFormTab rows={rows} canRecord={false} canReveal={canReveal} showMentor={false} />);
    await userEvent.click(within(rowOf("Biren Sample")).getByRole("button"));
    const biren = rowOf("Biren Sample");
    expect(within(biren).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(biren).getByRole("button", { name: "Change status" })).toBeDisabled();
    expect(within(biren).getByText("Not uploaded")).toBeInTheDocument();
    // Show password works only for a viewer who is not read-only.
    const show = within(biren).getByRole("button", { name: "Show password" });
    expect(show.hasAttribute("disabled")).toBe(!canReveal);
  });
});

describe("JeeFormTab for an admin", () => {
  it("names each row's Mentor and filters by Mentor from the URL, counting only those in view", async () => {
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor />);
    expect(within(rowOf("Dev Placeholder")).getByText(/Mentor Beta/)).toBeInTheDocument();
    const mentor = screen.getByRole("combobox", { name: "Mentor" });
    expect(within(mentor).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All Mentors",
      "Mentor Alpha",
      "Mentor Beta",
    ]);

    await userEvent.selectOptions(mentor, "9002");
    expect(window.location.search).toBe("?mentor=9002");
    expect(listedNames()).toEqual(["Dev Placeholder"]);
    expect(counts()).toEqual({ Filled: "0", "Not filled": "0", "Not recorded": "1" });

    await userEvent.selectOptions(mentor, "");
    expect(window.location.search).toBe("");
    expect(listedNames()).toHaveLength(4);
  });

  it("ignores a Mentor filter for a Mentor's own list", () => {
    goTo("?mentor=9002");
    render(<JeeFormTab rows={ROWS} canRecord canReveal showMentor={false} />);
    expect(listedNames()).toHaveLength(4);
  });
});
