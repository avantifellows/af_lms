import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import type { VisitSummaryFlagRow } from "@/lib/visit-summary-school";
import { SchoolInterventionFlags } from "./SchoolInterventionFlags";

const FLAG: VisitSummaryFlagRow = {
  id: 501,
  studentName: "Asha Verma",
  grade: 11,
  centreTag: "CoE",
  raisedBy: "Ravi PM",
  // 01:30 on 21 Oct in IST.
  raisedAt: "2026-10-20T20:00:00.000Z",
  updateCount: 3,
  notesHref: "/school/SC001?tab=enrollment&flag=501",
};

function section() {
  return screen.getByRole("region", { name: "Intervention flags" });
}

function rows() {
  return within(section()).getAllByRole("listitem");
}

describe("SchoolInterventionFlags", () => {
  it("counts open and resolved flags in the header", () => {
    render(<SchoolInterventionFlags flags={{ open: [FLAG], resolvedCount: 2 }} />);

    expect(section()).toHaveTextContent(/^⚑Intervention flags1 open · 2 resolved/);
  });

  it("leaves resolved out of the header when none are resolved", () => {
    render(<SchoolInterventionFlags flags={{ open: [FLAG], resolvedCount: 0 }} />);

    expect(section()).toHaveTextContent("1 open");
    expect(section()).not.toHaveTextContent("resolved");
  });

  it("shows each open flag's Student initials, grade and Centre, raiser, IST date and update count", () => {
    render(<SchoolInterventionFlags flags={{ open: [FLAG], resolvedCount: 0 }} />);

    const [row] = rows();
    expect(row).toHaveTextContent("OpenA. V.G11 CoERaised by Ravi PM · 21 Oct 20263 updatesNotes in LMS ↗");
    // The full name is on hover only.
    expect(within(row).getByText("A. V.")).toHaveAttribute("title", "Asha Verma");
    expect(row).not.toHaveTextContent("Asha Verma");
  });

  it("shows no update count for a flag with a single update, and no grade or tag when unknown", () => {
    const bare = { ...FLAG, grade: null, centreTag: null, updateCount: 1 };
    render(<SchoolInterventionFlags flags={{ open: [bare], resolvedCount: 0 }} />);

    expect(rows()[0]).toHaveTextContent("OpenA. V.Raised by Ravi PM · 21 Oct 2026Notes in LMS ↗");
  });

  it("links Notes in LMS to the destination the server chose for the viewer, School or Centre", () => {
    render(
      <SchoolInterventionFlags
        flags={{
          open: [FLAG, { ...FLAG, id: 502, studentName: "Kiran  rao", notesHref: "/centre/101?tab=enrollment&flag=502" }],
          resolvedCount: 0,
        }}
      />
    );

    const links = within(section()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/school/SC001?tab=enrollment&flag=501",
      "/centre/101?tab=enrollment&flag=502",
    ]);
    expect(screen.getByRole("link", { name: "Notes in LMS for K. R." })).toBeInTheDocument();
  });

  it("shows the row without Notes in LMS when the viewer can open neither the School's nor the Centre's page", () => {
    render(<SchoolInterventionFlags flags={{ open: [{ ...FLAG, notesHref: null }], resolvedCount: 0 }} />);

    expect(rows()[0]).toHaveTextContent("OpenA. V.G11 CoERaised by Ravi PM · 21 Oct 20263 updates");
    expect(rows()[0]).not.toHaveTextContent("Notes in LMS");
    expect(within(section()).queryByRole("link")).not.toBeInTheDocument();
  });

  it("says No open flags when there are none", () => {
    render(<SchoolInterventionFlags flags={{ open: [], resolvedCount: 4 }} />);

    expect(section()).toHaveTextContent("0 open · 4 resolved");
    expect(within(section()).getByText("No open flags")).toBeInTheDocument();
    expect(within(section()).queryByRole("link")).not.toBeInTheDocument();
  });
});
