import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MenteeRow } from "@/lib/blended-learning-mentees";

import { MenteeGroup } from "./MenteeList";

const KABIR: MenteeRow = {
  studentId: 489985, name: "Kabir Never", gender: "Male", grade: 12, programId: 80,
  programName: "STP Voucher Delhi", lastContact: null, lastContactSource: null, latestEntryKind: null,
  openDraftState: "ready", reasons: ["no_contact"], daysSince: null,
};

function renderGroup(canLog: boolean) {
  render(
    <MenteeGroup title="Talk to First" description="Never reached." mentees={[KABIR]} emptyText="" canLog={canLog} />
  );
}

describe("MenteeGroup — a ready draft's chip", () => {
  it("opens the draft on the log page for a viewer who can log", () => {
    renderGroup(true);

    // The table (640 px up) and the cards (below) each carry the chip.
    const chips = screen.getAllByRole("link", { name: "Draft ready to review" });
    expect(chips).toHaveLength(2);
    for (const chip of chips) expect(chip).toHaveAttribute("href", "/blended-learning/students/489985/log");
  });

  it("is a plain label for a read-only viewer, not a link into a form they can't use (QA-14)", () => {
    renderGroup(false);

    expect(screen.queryByRole("link", { name: "Draft ready to review" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Draft ready to review")).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Kabir Never/ })[0]).toHaveAttribute(
      "href",
      "/blended-learning/students/489985"
    );
  });
});
