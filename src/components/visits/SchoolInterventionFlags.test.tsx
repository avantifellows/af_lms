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
};

function section() {
  return screen.getByRole("region", { name: "Intervention flags" });
}

describe("SchoolInterventionFlags", () => {
  it("counts open and resolved flags in the header", () => {
    render(<SchoolInterventionFlags schoolCode="SC001" flags={{ open: [FLAG], resolvedCount: 2 }} />);

    expect(section()).toHaveTextContent("Intervention flags1 open · 2 resolved");
  });

  it("leaves resolved out of the header when none are resolved", () => {
    render(<SchoolInterventionFlags schoolCode="SC001" flags={{ open: [FLAG], resolvedCount: 0 }} />);

    expect(section()).toHaveTextContent("1 open");
    expect(section()).not.toHaveTextContent("resolved");
  });

  it("shows each open flag's Student, grade, Centre tag, raiser, IST date and update count", () => {
    render(<SchoolInterventionFlags schoolCode="SC001" flags={{ open: [FLAG], resolvedCount: 0 }} />);

    const row = within(section()).getByRole("link");
    expect(row).toHaveTextContent("Open");
    expect(row).toHaveTextContent("Asha Verma");
    expect(row).toHaveTextContent("Grade 11");
    expect(row).toHaveTextContent("CoE");
    expect(row).toHaveTextContent("Raised by Ravi PM on 21 Oct 2026");
    expect(row).toHaveTextContent("3 updates");
  });

  it("shows no update count for a flag with a single update, and no grade or tag when unknown", () => {
    const bare = { ...FLAG, grade: null, centreTag: null, updateCount: 1 };
    render(<SchoolInterventionFlags schoolCode="SC001" flags={{ open: [bare], resolvedCount: 0 }} />);

    const row = within(section()).getByRole("link");
    expect(row).not.toHaveTextContent("update");
    expect(row).not.toHaveTextContent("Grade");
    expect(row).not.toHaveTextContent("CoE");
  });

  it("opens the Student's flag on the School's Enrollment tab", () => {
    render(
      <SchoolInterventionFlags
        schoolCode="SC 001/A"
        flags={{ open: [FLAG, { ...FLAG, id: 502, studentName: "Kiran Rao" }], resolvedCount: 0 }}
      />
    );

    const links = within(section()).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/school/SC%20001%2FA?tab=enrollment&flag=501",
      "/school/SC%20001%2FA?tab=enrollment&flag=502",
    ]);
  });

  it("says No open flags when there are none", () => {
    render(<SchoolInterventionFlags schoolCode="SC001" flags={{ open: [], resolvedCount: 4 }} />);

    expect(section()).toHaveTextContent("0 open · 4 resolved");
    expect(within(section()).getByText("No open flags")).toBeInTheDocument();
    expect(within(section()).queryByRole("link")).not.toBeInTheDocument();
  });
});
