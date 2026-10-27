import { describe, expect, it } from "vitest";
import { groupRows, matchesGender, sortRows, statusCounts } from "./score-journey-view";
import { focusChapters, sortChapters } from "./report-view";
import type { ChapterRow, ScoreJourneyRow } from "@/types/student-support";

function row(over: Partial<ScoreJourneyRow>): ScoreJourneyRow {
  return {
    uid: "1",
    studentId: null,
    name: "A",
    gender: "Female",
    category: "Gen",
    examStream: "engineering",
    predicted: null,
    predictedPct: null,
    mode: null,
    status: null,
    last3: [],
    latestPct: null,
    toNext: { kind: "none" },
    ...over,
  };
}

function chapter(over: Partial<ChapterRow>): ChapterRow {
  return {
    key: "k",
    code: null,
    name: "Ch",
    priority: "High",
    n: 10,
    attempt: 50,
    accuracy: 50,
    score: 20,
    tests: 2,
    flag: null,
    pyq: [],
    ...over,
  };
}

describe("Score journey ordering", () => {
  it("groups by Mode AL best first, then students with no Mode AL", () => {
    const groups = groupRows(
      [row({ uid: "a", mode: "M3" }), row({ uid: "b", mode: null }), row({ uid: "c", mode: "M1" })],
      "default",
      false
    );
    expect(groups.map((g) => g.level)).toEqual(["M1", "M3", null]);
  });

  it("orders Sliding → Same → Improving by default, then latest score high → low", () => {
    const sorted = sortRows(
      [
        row({ uid: "same", status: "Same", latestPct: 50 }),
        row({ uid: "imp", status: "Improving", latestPct: 90 }),
        row({ uid: "slide-low", status: "Sliding", latestPct: 10 }),
        row({ uid: "slide-high", status: "Sliding", latestPct: 40 }),
        row({ uid: "none", status: null, latestPct: 99 }),
      ],
      "default",
      false
    );
    expect(sorted.map((r) => r.uid)).toEqual(["slide-high", "slide-low", "same", "imp", "none"]);
  });

  it("sorts blanks last in either direction", () => {
    const rows = [row({ uid: "x", latestPct: null }), row({ uid: "y", latestPct: 30 }), row({ uid: "z", latestPct: 60 })];
    expect(sortRows(rows, "latest", false).map((r) => r.uid)).toEqual(["z", "y", "x"]);
    expect(sortRows(rows, "latest", true).map((r) => r.uid)).toEqual(["y", "z", "x"]);
  });

  it("filters by gender and counts statuses", () => {
    const rows = [row({ gender: "Male", status: "Sliding" }), row({ gender: "Female", status: "Sliding" }), row({ status: "Same" })];
    expect(rows.filter((r) => matchesGender(r, "male"))).toHaveLength(1);
    expect(statusCounts(rows)).toEqual({ Sliding: 2, Same: 1, Improving: 0 });
  });
});

describe("Student report chapters", () => {
  it("picks up to 4 flagged High-priority chapters, Concept gap first, then lowest score", () => {
    const focus = focusChapters([
      chapter({ key: "s-low", flag: "S", score: 5 }),
      chapter({ key: "c-high", flag: "C", score: 30 }),
      chapter({ key: "c-low", flag: "C", score: 10 }),
      chapter({ key: "medium", flag: "C", score: 1, priority: "Medium" }),
      chapter({ key: "unflagged", flag: null, score: 0 }),
      chapter({ key: "s-high", flag: "S", score: 25 }),
      chapter({ key: "s-mid", flag: "S", score: 15 }),
    ]);
    expect(focus.map((c) => c.key)).toEqual(["c-low", "c-high", "s-low", "s-mid"]);
  });

  it("sorts by priority then weakest, by score, or by chapter code", () => {
    const rows = [
      chapter({ key: "low", priority: "Low", score: 5, code: "12P10" }),
      chapter({ key: "high", priority: "High", score: 50, code: "12P2" }),
      chapter({ key: "none", priority: null, score: 1, code: "12P1" }),
    ];
    expect(sortChapters(rows, "priority").map((c) => c.key)).toEqual(["high", "low", "none"]);
    expect(sortChapters(rows, "weakest").map((c) => c.key)).toEqual(["none", "low", "high"]);
    expect(sortChapters(rows, "order").map((c) => c.key)).toEqual(["none", "high", "low"]);
  });
});
