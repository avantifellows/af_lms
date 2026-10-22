import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => "/blended-learning",
}));

import type { FlagCard } from "@/lib/blended-learning-flags";

import { FlagsFeed, type FlagsView } from "./FlagsFeed";

const FLAG: FlagCard = {
  id: 7, recipient: "maths", comment: "Needs help with calculus", isNew: false, inScope: true,
  conversationId: 70, occurredOn: "2026-10-20", hasNotes: true, mentorUserId: 9001, mentorName: "Faizan",
  studentId: 501, name: "Ira Attempt", grade: 12, programName: "STP Voucher Delhi", gender: "Female",
  phone: null, whatsappPhone: null, profileDocUrl: null, screenerUrl: null,
};

function view(flags: FlagCard[], change: Partial<FlagsView> = {}): FlagsView {
  return {
    page: { flags, nextCursor: null, newCount: 0 },
    mentors: [
      { mentorUserId: 9001, name: "Faizan" },
      { mentorUserId: 9002, name: "Lokesh" },
    ],
    mentorUserId: null,
    recipient: null,
    cursor: null,
    since: "never",
    ...change,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FlagsFeed", () => {
  it("links an in-scope flag's Student, with a decorative arrow, and offers its Session Notes", () => {
    render(<FlagsFeed view={view([FLAG])} />);

    const card = screen.getByRole("article");
    const link = within(card).getByRole("link", { name: "Ira Attempt" });
    expect(link).toHaveAttribute("href", "/blended-learning/students/501?from=flags");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(card).getByRole("button", { name: "Show Session Notes" })).toBeInTheDocument();
  });

  it("shows a flag whose Mapping has ended without a Student link or notes that would 404", () => {
    render(<FlagsFeed view={view([{ ...FLAG, inScope: false }])} />);

    const card = screen.getByRole("article");
    expect(within(card).getByRole("heading", { name: "Ira Attempt" })).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Ira Attempt" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Show Session Notes" })).not.toBeInTheDocument();
    expect(within(card).getByText("Needs help with calculus")).toBeInTheDocument();
  });

  it("applies a filter as soon as it changes, keeping the visit's cutoff and dropping the page cursor", async () => {
    render(<FlagsFeed view={view([FLAG], { recipient: "maths", cursor: 40, since: "2026-10-20T06:00:00.000Z" })} />);

    const filters = screen.getByRole("search", { name: "Filter flags" });
    expect(within(filters).queryByRole("button")).not.toBeInTheDocument();
    expect(within(filters).getByLabelText("Flag Recipient")).toHaveValue("maths");

    await userEvent.selectOptions(within(filters).getByLabelText("Mentor"), "Lokesh");

    expect(mockPush).toHaveBeenCalledWith(
      "/blended-learning?tab=flags&since=2026-10-20T06%3A00%3A00.000Z&mentor=9002&recipient=maths",
      { scroll: false }
    );
  });

  it("clears a filter back to All, leaving the other one", async () => {
    render(<FlagsFeed view={view([FLAG], { mentorUserId: 9001, recipient: "maths" })} />);

    await userEvent.selectOptions(screen.getByLabelText("Flag Recipient"), "All recipients");

    expect(mockPush).toHaveBeenCalledWith("/blended-learning?tab=flags&since=never&mentor=9001", { scroll: false });
  });

  it("announces how many flags the feed shows, and when none match", () => {
    const { rerender } = render(<FlagsFeed view={view([FLAG])} />);
    expect(screen.getAllByRole("status")[0]).toHaveTextContent("Showing 1 Mentor Flag");

    rerender(<FlagsFeed view={view([], { mentorUserId: 9002 })} />);
    expect(screen.getByText("No Mentor Flags match these filters.")).toHaveAttribute("role", "status");
  });
});
