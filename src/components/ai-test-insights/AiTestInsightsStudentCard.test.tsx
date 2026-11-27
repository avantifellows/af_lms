import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import AiTestInsightsStudentCard from "./AiTestInsightsStudentCard";
import type { AiTestInsightsStudentCardData } from "@/lib/ai-test-insights-shared";

const ASHA: AiTestInsightsStudentCardData = {
  name: "Asha Kumar",
  studentCode: "STU1001",
  grade: 11,
  batches: ["JNV CoE 11 A"],
  gender: "Female",
  category: "OBC",
  stream: "engineering",
  insightSessionsCompleted: 3,
  lastInsightSessionDate: "2026-11-14",
};

const newestTestLine = () => fields().find(([label]) => label === "Newest test")?.[1];

/** The card's fields as [label, value] pairs, in the order shown. */
function fields(): string[][] {
  const card = screen.getByRole("region", { name: "Student" });
  return within(card)
    .getAllByRole("term")
    .map((term) => [term.textContent ?? "", term.nextElementSibling?.textContent ?? ""]);
}

describe("AiTestInsightsStudentCard", () => {
  it("shows who the Student is and their Insight Sessions", () => {
    render(
      <AiTestInsightsStudentCard
        student={{
          name: "Asha Kumar",
          studentCode: "STU1001",
          grade: 11,
          batches: ["JNV CoE 11 A", "JNV CoE 11 Physics"],
          gender: "Female",
          category: "OBC",
          stream: "engineering",
          insightSessionsCompleted: 3,
          lastInsightSessionDate: "2026-11-14",
        }}
        tests={{ status: "loaded", tests: [] }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Asha Kumar" })).toBeInTheDocument();
    expect(fields()).toEqual([
      ["Student ID", "STU1001"],
      ["Grade", "11"],
      ["Batch", "JNV CoE 11 A, JNV CoE 11 Physics"],
      ["Gender", "Female"],
      ["Category", "OBC"],
      ["Stream", "engineering"],
      ["Insight Sessions completed", "3"],
      ["Last Insight Session", "14 Nov 2026"],
      ["Newest test", "—"],
    ]);
  });

  it("shows a dash for each missing value, and 0 sessions as 0", () => {
    render(
      <AiTestInsightsStudentCard
        student={{
          name: "Bilal Khan",
          studentCode: null,
          grade: 12,
          batches: [],
          gender: null,
          category: null,
          stream: "PCM",
          insightSessionsCompleted: 0,
          lastInsightSessionDate: null,
        }}
        tests={{ status: "loaded", tests: [] }}
      />,
    );

    expect(fields()).toEqual([
      ["Student ID", "—"],
      ["Grade", "12"],
      ["Batch", "—"],
      ["Gender", "—"],
      ["Category", "—"],
      ["Stream", "PCM"],
      ["Insight Sessions completed", "0"],
      ["Last Insight Session", "—"],
      ["Newest test", "—"],
    ]);
  });

  describe("the newest test line", () => {
    it("shows the name and date of the test picker's first test", () => {
      render(
        <AiTestInsightsStudentCard
          student={ASHA}
          tests={{
            status: "loaded",
            tests: [
              { id: "T9", name: "Mock Test 1", date: "2026-11-02", format: "mock_test" },
              { id: "T4", name: "Major Test 2", date: "2026-10-12", format: "major_test" },
            ],
          }}
        />,
      );

      expect(newestTestLine()).toBe("Mock Test 1 · 2 Nov 2026");
    });

    it("shows a dash when the Student has no test in the picker", () => {
      render(<AiTestInsightsStudentCard student={ASHA} tests={{ status: "loaded", tests: [] }} />);

      expect(newestTestLine()).toBe("—");
    });

    it('shows "unavailable" when the tests could not be loaded', () => {
      render(<AiTestInsightsStudentCard student={ASHA} tests={{ status: "failed" }} />);

      expect(newestTestLine()).toBe("unavailable");
    });

    it("says it is loading while the tests are read", () => {
      render(<AiTestInsightsStudentCard student={ASHA} tests={{ status: "loading" }} />);

      expect(newestTestLine()).toBe("Loading…");
    });
  });
});
