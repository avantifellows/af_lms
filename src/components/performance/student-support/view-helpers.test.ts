import { describe, expect, it } from "vitest";
import { groupRows, matchesGender, modeDistribution, sortRows, statusCounts, streamSections } from "./score-journey-view";
import { focusChapters, sortChapters } from "./report-view";
import type { ChapterRow, ScoreJourneyRow } from "@/types/student-support";

function row(over: Partial<ScoreJourneyRow>): ScoreJourneyRow {
  return {
    uid: "1",
    studentId: null,
    name: "A",
    gender: "Female",
    category: "Gen",
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
    topics: [],
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
    const trend = (slope: number) => ({ points: [], direction: "Same" as const, slope, recent: 2 });
    const rows = [row({ uid: "x", trend: null }), row({ uid: "y", trend: trend(-1) }), row({ uid: "z", trend: trend(2) })];
    expect(sortRows(rows, "trend", false).map((r) => r.uid)).toEqual(["z", "y", "x"]);
    expect(sortRows(rows, "trend", true).map((r) => r.uid)).toEqual(["y", "z", "x"]);
  });

  it("sorts by name, predicted level, Latest AL, questions to next level and status", () => {
    const count = { kind: "count" as const, gap: 0, cutoff: 100, nextLevel: "M2", test: "T", marks: 100 };
    const latest = (level: string) => ({ level, marks: 1, test: "T" });
    const rows = [
      row({ uid: "b", name: "bala", predicted: "M3", latestAl: latest("M1"), toNext: { kind: "top" }, status: "Improving" }),
      row({ uid: "a", name: "Asha", predicted: "M1", toNext: { kind: "none" }, status: null }),
      row({
        uid: "c", name: "Chitra", predicted: null, latestAl: latest("M3"), status: "Sliding",
        toNext: { ...count, questions: 5 },
      }),
      row({ uid: "d", name: "Dev", predicted: "X9", latestAl: latest("M2"), toNext: { ...count, questions: 0 }, status: "Same" }),
    ];
    const order = (key: Parameters<typeof sortRows>[1], ascending: boolean) =>
      sortRows(rows, key, ascending).map((r) => r.uid);

    expect(order("name", true)).toEqual(["a", "b", "c", "d"]);
    expect(order("name", false)).toEqual(["d", "c", "b", "a"]);
    // Best predicted level first ascending; an unknown or missing level last, by name.
    expect(order("predicted", true)).toEqual(["a", "b", "c", "d"]);
    // Top sorts below 0 questions; no figure sorts last.
    expect(order("toNext", false)).toEqual(["c", "d", "b", "a"]);
    expect(order("latestAl", true)).toEqual(["b", "d", "c", "a"]);
    expect(order("status", true)).toEqual(["c", "d", "b", "a"]);
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

describe("Cumulative report sections", () => {
  const test = { max: 300, retest: false };
  const tests = [
    { ...test, sessionId: "j", name: "JEE", date: "2026-08-01", stream: "engineering" },
    { ...test, sessionId: "n", name: "NEET", date: "2026-08-02", stream: "medical" },
    { ...test, sessionId: "x", name: "Common", date: "2026-08-03", stream: null },
  ];

  it("splits students by exam stream, JEE first, each with its own and stream-less tests", () => {
    const sections = streamSections(
      [row({ uid: "m", examStream: "medical" }), row({ uid: "e", examStream: "engineering" }), row({ uid: "f", examStream: null })],
      tests
    );
    expect(sections.map((s) => [s.key, s.rows.map((r) => r.uid), s.tests.map((t) => t.sessionId)])).toEqual([
      ["engineering", ["e"], ["j", "x"]],
      ["medical", ["m"], ["n", "x"]],
      ["other", ["f"], ["j", "n", "x"]],
    ]);
  });

  it("leaves out empty sections", () => {
    expect(streamSections([row({ examStream: "engineering" })], tests).map((s) => s.key)).toEqual(["engineering"]);
  });

  it("counts Mode ALs best first, with students not levelled last", () => {
    expect(
      modeDistribution([row({ mode: "M3" }), row({ mode: null }), row({ mode: "M1" }), row({ mode: "M3" })])
    ).toBe("M1:1 · M3:2 · No AL:1");
  });
});
