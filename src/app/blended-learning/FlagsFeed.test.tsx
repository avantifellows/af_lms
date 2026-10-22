import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { FlagCard } from "@/lib/blended-learning-flags";

import { FlagsFeed, type FlagsView } from "./FlagsFeed";

const FLAG: FlagCard = {
  id: 7, recipient: "maths", comment: "Needs help with calculus", isNew: false, inScope: true,
  conversationId: 70, occurredOn: "2026-10-20", hasNotes: true, mentorUserId: 9001, mentorName: "Faizan",
  studentId: 501, name: "Ira Attempt", grade: 12, programName: "STP Voucher Delhi", gender: "Female",
  phone: null, whatsappPhone: null, profileDocUrl: null, screenerUrl: null,
};

function view(flags: FlagCard[]): FlagsView {
  return {
    page: { flags, nextCursor: null, newCount: 0 },
    mentors: [],
    mentorUserId: null,
    recipient: null,
    cursor: null,
    since: "never",
  };
}

describe("FlagsFeed", () => {
  it("links an in-scope flag's Student and offers its notes", () => {
    render(<FlagsFeed view={view([FLAG])} />);

    const card = screen.getByRole("article");
    expect(within(card).getByRole("link", { name: "Ira Attempt" })).toHaveAttribute(
      "href",
      "/blended-learning/students/501"
    );
    expect(within(card).getByRole("button", { name: "Show notes" })).toBeInTheDocument();
  });

  it("shows a flag whose Mapping has ended without a Student link or notes that would 404", () => {
    render(<FlagsFeed view={view([{ ...FLAG, inScope: false }])} />);

    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading", { name: "Ira Attempt" })).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Ira Attempt" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Show notes" })).not.toBeInTheDocument();
    expect(within(card).getByText("Needs help with calculus")).toBeInTheDocument();
  });
});
