import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";

import AiTestInsightsStudentCard from "./AiTestInsightsStudentCard";

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
    ]);
  });
});
