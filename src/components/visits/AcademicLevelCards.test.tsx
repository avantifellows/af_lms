import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import type { AcademicLevelCard } from "@/lib/visit-summary-school";
import { AcademicLevelCards } from "./AcademicLevelCards";

const JEE_CARD: AcademicLevelCard = {
  centreId: "41",
  centreName: "JNV Bhopal CoE",
  tag: "CoE",
  grade: 11,
  exam: "JEE",
  levels: [
    { level: "M1", students: 3 },
    { level: "M2", students: 5 },
    { level: "Not Qualified", students: 2 },
  ],
  na: 4,
  total: 14,
};

const NEET_CARD: AcademicLevelCard = {
  centreId: "42",
  centreName: "JNV Bhopal Nodal",
  tag: "Nodal",
  grade: 12,
  exam: "NEET",
  levels: [],
  na: 1,
  total: 1,
};

describe("AcademicLevelCards", () => {
  it("shows one card per Centre, grade and exam with its total, Now levels and NA", () => {
    render(<AcademicLevelCards data={{ available: true, cards: [JEE_CARD, NEET_CARD] }} />);

    const cards = within(screen.getByRole("list", { name: "Academic levels" })).getAllByRole("link");
    expect(cards).toHaveLength(2);

    // 3 + 5 + 2 levelled + 4 NA = 14.
    expect(cards[0]).toHaveTextContent("CoE · Grade 11 · JEE");
    expect(cards[0]).toHaveTextContent("14 students");
    // Levels best first as given, the long Not Qualified label shortened.
    expect(within(cards[0]).getByText("Now").parentElement).toHaveTextContent(/^NowM1 3 · M2 5 · NQ 2$/);
    expect(cards[0]).toHaveTextContent("NA 4");

    expect(cards[1]).toHaveTextContent("Nodal · Grade 12 · NEET");
    expect(cards[1]).toHaveTextContent("1 student");
    expect(cards[1]).not.toHaveTextContent("1 students");
    expect(within(cards[1]).getByText("Now").parentElement).toHaveTextContent(/^Now—$/);
    expect(cards[1]).toHaveTextContent("NA 1");
  });

  it("opens the Centre's cumulative report for the card's grade", () => {
    render(<AcademicLevelCards data={{ available: true, cards: [JEE_CARD, NEET_CARD] }} />);

    const cards = screen.getAllByRole("link");
    expect(cards[0]).toHaveAttribute("href", "/centre/41?tab=performance&grade=11&view=cumulative");
    expect(cards[1]).toHaveAttribute("href", "/centre/42?tab=performance&grade=12&view=cumulative");
    expect(cards[0].getAttribute("title")).toMatch(/^JNV Bhopal CoE\. NA: no al-bearing test yet\./);
  });

  it("says Academic levels unavailable when the counts could not be read", () => {
    render(<AcademicLevelCards data={{ available: false }} />);

    expect(screen.getByText("Academic levels unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says there are no JEE or NEET students when there are no cards", () => {
    render(<AcademicLevelCards data={{ available: true, cards: [] }} />);

    expect(screen.getByText("No JEE or NEET students at this School's physical centres")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
