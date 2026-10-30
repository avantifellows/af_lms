import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type JsonReply, stubJsonFetch } from "./__test-utils__/json-fetch";
import ScoreJourney from "./ScoreJourney";
import type { ScoreJourneyData, ScoreJourneyRow } from "@/types/student-support";

function student(over: Partial<ScoreJourneyRow>): ScoreJourneyRow {
  return {
    uid: "0",
    studentId: null,
    name: "?",
    gender: null,
    category: null,
    examStream: "engineering",
    predicted: null,
    predictedPct: null,
    mode: null,
    status: null,
    last3: [],
    latestPct: null,
    toNext: { kind: "none" },
    results: {},
    ...over,
  };
}

const JOURNEY: ScoreJourneyData = {
  tests: [
    { sessionId: "t1", name: "FT 1", date: "2026-07-01", stream: "engineering" },
    { sessionId: "t2", name: "Common FT", date: "2026-08-05", stream: null },
    { sessionId: "t3", name: "NEET FT", date: "soon", stream: "medical" },
  ],
  students: [
    student({
      uid: "1", studentId: "S1", name: "Asha", gender: "Female", category: "Gen",
      predicted: "M1", predictedPct: 92.5, mode: "M2", status: "Sliding", last3: ["M2", "M3", "M2"], latestPct: 33.3,
      toNext: { kind: "count", questions: 13, median: 100, cutoff: 150, nextLevel: "M1", tests: ["FT 1", "Common FT"] },
      results: {
        t1: { level: "M2", marks: 100, max: 300 },
        t2: { level: "Not Qualified", marks: null, max: 300 },
      },
    }),
    student({ uid: "2", name: "Bala", gender: "Male", category: "OBC", predicted: "M1", mode: "M1", status: "Same", toNext: { kind: "top" } }),
    student({ uid: "3", name: "Chitra", gender: "Female", examStream: "medical", predicted: "B3", mode: "B2", status: "Improving", toNext: { kind: "reached" } }),
    student({ uid: "4", name: "Dev", gender: "Male", examStream: null }),
    student({ uid: "5", name: "Esha", gender: "Female", mode: "M2", status: "Improving", latestPct: 50 }),
  ],
};

/** Answers the journey, the note counts and one student's notes by URL. */
function mockFetch(replies: { journey: JsonReply; counts?: JsonReply; notes?: JsonReply }) {
  return stubJsonFetch((url) => {
    if (url.includes("student=")) return replies.notes;
    return url.includes("/notes?") ? replies.counts : replies.journey;
  });
}

const ready = (body: unknown) => ({ ok: true, body });

function renderJourney(props: Partial<React.ComponentProps<typeof ScoreJourney>> = {}) {
  const onOpenStudent = vi.fn();
  render(<ScoreJourney schoolUdise="70705" grade={12} program="JNV CoE" onOpenStudent={onOpenStudent} {...props} />);
  return onOpenStudent;
}

const rowOf = (name: string) => screen.getByRole("button", { name }).closest("tr")!;
const shownNames = () =>
  screen.getAllByRole("button", { name: /^(Asha|Bala|Chitra|Dev|Esha)$/ }).map((b) => b.textContent);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ScoreJourney", () => {
  it("asks for the journey with stream and test grade, and the note counts for the grade", () => {
    const fetchMock = mockFetch({ journey: "pending", counts: "pending" });
    renderJourney({ stream: "engineering", testGrade: 11 });
    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls).toEqual([
      "/api/quiz-analytics/70705/student-support?grade=12&program=JNV+CoE&stream=engineering&testGrade=11",
      "/api/quiz-analytics/70705/student-support/notes?grade=12&program=JNV+CoE",
    ]);
    expect(screen.getByText("Loading the score journey…")).toBeInTheDocument();
  });

  it("shows the server's error", async () => {
    mockFetch({ journey: { ok: false, body: { error: "Not available for JNV NVS" } } });
    renderJourney();
    expect(await screen.findByText("Not available for JNV NVS")).toBeInTheDocument();
  });

  it("says so when the grade has no enrolled students", async () => {
    mockFetch({ journey: ready({ tests: [], students: [] }) });
    renderJourney();
    expect(await screen.findByText("No enrolled students for this grade.")).toBeInTheDocument();
  });

  it("splits students by stream and Mode AL, with a row of their levels and progress", async () => {
    mockFetch({ journey: ready(JOURNEY), counts: ready({ counts: { "1": 2, "2": 1 } }) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");

    expect(screen.getByText("Mode AL distribution").parentElement).toHaveTextContent("M1:1 · M2:2 · B2:1 · No AL:1");
    expect(screen.getByText("NEET (Medical)")).toHaveTextContent("· 1 students");
    expect(screen.getByText("Other streams")).toBeInTheDocument();
    expect(screen.getByText("No Mode AL yet")).toBeInTheDocument();
    // Sliding first in its group, then by latest score.
    expect(shownNames()).toEqual(["Bala", "Asha", "Esha", "Chitra", "Dev"]);

    const asha = within(rowOf("Asha"));
    expect(asha.getByText("S1")).toBeInTheDocument();
    expect(asha.getByText("92.5%ile")).toBeInTheDocument();
    expect(asha.getByText("33.3%")).toBeInTheDocument();
    expect(asha.getByTitle("Median 100 marks of FT 1, Common FT; M1 cutoff 150")).toHaveTextContent("13 to M1");
    expect(asha.getByText("Sliding")).toBeInTheDocument();
    expect(asha.getAllByText("M2")).toHaveLength(3);
    expect(asha.getByRole("button", { name: "2 notes" })).toBeInTheDocument();

    expect(within(rowOf("Bala")).getByText("Top")).toBeInTheDocument();
    expect(within(rowOf("Bala")).getByRole("button", { name: "1 note" })).toBeInTheDocument();
    expect(within(rowOf("Chitra")).getByText("Reached")).toBeInTheDocument();
    // No status, no tests, no notes.
    expect(within(rowOf("Dev")).getAllByText("—").length).toBeGreaterThanOrEqual(7);
  });

  it("opens a student's report from their name", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    const onOpenStudent = renderJourney();
    await userEvent.click(await screen.findByRole("button", { name: "Esha" }));
    expect(onOpenStudent).toHaveBeenCalledWith("5");
  });

  it("filters by AL status, with counts, and clears the filter", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    const improving = await screen.findByRole("button", { name: "Improving 2" });
    expect(screen.getByRole("button", { name: "Sliding 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Same 1" })).toBeInTheDocument();

    await userEvent.click(improving);
    expect(improving).toHaveAttribute("aria-pressed", "true");
    expect(shownNames()).toEqual(["Esha", "Chitra"]);
    expect(screen.getByText(/Showing 2 of 5/)).toBeInTheDocument();
    expect(screen.queryByText("Other streams")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear filter" }));
    expect(shownNames()).toHaveLength(5);

    // Pressing the active status again also clears it.
    await userEvent.click(improving);
    await userEvent.click(improving);
    expect(improving).toHaveAttribute("aria-pressed", "false");
    expect(shownNames()).toHaveLength(5);
  });

  it("filters by gender, and counts statuses over the students shown", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    await userEvent.click(screen.getByRole("button", { name: "Boys" }));
    expect(shownNames()).toEqual(["Bala", "Dev"]);
    expect(screen.getByRole("button", { name: "Improving 0" })).toBeInTheDocument();
    expect(screen.getByText("Mode AL distribution").parentElement).toHaveTextContent("M1:1 · No AL:1");
  });

  it("sorts within each Mode AL group by the column clicked, toggling direction", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    const [jee] = screen.getAllByRole("table");

    await userEvent.click(within(jee).getByRole("button", { name: "Latest score" }));
    expect(within(jee).getByRole("button", { name: "Latest score ▼" })).toBeInTheDocument();
    expect(shownNames().slice(1, 3)).toEqual(["Esha", "Asha"]);

    await userEvent.click(within(jee).getByRole("button", { name: "Latest score ▼" }));
    expect(shownNames().slice(1, 3)).toEqual(["Asha", "Esha"]);

    // Names start A→Z.
    await userEvent.click(within(jee).getByRole("button", { name: "Student" }));
    expect(within(jee).getByRole("button", { name: "Student ▲" })).toBeInTheDocument();

    // A column without a sort does nothing.
    expect(within(jee).queryByRole("button", { name: "Gender" })).not.toBeInTheDocument();
  });

  it("adds a column per test of the section's stream, with each result's level", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    expect(screen.queryByText("FT 1")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("checkbox", { name: "All tests" }));
    const [jee, neet] = screen.getAllByRole("table");
    expect(within(jee).getByText("FT 1")).toBeInTheDocument();
    expect(within(jee).queryByText("NEET FT")).not.toBeInTheDocument();
    expect(within(neet).getByText("NEET FT")).toBeInTheDocument();
    // A date the browser can't read is shown as sent.
    expect(within(neet).getByText("soon")).toBeInTheDocument();

    const asha = within(rowOf("Asha"));
    expect(asha.getByTitle("FT 1 (1 Jul): M2 · 100/300")).toBeInTheDocument();
    expect(asha.getByTitle("Common FT (5 Aug): Not Qualified")).toHaveTextContent("NQ");
    // Bala sat neither.
    expect(within(rowOf("Bala")).queryByTitle(/^FT 1/)).not.toBeInTheDocument();
  });

  it("opens a student's mentor notes and closes them", async () => {
    mockFetch({
      journey: ready(JOURNEY),
      counts: ready({ counts: { "1": 2 } }),
      notes: ready({ interactions: [{ title: "Check-in", date: null, mentor: null, answers: [] }] }),
    });
    renderJourney();
    await userEvent.click(await screen.findByRole("button", { name: "2 notes" }));
    expect(await screen.findByText("Mentor notes · Asha")).toBeInTheDocument();
    expect(await screen.findByText("Check-in")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByText("Mentor notes · Asha")).not.toBeInTheDocument();
  });

  it("shows no note counts when they fail to load", async () => {
    mockFetch({ journey: ready(JOURNEY), counts: { ok: false, body: {} } });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    expect(screen.queryByRole("button", { name: /notes?$/ })).not.toBeInTheDocument();
    expect(screen.getByText("Mentor notes unavailable")).toBeInTheDocument();
  });

  it("says nothing about mentor notes when they load", async () => {
    mockFetch({ journey: ready(JOURNEY), counts: ready({ counts: {} }) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    expect(screen.queryByText("Mentor notes unavailable")).not.toBeInTheDocument();
  });

  it("says so when no student matches the filters, and clears both", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    await userEvent.click(screen.getByRole("button", { name: "Boys" }));
    await userEvent.click(screen.getByRole("button", { name: "Sliding 0" }));
    expect(screen.getByText(/No students match these filters/)).toBeInTheDocument();
    expect(screen.queryByText("JEE (Engineering)")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText(/No students match these filters/)).not.toBeInTheDocument();
    expect(shownNames()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("lets the AL status filters wrap on a narrow screen", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    const sliding = await screen.findByRole("button", { name: "Sliding 1" });
    expect(sliding.parentElement).toHaveClass("flex-wrap");
  });
});
