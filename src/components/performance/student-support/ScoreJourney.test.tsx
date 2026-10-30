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
    stream: null,
    examStream: "engineering",
    predicted: null,
    predictedPct: null,
    mode: null,
    status: null,
    latestAl: null,
    toNext: { kind: "none" },
    trend: null,
    change: null,
    latestPct: null,
    results: {},
    ...over,
  };
}

const JOURNEY: ScoreJourneyData = {
  tests: [
    { sessionId: "t1", name: "FT 1", date: "2026-07-01", stream: "engineering", max: 300, retest: false },
    { sessionId: "t2", name: "Common FT", date: "2026-08-05", stream: null, max: 300, retest: false },
    { sessionId: "t3", name: "NEET FT", date: "soon", stream: "medical", max: 720, retest: false },
    { sessionId: "t4", name: "FT 1", date: "2026-08-20", stream: "engineering", max: 300, retest: true },
  ],
  students: [
    student({
      uid: "1", studentId: "S1", name: "Asha", gender: "Female", category: "Gen", stream: "PCM",
      predicted: "M1", predictedPct: 92.5, mode: "M2", status: "Sliding", latestPct: 33.3,
      latestAl: { level: "M2", marks: 150, test: "Common FT" },
      toNext: { kind: "count", questions: 0, gap: 0, cutoff: 150, nextLevel: "M1", test: "Common FT", marks: 150 },
      trend: { points: [33.3, 50], direction: "Improving", slope: 16.7, recent: 2 },
      change: { sessionId: "t2", change: 50, previous: "FT 1" },
      results: {
        t1: { level: "M2", marks: 100, max: 300 },
        t2: { level: "Not Qualified", marks: 150, max: 300 },
        t4: { level: "M1", marks: 200, max: 300 },
      },
    }),
    student({
      uid: "2", name: "Bala", gender: "Male", category: "OBC", predicted: "M1", mode: "M1", status: "Same",
      latestAl: { level: "M1", marks: 250, test: "FT 1" }, toNext: { kind: "top" },
    }),
    student({
      uid: "3", name: "Chitra", gender: "Female", examStream: "medical", predicted: "B3", mode: "B2", status: "Improving",
      latestAl: { level: "B2", marks: 400, test: "NEET FT" },
      toNext: { kind: "count", questions: 13, gap: 50, cutoff: 450, nextLevel: "B1", test: "NEET FT", marks: 400 },
    }),
    student({ uid: "4", name: "Dev", gender: "Male", examStream: null, stream: "Arts" }),
    student({
      uid: "5", name: "Esha", gender: "Female", mode: "M2", status: "Improving", latestPct: 50,
      trend: { points: [60, 50], direction: "Declining", slope: -10, recent: 2 },
    }),
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
    // The number of levelled major tests, not a sum of sittings, so not "taken".
    expect(screen.getByText("Major tests")).toBeInTheDocument();
    expect(screen.queryByText("Major tests taken")).not.toBeInTheDocument();
    expect(screen.getByText("NEET (Medical)")).toHaveTextContent("· 1 students");
    expect(screen.getByText("Other streams")).toBeInTheDocument();
    expect(screen.getByText("No Mode AL yet")).toBeInTheDocument();
    // Sliding first in its group, then by latest score.
    expect(shownNames()).toEqual(["Bala", "Asha", "Esha", "Chitra", "Dev"]);

    const [jee] = screen.getAllByRole("table");
    const headers = within(jee).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual([
      "Student", "Gender", "Stream", "Category", "Predicted", "Mode AL", "AL status", "Latest AL",
      "Questions to next AL", "Mentor notes", "Score graph",
      // Every test, newest first; no toggle.
      "FT 120 Aug · Retest", "Common FT5 Aug", "FT 11 Jul",
    ]);
    expect(screen.queryByRole("checkbox", { name: "All tests" })).not.toBeInTheDocument();

    const asha = within(rowOf("Asha"));
    expect(asha.getByText("S1")).toBeInTheDocument();
    expect(asha.getByText("Engineering")).toBeInTheDocument();
    // Only the predicted level is shown, as in the prototype; not the percentile.
    expect(asha.queryByText(/%ile/)).not.toBeInTheDocument();
    expect(asha.queryByText("33.3%")).not.toBeInTheDocument();
    expect(asha.getByTitle("Common FT · 150 marks")).toHaveTextContent("M2");
    expect(
      asha.getByTitle("0 more marks to M1 (cutoff 150). Latest test Common FT = 150 marks. Counted at +4 per extra correct answer.")
    ).toHaveTextContent("0 → M1");
    expect(asha.getByText("Sliding")).toBeInTheDocument();
    expect(asha.getByRole("button", { name: "2 notes" })).toBeInTheDocument();

    expect(within(rowOf("Bala")).getByTitle("Already at the top level on the latest test")).toHaveTextContent("Top");
    expect(within(rowOf("Bala")).getByRole("button", { name: "1 note" })).toBeInTheDocument();
    expect(within(rowOf("Chitra")).getByTitle(/^50 more marks to B1 \(cutoff 450\)/)).toHaveTextContent("13 → B1");
    // A stream that is neither JEE nor NEET is shown as recorded.
    expect(within(rowOf("Dev")).getByText("Arts")).toBeInTheDocument();
    // No status, no levels, no graph, no notes; absent from every test.
    expect(within(rowOf("Dev")).getAllByText("—").length).toBeGreaterThanOrEqual(7);
    expect(within(rowOf("Dev")).getAllByText("AB")).toHaveLength(4);
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

    await userEvent.click(within(jee).getByRole("button", { name: "Score graph" }));
    expect(within(jee).getByRole("button", { name: "Score graph ▼" })).toBeInTheDocument();
    expect(shownNames().slice(1, 3)).toEqual(["Asha", "Esha"]);

    await userEvent.click(within(jee).getByRole("button", { name: "Score graph ▼" }));
    expect(shownNames().slice(1, 3)).toEqual(["Esha", "Asha"]);

    // Names start A→Z.
    await userEvent.click(within(jee).getByRole("button", { name: "Student" }));
    expect(within(jee).getByRole("button", { name: "Student ▲" })).toBeInTheDocument();

    // A column without a sort does nothing.
    expect(within(jee).queryByRole("button", { name: "Gender" })).not.toBeInTheDocument();
  });

  it("adds a column per test of the section's stream, newest first, with marks, level and the latest change", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    const [jee, neet] = screen.getAllByRole("table");
    expect(within(jee).getByTitle("Common FT · out of 300")).toBeInTheDocument();
    expect(within(jee).queryByText("NEET FT")).not.toBeInTheDocument();
    expect(within(neet).getByText("NEET FT")).toBeInTheDocument();
    // A date the browser can't read is shown as sent.
    expect(within(neet).getByText("soon")).toBeInTheDocument();

    const cells = within(rowOf("Asha")).getAllByRole("cell").slice(11);
    expect(cells.map((c) => c.textContent)).toEqual(["200M1", "150NQ▲ 50.0", "100M2"]);
    // The change is on the latest non-retest sitting, against the previous one.
    expect(within(cells[1]).getByTitle("vs FT 1")).toHaveClass("text-success");
    // Bala sat none of them.
    expect(within(rowOf("Bala")).getAllByText("AB")).toHaveLength(3);
  });

  it("marks a retest column, which is shown but not counted", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    const [jee] = screen.getAllByRole("table");
    const retest = within(jee).getByTitle("Retest — not counted in status or trend. FT 1 · out of 300");
    expect(retest).toHaveTextContent("Retest");
    expect(retest).toHaveClass("text-accent");
    expect(within(jee).getByTitle("FT 1 · out of 300")).not.toHaveTextContent("Retest");
  });

  it("draws a score graph coloured by direction, with an accessible label", async () => {
    mockFetch({ journey: ready(JOURNEY) });
    renderJourney();
    await screen.findByText("JEE (Engineering)");
    const improving = within(rowOf("Asha")).getByRole("img", { name: "Score trend: Improving over the last 2 tests" });
    expect(improving).toHaveClass("text-success");
    expect(improving.querySelectorAll("circle")).toHaveLength(2);
    expect(improving.querySelector("circle:last-of-type")).toHaveClass("fill-current");
    expect(within(rowOf("Asha")).getByTitle("All 2 tests: 33% → 50% · last 2 tests trend +16.7 points per test")).toBeInTheDocument();
    expect(within(rowOf("Esha")).getByRole("img", { name: "Score trend: Declining over the last 2 tests" })).toHaveClass("text-danger");
    expect(within(rowOf("Dev")).getByTitle("Fewer than two tests")).toHaveTextContent("—");
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
