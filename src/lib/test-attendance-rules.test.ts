import { describe, expect, it } from "vitest";

import { examPreparingFor, monthlyTestsFrom, type PaperWindow } from "./test-attendance-rules";

describe("examPreparingFor", () => {
  it.each([
    ["Engineering", "Engineering"],
    ["engineering", "Engineering"],
    ["  MEDICAL ", "Medical"],
    ["clat", "CLAT"],
    ["Ca", "CA"],
    ["nda", "NDA"],
  ])("matches %j without regard to case as %s", (raw, expected) => {
    expect(examPreparingFor(raw)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["   "], ["Science"], ["JEE"], ["Engineering and NDA"]])(
    "treats %j as none",
    (raw) => {
      expect(examPreparingFor(raw)).toBeNull();
    },
  );
});

// Times below are written as IST wall clock and converted by hand:
// 2026-10-06 05:00 IST = 2026-10-05T23:30:00Z; 2026-10-10 23:55 IST = 2026-10-10T18:25:00Z.
const paper = (quizId: string, overrides: Partial<PaperWindow> = {}): PaperWindow => ({
  quizId,
  opensAt: "2026-10-05T23:30:00.000Z",
  closesAt: "2026-10-10T18:25:00.000Z",
  grade: 11,
  switchedOn: true,
  ...overrides,
});

describe("monthlyTestsFrom", () => {
  it("makes one Monthly Test per list entry, named by its label, with the first three letters as short name", () => {
    const tests = monthlyTestsFrom(
      [{ label: "October", quizIds: ["q1", "q2"] }],
      [paper("q1", { grade: 11 }), paper("q2", { grade: 12 })],
      new Date("2026-10-12T06:00:00.000Z"),
    );

    expect(tests).toEqual([
      {
        key: "october",
        name: "October",
        shortName: "Oct",
        opensAt: "2026-10-05T23:30:00.000Z",
        closesAt: "2026-10-10T18:25:00.000Z",
        state: "closed",
        grades: [11, 12],
      },
    ]);
  });

  const october = [{ label: "October", quizIds: ["q1"] }];
  const stateAt = (iso: string) => monthlyTestsFrom(october, [paper("q1")], new Date(iso)).map((t) => t.state);

  it("is not shown before its opening time", () => {
    expect(stateAt("2026-10-05T23:29:59.999Z")).toEqual([]);
  });

  it("is running from exactly its opening time", () => {
    expect(stateAt("2026-10-05T23:30:00.000Z")).toEqual(["running"]);
  });

  it("is still running just before its closing time", () => {
    expect(stateAt("2026-10-10T18:24:59.999Z")).toEqual(["running"]);
  });

  it("is closed from exactly its closing time", () => {
    expect(stateAt("2026-10-10T18:25:00.000Z")).toEqual(["closed"]);
  });

  it("keeps a Paper closing at 11:55 pm IST running at 11:00 pm IST that day", () => {
    // 2026-10-10 23:00 IST = 2026-10-10T17:30:00Z
    expect(stateAt("2026-10-10T17:30:00.000Z")).toEqual(["running"]);
  });

  it("opens at the earliest Paper opening and closes at the latest Paper closing", () => {
    // G12 opens 19 Aug 05:00 IST and closes 24 Aug 23:55 IST; G11 opens 26 Aug 05:00 IST and closes 30 Aug 23:55 IST.
    const tests = monthlyTestsFrom(
      [{ label: "August", quizIds: ["g12", "g11"] }],
      [
        paper("g12", { grade: 12, opensAt: "2026-08-18T23:30:00.000Z", closesAt: "2026-08-24T18:25:00.000Z" }),
        paper("g11", { grade: 11, opensAt: "2026-08-25T23:30:00.000Z", closesAt: "2026-08-30T18:25:00.000Z" }),
      ],
      new Date("2026-08-27T06:00:00.000Z"),
    );

    expect(tests).toEqual([
      expect.objectContaining({
        opensAt: "2026-08-18T23:30:00.000Z",
        closesAt: "2026-08-30T18:25:00.000Z",
        state: "running",
        grades: [11, 12],
      }),
    ]);
  });

  it("skips a switched-off Paper, a Paper with no session row and a Paper with a missing time", () => {
    // Only the G12 Paper is usable: the G11 one is switched off (as August's G11 Papers are in production).
    const tests = monthlyTestsFrom(
      [{ label: "August", quizIds: ["g12", "g11-off", "no-row", "no-close", "no-open"] }],
      [
        paper("g12", { grade: 12, opensAt: "2026-08-18T23:30:00.000Z", closesAt: "2026-08-24T18:25:00.000Z" }),
        paper("g11-off", { grade: 11, switchedOn: false, opensAt: "2026-08-25T23:30:00.000Z", closesAt: "2026-08-30T18:25:00.000Z" }),
        paper("no-close", { grade: 11, closesAt: null }),
        paper("no-open", { grade: 11, opensAt: null }),
      ],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests).toEqual([
      {
        key: "august",
        name: "August",
        shortName: "Aug",
        opensAt: "2026-08-18T23:30:00.000Z",
        closesAt: "2026-08-24T18:25:00.000Z",
        state: "closed",
        grades: [12],
      },
    ]);
  });

  it("leaves out a Monthly Test with no usable Paper", () => {
    const tests = monthlyTestsFrom(
      [
        { label: "July", quizIds: ["off"] },
        { label: "October", quizIds: ["q1"] },
      ],
      [paper("off", { switchedOn: false }), paper("q1")],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests.map((t) => t.name)).toEqual(["October"]);
  });

  it("orders Monthly Tests by closing time, whatever the list order", () => {
    const tests = monthlyTestsFrom(
      [
        { label: "October", quizIds: ["oct"] },
        { label: "July", quizIds: ["jul"] },
        { label: "September", quizIds: ["sep"] },
      ],
      [
        paper("oct", { opensAt: "2026-10-05T23:30:00.000Z", closesAt: "2026-10-10T18:25:00.000Z" }),
        paper("jul", { opensAt: "2026-07-21T23:30:00.000Z", closesAt: "2026-07-28T18:15:00.000Z" }),
        paper("sep", { opensAt: "2026-09-08T23:30:00.000Z", closesAt: "2026-09-15T18:25:00.000Z" }),
      ],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests.map((t) => [t.name, t.shortName])).toEqual([
      ["July", "Jul"],
      ["September", "Sep"],
      ["October", "Oct"],
    ]);
  });

  it("gives every Monthly Test its own key", () => {
    const tests = monthlyTestsFrom(
      [
        { label: "Mock Test", quizIds: ["a"] },
        { label: "Mock  test", quizIds: ["b"] },
      ],
      [
        paper("a", { closesAt: "2026-10-09T18:25:00.000Z" }),
        paper("b", { closesAt: "2026-10-10T18:25:00.000Z" }),
      ],
      new Date("2026-11-18T08:30:00.000Z"),
    );

    expect(tests.map((t) => [t.key, t.shortName])).toEqual([
      ["mock-test", "Moc"],
      ["mock-test-2", "Moc"],
    ]);
  });
});
