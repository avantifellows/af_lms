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

// The Now row's cells as "label count", in order.
function nowCells(card: HTMLElement): string[] {
  return [...card.querySelectorAll("dt")].map((dt) => `${dt.textContent} ${dt.nextElementSibling?.textContent}`);
}

function largestCells(card: HTMLElement): string[] {
  return [...card.querySelectorAll("[data-largest] dt")].map((dt) => dt.textContent ?? "");
}

describe("AcademicLevelCards", () => {
  it("shows one card per Centre, grade and exam with its tag, total and one Now row ending in NA", () => {
    render(<AcademicLevelCards data={{ available: true, cards: [JEE_CARD, NEET_CARD] }} />);

    const cards = within(screen.getByRole("list", { name: "Academic level" })).getAllByRole("link");
    expect(cards).toHaveLength(2);

    // 3 + 5 + 2 levelled + 4 NA = 14.
    expect(cards[0]).toHaveTextContent(/^CoEG11 JEE ↗14 studentsNow/);
    // The exam's three levels always (M3 at 0), any other level the data has, best first, then NA.
    expect(nowCells(cards[0])).toEqual(["M1 3", "M2 5", "M3 0", "NQ 2", "NA 4"]);
    expect(within(cards[0]).getByText("NA").parentElement).toHaveAttribute("title", "No AL-bearing test yet");
    expect(screen.queryByText("Pred")).not.toBeInTheDocument();

    expect(cards[1]).toHaveTextContent(/^NodalG12 NEET ↗1 studentNow/);
    expect(nowCells(cards[1])).toEqual(["B1 0", "B2 0", "B3 0", "NA 1"]);
  });

  it("marks the largest level red, never NA, and none when every level is 0", () => {
    render(<AcademicLevelCards data={{ available: true, cards: [JEE_CARD, NEET_CARD] }} />);

    const cards = screen.getAllByRole("link");
    expect(largestCells(cards[0])).toEqual(["M2"]);
    expect(within(cards[0]).getByText("M2")).toHaveClass("text-danger");
    expect(within(cards[0]).getByText("M1")).not.toHaveClass("text-danger");
    expect(largestCells(cards[1])).toEqual([]);
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

    expect(screen.getByRole("heading", { name: "Academic level" })).toBeInTheDocument();
    expect(screen.getByText("Academic levels unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("says there are no JEE or NEET students when there are no cards", () => {
    render(<AcademicLevelCards data={{ available: true, cards: [] }} />);

    expect(screen.getByText("No JEE or NEET students at this School's physical centres")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
