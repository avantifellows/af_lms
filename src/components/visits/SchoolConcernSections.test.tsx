import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import type { ConcernCard, SchoolConcernPage } from "@/lib/visit-concerns";
import { SchoolConcernSections } from "./SchoolConcernSections";

// 11:30 on 28 Oct 2026 in IST.
const TODAY = new Date("2026-10-28T06:00:00.000Z");

const RECURRING: ConcernCard = {
  id: 1,
  kind: "concern",
  text: "Lab equipment missing",
  status: "open",
  visitCount: 3,
  visitDates: ["2026-10-15", "2026-08-06", "2026-08-06"],
  reopened: true,
  history: [
    {
      kind: "resolved",
      body: "Kits ordered",
      authorEmail: "pm@avantifellows.org",
      authorName: "Ravi PM",
      visitId: null,
      visitDate: null,
      at: new Date("2026-08-10T04:30:00.000Z"),
    },
    {
      kind: "auto_reopened",
      body: null,
      authorEmail: null,
      authorName: null,
      visitId: 12,
      visitDate: "2026-10-15",
      at: new Date("2026-10-16T04:30:00.000Z"),
    },
  ],
};

const ONE_OFF: ConcernCard = {
  id: 2,
  kind: "concern",
  text: "Timetable not displayed",
  status: "open",
  visitCount: 1,
  visitDates: ["2025-12-01"],
  reopened: false,
  history: [],
};

const HIGHLIGHT: ConcernCard = {
  id: 3,
  kind: "highlight",
  text: "Students asking doubts",
  status: null,
  visitCount: 2,
  visitDates: ["2026-10-15", "2026-08-06"],
  reopened: false,
  history: [],
};

const RESOLVED: ConcernCard = {
  id: 4,
  kind: "concern",
  text: "Water cooler broken",
  status: "resolved",
  visitCount: 2,
  visitDates: ["2026-10-15", "2026-08-06"],
  reopened: false,
  history: [
    {
      kind: "resolved",
      body: "Plumber fixed it",
      authorEmail: "admin@avantifellows.org",
      authorName: null,
      visitId: null,
      visitDate: null,
      at: new Date("2026-10-01T04:30:00.000Z"),
    },
  ],
};

const PAGE: SchoolConcernPage = {
  needsAttention: [RECURRING, ONE_OFF],
  goingWell: [HIGHLIGHT],
  resolved: [RESOLVED],
  visitNotes: [
    {
      visitId: 12,
      visitDate: "2026-10-15",
      status: "completed",
      pmEmail: "pm@avantifellows.org",
      pmName: "Ravi PM",
      concerns: [
        { id: 1, kind: "concern", text: "Lab equipment missing", status: "open" },
        { id: 4, kind: "concern", text: "Water cooler broken", status: "resolved" },
      ],
      highlights: [{ id: 3, kind: "highlight", text: "Students asking doubts", status: null }],
    },
    {
      visitId: 13,
      visitDate: "2026-10-20",
      status: "in_progress",
      pmEmail: "new.pm@avantifellows.org",
      pmName: null,
      concerns: [],
      highlights: [],
    },
  ],
};

const FLAGS = (
  <section aria-labelledby="flags-heading">
    <h2 id="flags-heading">Intervention flags</h2>
  </section>
);

// A page object over the rendered sections: each is a landmark region named by its heading.
function renderSections(props: Partial<Parameters<typeof SchoolConcernSections>[0]> = {}) {
  render(<SchoolConcernSections page={PAGE} today={TODAY} canAct flags={FLAGS} {...props} />);
  const section = (name: string) => screen.getByRole("region", { name });
  return {
    sectionNames: () => screen.getAllByRole("region").map((region) => region.getAttribute("aria-labelledby")),
    section,
    card: (sectionName: string, text: string) =>
      within(section(sectionName)).getByText(text).closest("article") as HTMLElement,
    highlight: (text: string) => within(section("Going well")).getByText(text).closest("li") as HTMLElement,
    visitRow: (date: string) =>
      within(section("Visit-wise notes")).getByText(date).closest("details") as HTMLDetailsElement,
  };
}

describe("SchoolConcernSections", () => {
  it("orders the sections Needs attention, Going well, the flags, Resolved concerns, Visit-wise notes", () => {
    const view = renderSections();

    expect(view.sectionNames()).toEqual([
      "needs-attention-heading",
      "going-well-heading",
      "flags-heading",
      "resolved-heading",
      "visit-notes-heading",
    ]);
  });

  it("marks a concern raised in 2+ visits as Recurring, with its compact visit dates", () => {
    const view = renderSections();

    const recurring = view.card("Needs attention", "Lab equipment missing");
    expect(within(recurring).getByText("Recurring · 3 visits")).toBeInTheDocument();
    expect(recurring).toHaveTextContent("15 Oct · 06 Aug ×2");

    // A one-off concern shows only its date, which carries its year when it's another year's.
    const oneOff = view.card("Needs attention", "Timetable not displayed");
    expect(oneOff).not.toHaveTextContent("Recurring");
    expect(oneOff).not.toHaveTextContent("visit");
    expect(within(oneOff).getByText("01 Dec 2025")).toBeInTheDocument();
  });

  it("marks a reopened concern and lists its history, including an automatic reopen", () => {
    const view = renderSections();

    const recurring = view.card("Needs attention", "Lab equipment missing");
    expect(within(recurring).getByText("reopened")).toBeInTheDocument();
    expect(recurring).toHaveTextContent("History (2)");
    const history = within(recurring).getAllByRole("listitem", { hidden: true });
    expect(history[0]).toHaveTextContent("Resolved · Ravi PM · 10 Aug 2026");
    expect(history[0]).toHaveTextContent("Kits ordered");
    // The date shows; the full IST time is on hover.
    expect(within(history[0]).getByText("10 Aug 2026")).toHaveAttribute("title", "10 Aug 2026, 10:00");
    expect(history[1]).toHaveTextContent("Reopened automatically: raised again in visit of 15 Oct 2026 · 16 Oct 2026");

    const oneOff = view.card("Needs attention", "Timetable not displayed");
    expect(within(oneOff).queryByText("reopened")).not.toBeInTheDocument();
    expect(oneOff).not.toHaveTextContent("History");
  });

  it("counts open concerns and lists highlights as text and dates, without Recurring or controls", () => {
    const view = renderSections();

    expect(view.section("Needs attention")).toHaveTextContent(/^Needs attention2 open/);
    const highlight = view.highlight("Students asking doubts");
    expect(highlight).toHaveTextContent(/^Students asking doubts15 Oct · 06 Aug$/);
    expect(within(view.section("Going well")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows Resolved concerns open, naming who resolved each and when (email when no name)", () => {
    const view = renderSections();

    expect(view.section("Resolved concerns")).toHaveTextContent(/^Resolved concerns1/);
    const resolved = view.card("Resolved concerns", "Water cooler broken");
    expect(resolved).toBeVisible();
    expect(resolved).toHaveTextContent("Resolved by admin@avantifellows.org · 01 Oct 2026");
    expect(within(resolved).getByRole("listitem")).toHaveTextContent("Resolved · admin@avantifellows.org · 01 Oct 2026Plumber fixed it");
  });

  it("offers Resolve on open concerns and Comment / Reopen on resolved ones when the viewer can act", () => {
    const view = renderSections({ canAct: true });

    const open = view.card("Needs attention", "Lab equipment missing");
    expect(within(open).getAllByRole("button").map((b) => b.textContent)).toEqual(["Resolve"]);
    const resolved = view.card("Resolved concerns", "Water cooler broken");
    expect(within(resolved).getAllByRole("button").map((b) => b.textContent)).toEqual(["Comment", "Reopen"]);
  });

  it("hides every control when the viewer can't act, still showing concerns and history", () => {
    const view = renderSections({ canAct: false });

    expect(screen.queryAllByRole("button", { hidden: true })).toEqual([]);
    expect(view.card("Needs attention", "Lab equipment missing")).toHaveTextContent("History (2)");
    expect(view.card("Resolved concerns", "Water cooler broken")).toHaveTextContent("Plumber fixed it");
  });

  it("lists each Visit as a collapsed row: date, PM, concern and highlight counts, and In progress", () => {
    const view = renderSections();

    const completed = view.visitRow("15 Oct 2026");
    expect(completed.open).toBe(false);
    expect(completed.querySelector("summary")).toHaveTextContent("▸15 Oct 2026Ravi PM· 2 concerns · 1 highlight");
    expect(completed.querySelector("summary")).not.toHaveTextContent("In progress");

    const inProgress = view.visitRow("20 Oct 2026");
    expect(inProgress.querySelector("summary")).toHaveTextContent(
      "▸20 Oct 2026new.pm@avantifellows.org· 0 concerns · 0 highlightsIn progress"
    );
  });

  it("links each Visit-wise note to its Visit with Back to this School page", () => {
    const view = renderSections({ visitBackHref: "/school-visit-summary/schools/SC001?preset=30d&sort=visits" });

    const links = within(view.section("Visit-wise notes")).getAllByRole("link", { hidden: true });
    expect(links.map((link) => link.textContent)).toEqual(["Open visit details →", "Open visit details →"]);
    const href = new URL(links[0].getAttribute("href")!, "http://localhost");
    expect(href.pathname).toBe("/school-visit-summary/12");
    expect(href.searchParams.get("back")).toBe("/school-visit-summary/schools/SC001?preset=30d&sort=visits");
  });

  it("links a Visit-wise note without ?back= when no Back target is given", () => {
    const view = renderSections({ visitBackHref: undefined });

    const links = within(view.section("Visit-wise notes")).getAllByRole("link", { hidden: true });
    expect(links[0]).toHaveAttribute("href", "/school-visit-summary/12");
  });

  it("lists a Visit's concerns (marking resolved ones) and highlights inside its row", () => {
    const view = renderSections();

    const completed = view.visitRow("15 Oct 2026");
    expect(completed).toHaveTextContent("ConcernsLab equipment missingWater cooler broken (resolved)");
    expect(completed).toHaveTextContent("Going wellStudents asking doubts");

    expect(view.visitRow("20 Oct 2026")).toHaveTextContent("No concerns or highlights");
  });

  it("shows each section's empty state", () => {
    renderSections({ page: { needsAttention: [], goingWell: [], resolved: [], visitNotes: [] } });

    expect(screen.getByText("No open concerns in view")).toBeInTheDocument();
    expect(screen.getByText("No highlights in view")).toBeInTheDocument();
    expect(screen.getByText("No resolved concerns in view")).toBeInTheDocument();
    expect(screen.getByText("No visits in view")).toBeInTheDocument();
  });
});
