import { describe, expect, it } from "vitest";
import {
  type JourneySitting,
  alStatus,
  changeDirection,
  chapterFlag,
  examName,
  examStream,
  latestChange,
  latestLevel,
  levelForTest,
  passMark,
  questionsToNext,
  retestIds,
  scoreDirection,
  scoreTrend,
  slope,
  topicFlag,
} from "./student-support-rules";

describe("examStream", () => {
  it("maps the warehouse's stream spellings", () => {
    expect(examStream("PCM")).toBe("engineering");
    expect(examStream(" Engg ")).toBe("engineering");
    expect(examStream("medical")).toBe("medical");
    expect(examStream("PCB")).toBe("medical");
    expect(examStream("foundation")).toBeNull();
    expect(examStream(null)).toBeNull();
  });
});

describe("levelForTest", () => {
  it("reads Not Qualified as the stream's lowest level, as the warehouse mode does", () => {
    expect(levelForTest("Not Qualified", "engineering")).toBe("M3");
    expect(levelForTest("Not Qualified", "medical")).toBe("B3");
    expect(levelForTest("M2", "engineering")).toBe("M2");
    expect(levelForTest("Not Eligible for Academic Level", "engineering")).toBeNull();
  });
});

describe("alStatus", () => {
  it("compares Mode with Predicted", () => {
    expect(alStatus("M2", "M3")).toBe("Sliding");
    expect(alStatus("M2", "M1")).toBe("Improving");
    expect(alStatus("M2", "M2")).toBe("Same");
  });

  it("is blank without both levels", () => {
    expect(alStatus(null, "M2")).toBeNull();
    expect(alStatus("M2", null)).toBeNull();
    expect(alStatus("M2", "Not Eligible for Academic Level")).toBeNull();
  });
});

function sitting(over: Partial<JourneySitting>): JourneySitting {
  return { sessionId: "s", test: "T", level: "M2", marks: 100, max: 300, retest: false, ...over };
}

describe("retestIds", () => {
  it("marks a later session with an earlier session's name, whatever order they arrive in", () => {
    const ids = retestIds([
      { sessionId: "b", name: "FT 2", date: "2026-08-01" },
      { sessionId: "r2", name: "FT 1 ", date: "2026-09-01" },
      { sessionId: "a", name: "FT 1", date: "2026-07-01" },
      { sessionId: "r1", name: "FT 1", date: "2026-07-01" },
    ]);
    // Same day: the higher session id is the retest.
    expect([...ids].sort()).toEqual(["r1", "r2"]);
  });

  it("marks nothing when every name is new", () => {
    expect(retestIds([{ sessionId: "a", name: "FT 1", date: "2026-07-01" }]).size).toBe(0);
  });
});

describe("latestLevel", () => {
  it("is the newest sitting with a level that is not a retest", () => {
    expect(
      latestLevel([
        sitting({ test: "FT 1", level: "M3", marks: 40 }),
        sitting({ test: "FT 2", level: "M2", marks: 90 }),
        sitting({ test: "FT 3", level: null, marks: 10 }),
        sitting({ test: "FT 2", level: "M1", marks: 200, retest: true }),
      ])
    ).toEqual({ level: "M2", marks: 90, test: "FT 2" });
  });

  it("is null without such a sitting", () => {
    expect(latestLevel([sitting({ retest: true })])).toBeNull();
    expect(latestLevel([])).toBeNull();
  });
});

describe("questionsToNext", () => {
  const cutoffs: Record<string, number> = { M1: 93, M2: 60 };
  const cutoffFor = (level: string) => cutoffs[level] ?? null;

  it("counts +4 answers from the latest test's marks to the cutoff above (85 vs 93 → 2)", () => {
    expect(questionsToNext({ level: "M2", marks: 85, test: "FT 3" }, cutoffFor)).toEqual({
      kind: "count",
      questions: 2,
      gap: 8,
      cutoff: 93,
      nextLevel: "M1",
      test: "FT 3",
      marks: 85,
    });
  });

  it("rounds the marks gap up before counting answers", () => {
    expect(questionsToNext({ level: "M2", marks: 88.5, test: "T" }, cutoffFor)).toMatchObject({ gap: 5, questions: 2 });
  });

  it("is 0 when the latest marks already clear the cutoff", () => {
    expect(questionsToNext({ level: "M3", marks: 75, test: "T" }, cutoffFor)).toMatchObject({
      kind: "count", questions: 0, gap: -15, nextLevel: "M2",
    });
  });

  it("says Top at M1 / B1", () => {
    expect(questionsToNext({ level: "M1", marks: 10, test: "T" }, cutoffFor)).toEqual({ kind: "top" });
    expect(questionsToNext({ level: "B1", marks: null, test: "T" }, cutoffFor)).toEqual({ kind: "top" });
  });

  it("is blank with no Latest AL, no marks or no cutoff", () => {
    expect(questionsToNext(null, cutoffFor)).toEqual({ kind: "none" });
    expect(questionsToNext({ level: "M2", marks: null, test: "T" }, cutoffFor)).toEqual({ kind: "none" });
    expect(questionsToNext({ level: "B2", marks: 50, test: "T" }, cutoffFor)).toEqual({ kind: "none" });
  });
});

describe("score trend", () => {
  it("fits a least-squares slope", () => {
    expect(slope([10, 20, 30])).toBe(10);
    expect(slope([30, 10, 30, 10])).toBeCloseTo(-4);
  });

  it("reads above +0.25 as Improving, below -0.25 as Declining, else Same", () => {
    expect(scoreDirection(0.26)).toBe("Improving");
    expect(scoreDirection(0.25)).toBe("Same");
    expect(scoreDirection(-0.25)).toBe("Same");
    expect(scoreDirection(-0.26)).toBe("Declining");
  });

  it("plots every non-retest score % but reads the direction over the last 5", () => {
    const marks = [300, 30, 45, 60, 75, 90];
    const trend = scoreTrend([
      ...marks.map((m) => sitting({ marks: m, max: 300 })),
      sitting({ marks: 0, max: 300, retest: true }),
      sitting({ marks: null }),
      sitting({ marks: 50, max: null }),
    ]);
    // The first test's 100% would make it Declining; only the last 5 count.
    expect(trend).toEqual({ points: [100, 10, 15, 20, 25, 30], direction: "Improving", slope: 5, recent: 5 });
  });

  it("is null with fewer than two scored tests", () => {
    expect(scoreTrend([sitting({}), sitting({ retest: true })])).toBeNull();
  });
});

describe("latestChange", () => {
  it("compares the latest non-retest marks with the previous one", () => {
    expect(
      latestChange([
        sitting({ sessionId: "a", test: "FT 1", marks: 80 }),
        sitting({ sessionId: "b", test: "FT 2", marks: 100 }),
        sitting({ sessionId: "c", test: "FT 2", marks: 150, retest: true }),
        sitting({ sessionId: "d", test: "FT 3", marks: null }),
        sitting({ sessionId: "e", test: "FT 4", marks: 92.5 }),
      ])
    ).toEqual({ sessionId: "e", change: -7.5, previous: "FT 2" });
  });

  it("is null with fewer than two", () => {
    expect(latestChange([sitting({})])).toBeNull();
  });

  it("is up above +0.5, down below -0.5, else flat", () => {
    expect(changeDirection(0.6)).toBe("up");
    expect(changeDirection(0.5)).toBe("flat");
    expect(changeDirection(-0.5)).toBe("flat");
    expect(changeDirection(-0.6)).toBe("down");
  });
});

describe("passMark", () => {
  it("uses the exam and subject pass marks", () => {
    expect(passMark("JEE Main", "Physics")).toBe(35);
    expect(passMark("JEE Advanced", "overall")).toBe(30);
    expect(passMark("NEET", "Chemistry")).toBe(50);
    expect(passMark("NEET", "Biology")).toBe(75);
    expect(passMark("NEET", "Zoology")).toBe(75);
  });
});

describe("chapterFlag", () => {
  it("does not flag a chapter with fewer than 4 answers (n=3, s=10)", () => {
    expect(chapterFlag({ n: 3, attempt: 50, accuracy: 20, score: 10 }, 35)).toBeNull();
  });

  it("flags low accuracy as a concept gap (n=5, s=20, acc 50 → C)", () => {
    expect(chapterFlag({ n: 5, attempt: 80, accuracy: 50, score: 20 }, 35)).toBe("C");
  });

  it("flags low attempt as skipping (n=5, s=20, acc 80, attempt 40 → S)", () => {
    expect(chapterFlag({ n: 5, attempt: 40, accuracy: 80, score: 20 }, 35)).toBe("S");
  });

  it("flags nothing attempted as skipping", () => {
    expect(chapterFlag({ n: 6, attempt: 0, accuracy: null, score: 0 }, 35)).toBe("S");
  });
});

describe("topicFlag", () => {
  it("flags nothing inside an on-track chapter", () => {
    expect(topicFlag({ attempt: 80, accuracy: 20, score: 10 }, null, 35)).toBeNull();
  });

  it("flags a weak topic of a flagged chapter, even with one answer", () => {
    expect(topicFlag({ attempt: 100, accuracy: 0, score: -25 }, "S", 35)).toBe("C");
    expect(topicFlag({ attempt: 0, accuracy: null, score: 0 }, "C", 35)).toBe("S");
  });

  it("leaves a topic at or above the pass mark unflagged", () => {
    expect(topicFlag({ attempt: 100, accuracy: 50, score: 35 }, "C", 35)).toBeNull();
  });

  it("falls back to concept gap when both accuracy and attempt are high", () => {
    expect(chapterFlag({ n: 6, attempt: 90, accuracy: 70, score: 20 }, 35)).toBe("C");
  });

  it("does not flag at or above the pass mark (JEE Advanced 28 is below 30)", () => {
    expect(chapterFlag({ n: 6, attempt: 90, accuracy: 70, score: 35 }, 35)).toBeNull();
    expect(chapterFlag({ n: 6, attempt: 90, accuracy: 40, score: 28 }, 30)).toBe("C");
  });
});

describe("examName", () => {
  it("names JEE Mains as JEE Main and passes others through", () => {
    expect(examName("JEE Mains")).toBe("JEE Main");
    expect(examName("NEET")).toBe("NEET");
    expect(examName(null)).toBeNull();
  });
});
