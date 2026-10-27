import { describe, expect, it } from "vitest";
import {
  alStatus,
  chapterFlag,
  examName,
  examStream,
  levelForTest,
  median,
  passMark,
  questionsToNext,
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

describe("questionsToNext", () => {
  const cutoffs: Record<string, number> = { M1: 93, M2: 60 };
  const cutoffFor = (level: string) => cutoffs[level] ?? null;
  const tests = (...marks: number[]) => marks.map((m, i) => ({ marks: m, test: `T${i + 1}` }));

  it("counts +4 answers from the median to the next cutoff (median 85 vs 93 → 2)", () => {
    expect(questionsToNext("M2", tests(80, 85, 90), cutoffFor)).toEqual({
      kind: "count",
      questions: 2,
      median: 85,
      cutoff: 93,
      nextLevel: "M1",
      tests: ["T1", "T2", "T3"],
    });
  });

  it("says Reached when the median already clears the cutoff", () => {
    expect(questionsToNext("M3", tests(70, 75), cutoffFor)).toEqual({ kind: "reached" });
  });

  it("says Top at M1 / B1", () => {
    expect(questionsToNext("M1", tests(10), cutoffFor)).toEqual({ kind: "top" });
    expect(questionsToNext("B1", [], cutoffFor)).toEqual({ kind: "top" });
  });

  it("is blank with no tests, no mode or no cutoff", () => {
    expect(questionsToNext("M2", [], cutoffFor)).toEqual({ kind: "none" });
    expect(questionsToNext(null, tests(50), cutoffFor)).toEqual({ kind: "none" });
    expect(questionsToNext("B2", tests(50), cutoffFor)).toEqual({ kind: "none" });
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
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
