import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

import type { ConcernCard, ConcernMention, SchoolConcernPage } from "@/lib/visit-concerns";
import { SchoolConcernSections } from "./SchoolConcernSections";

// 11:30 on 28 Oct 2026 in IST.
const TODAY = new Date("2026-10-28T06:00:00.000Z");

const NEEDS_ATTENTION = "All concerns - Need Attention";

const mentionOn = (visitId: number, visitDate: string, snippet: string, pmName: string | null = "Ravi PM"): ConcernMention => ({
  visitId, visitDate, pmEmail: "pm@avantifellows.org", pmName, snippet,
});

const RECURRING: ConcernCard = {
  id: 1,
  kind: "concern",
  text: "Lab equipment missing",
  status: "open",
  visitCount: 3,
  visitDates: ["2026-10-15", "2026-08-06", "2026-08-06"],
  mentions: [
    mentionOn(12, "2026-10-15", "Lab still has no burettes"),
    mentionOn(11, "2026-08-06", "Burettes <b>missing</b> <img src=x onerror=alert(1)>", null),
    mentionOn(10, "2026-08-06", "Chemistry lab short of equipment"),
  ],
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
  mentions: [mentionOn(9, "2025-12-01", "Timetable not on the notice board")],
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
  mentions: [mentionOn(12, "2026-10-15", "Many doubts asked in class"), mentionOn(10, "2026-08-06", "Doubt sessions busy")],
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
  mentions: [mentionOn(12, "2026-10-15", "Cooler leaking"), mentionOn(10, "2026-08-06", "Cooler not cooling")],
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
  freshness: { summarisedUpTo: new Date("2026-10-20T08:30:00.000Z"), waitingVisits: 0 },
  visitNotes: [
    {
      visitId: 12,
      visitDate: "2026-10-15",
      status: "completed",
      summarised: true,
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
      summarised: false,
      pmEmail: "new.pm@avantifellows.org",
      pmName: null,
      concerns: [],
      highlights: [],
    },
  ],
};

const EMPTY_PAGE: SchoolConcernPage = { ...PAGE, needsAttention: [], goingWell: [], resolved: [] };

// A completed Visit the summary run hasn't reached yet.
const UNSUMMARISED_VISIT: SchoolConcernPage["visitNotes"][number] = {
  visitId: 14,
  visitDate: "2026-10-25",
  status: "completed",
  summarised: false,
  pmEmail: "pm@avantifellows.org",
  pmName: "Ravi PM",
  concerns: [],
  highlights: [],
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
    // The card's toggle: the button that owns its expanded area.
    toggle: (container: HTMLElement) =>
      within(container).getAllByRole("button").find((button) => button.hasAttribute("aria-expanded")) as HTMLElement,
    mentionLines: (container: HTMLElement) =>
      within(container).queryByRole("list", { name: "What PMs said" })
        ? within(within(container).getByRole("list", { name: "What PMs said" })).getAllByRole("listitem")
        : [],
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

    const recurring = view.card(NEEDS_ATTENTION, "Lab equipment missing");
    expect(within(recurring).getByText("Recurring · 3 visits")).toBeInTheDocument();
    expect(recurring).toHaveTextContent("15 Oct · 06 Aug ×2");

    // A one-off concern shows only its date, which carries its year when it's another year's.
    const oneOff = view.card(NEEDS_ATTENTION, "Timetable not displayed");
    expect(oneOff).not.toHaveTextContent("Recurring");
    expect(oneOff).not.toHaveTextContent("visit");
    expect(within(oneOff).getByText("01 Dec 2025")).toBeInTheDocument();
  });

  it("marks a reopened concern and lists its history, including an automatic reopen", () => {
    const view = renderSections();

    const recurring = view.card(NEEDS_ATTENTION, "Lab equipment missing");
    expect(within(recurring).getByText("reopened")).toBeInTheDocument();
    expect(recurring).toHaveTextContent("History (2)");
    const history = within(within(recurring).getByRole("list", { name: "History", hidden: true })).getAllByRole("listitem", { hidden: true });
    expect(history[0]).toHaveTextContent("Resolved · Ravi PM · 10 Aug 2026");
    expect(history[0]).toHaveTextContent("Kits ordered");
    // The date shows; the full IST time is on hover.
    expect(within(history[0]).getByText("10 Aug 2026")).toHaveAttribute("title", "10 Aug 2026, 10:00");
    expect(history[1]).toHaveTextContent("Reopened automatically: raised again in visit of 15 Oct 2026 · 16 Oct 2026");

    const oneOff = view.card(NEEDS_ATTENTION, "Timetable not displayed");
    expect(within(oneOff).queryByText("reopened")).not.toBeInTheDocument();
    expect(oneOff).not.toHaveTextContent("History");
  });

  it("heads the open concerns \"All concerns - Need Attention\" with the open count on the right", () => {
    const view = renderSections();

    const heading = screen.getByRole("heading", { level: 2, name: NEEDS_ATTENTION });
    expect(heading).toHaveAttribute("id", "needs-attention-heading");
    expect(heading.nextElementSibling).toHaveTextContent(/^2 open$/);
    expect(view.section(NEEDS_ATTENTION)).toHaveTextContent(/^All concerns - Need Attention2 open/);
    expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  });

  it("lists highlights as text and dates, without Recurring or actions", () => {
    const view = renderSections();

    const highlight = view.highlight("Students asking doubts");
    expect(highlight).toHaveTextContent(/^▸Students asking doubts15 Oct · 06 Aug$/);
    expect(within(view.section("Going well")).getAllByRole("button").map((button) => button.getAttribute("aria-expanded")))
      .toEqual(["false"]);
  });

  it("expands an open concern to what the PMs said, newest first, each line linking to its Visit, and collapses it", async () => {
    const view = renderSections({ visitBackHref: "/school-visit-summary/schools/SC001?preset=30d&sort=visits" });
    const card = view.card(NEEDS_ATTENTION, "Lab equipment missing");
    const toggle = view.toggle(card);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("Lab equipment missing");
    expect(view.mentionLines(card)).toEqual([]);
    expect(card).not.toHaveTextContent("What PMs said");

    await userEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(panel).toBeVisible();
    expect(panel).toHaveTextContent("What PMs said");
    const lines = view.mentionLines(card);
    expect(lines.map((line) => line.textContent)).toEqual([
      "15 Oct 2026 · Ravi PMLab still has no burettes",
      // No name: the PM's email. The snippet is text, never HTML.
      "06 Aug 2026 · pm@avantifellows.orgBurettes <b>missing</b> <img src=x onerror=alert(1)>",
      "06 Aug 2026 · Ravi PMChemistry lab short of equipment",
    ]);
    expect(card.querySelector("b, img")).toBeNull();
    const links = lines.map((line) => within(line).getByRole("link"));
    expect(links.map((link) => new URL(link.getAttribute("href")!, "http://localhost").pathname)).toEqual([
      "/school-visit-summary/12",
      "/school-visit-summary/11",
      "/school-visit-summary/10",
    ]);
    expect(new URL(links[0].getAttribute("href")!, "http://localhost").searchParams.get("back"))
      .toBe("/school-visit-summary/schools/SC001?preset=30d&sort=visits");

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(view.mentionLines(card)).toEqual([]);
  });

  it("Resolve expands the card, so the mentions sit above the note, and never collapses it", async () => {
    const view = renderSections();
    const card = view.card(NEEDS_ATTENTION, "Timetable not displayed");

    await userEvent.click(within(card).getByRole("button", { name: "Resolve" }));

    expect(view.toggle(card)).toHaveAttribute("aria-expanded", "true");
    const [line] = view.mentionLines(card);
    expect(line).toHaveTextContent("01 Dec 2025 · Ravi PMTimetable not on the notice board");
    const note = within(card).getByRole("textbox", { name: "How was this resolved?" });
    expect(line.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Cancel and Resolve again: the card stays expanded.
    await userEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await userEvent.click(within(card).getByRole("button", { name: "Resolve" }));
    expect(view.toggle(card)).toHaveAttribute("aria-expanded", "true");
  });

  it("expands a resolved concern on click and on Reopen, mentions above the history and the note", async () => {
    const view = renderSections();
    const card = view.card("Resolved concerns", "Water cooler broken");

    await userEvent.click(within(card).getByRole("button", { name: "Reopen" }));

    expect(view.toggle(card)).toHaveAttribute("aria-expanded", "true");
    expect(view.mentionLines(card).map((line) => line.textContent)).toEqual([
      "15 Oct 2026 · Ravi PMCooler leaking",
      "06 Aug 2026 · Ravi PMCooler not cooling",
    ]);
    const history = within(card).getByRole("list", { name: "History" });
    const note = within(card).getByRole("textbox", { name: "Why is this being reopened?" });
    const [first] = view.mentionLines(card);
    expect(first.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(history.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(view.toggle(card));
    expect(view.mentionLines(card)).toEqual([]);
  });

  it("expands a highlight to what the PMs said", async () => {
    const view = renderSections();
    const highlight = view.highlight("Students asking doubts");

    await userEvent.click(view.toggle(highlight));

    expect(view.mentionLines(highlight).map((line) => line.textContent)).toEqual([
      "15 Oct 2026 · Ravi PMMany doubts asked in class",
      "06 Aug 2026 · Ravi PMDoubt sessions busy",
    ]);
  });

  it("expands cards for a viewer who can't act, too", async () => {
    const view = renderSections({ canAct: false });
    const card = view.card(NEEDS_ATTENTION, "Lab equipment missing");

    await userEvent.click(view.toggle(card));

    expect(view.mentionLines(card)).toHaveLength(3);
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

    const actionNames = (card: HTMLElement) =>
      within(card).getAllByRole("button").filter((b) => !b.hasAttribute("aria-expanded")).map((b) => b.textContent);
    expect(actionNames(view.card(NEEDS_ATTENTION, "Lab equipment missing"))).toEqual(["Resolve"]);
    expect(actionNames(view.card("Resolved concerns", "Water cooler broken"))).toEqual(["Comment", "Reopen"]);
  });

  it("hides every control when the viewer can't act, still showing concerns and history", () => {
    const view = renderSections({ canAct: false });

    // Only the cards' expand toggles remain.
    const buttons = screen.queryAllByRole("button", { hidden: true });
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((button) => button.hasAttribute("aria-expanded"))).toBe(true);
    expect(view.card(NEEDS_ATTENTION, "Lab equipment missing")).toHaveTextContent("History (2)");
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

  it("says up to when Visit notes were summarised and how many Visits in view are waiting, like the School-wise tab", () => {
    renderSections({ page: { ...PAGE, freshness: { ...PAGE.freshness, waitingVisits: 2 } } });

    expect(screen.getByText("Visit notes summarised up to 20 Oct 2026, 14:00 · 2 visits waiting")).toBeInTheDocument();
  });

  it("says Visit notes haven't been summarised yet when there is no summary run", () => {
    renderSections({ page: { ...PAGE, freshness: { summarisedUpTo: null, waitingVisits: 0 } } });

    expect(screen.getByText("Visit notes haven't been summarised yet")).toBeInTheDocument();
  });

  it("says how many Visits aren't summarised yet beside the concerns, and marks those Visit-wise notes", () => {
    const view = renderSections({
      page: {
        ...PAGE,
        freshness: { ...PAGE.freshness, waitingVisits: 1 },
        visitNotes: [UNSUMMARISED_VISIT, ...PAGE.visitNotes],
      },
    });

    expect(view.section(NEEDS_ATTENTION)).toHaveTextContent("1 visit not summarised yet");
    expect(view.visitRow("25 Oct 2026").querySelector("summary")).toHaveTextContent("Not summarised yet");
    // A summarised Visit and an in-progress one aren't marked.
    expect(view.visitRow("15 Oct 2026").querySelector("summary")).not.toHaveTextContent("Not summarised yet");
    expect(view.visitRow("20 Oct 2026").querySelector("summary")).not.toHaveTextContent("Not summarised yet");
  });

  it("says Not summarised yet, not that nothing is in view, when no completed Visit in view is summarised", () => {
    const view = renderSections({
      page: { ...EMPTY_PAGE, freshness: { ...PAGE.freshness, waitingVisits: 1 }, visitNotes: [UNSUMMARISED_VISIT] },
    });

    expect(within(view.section(NEEDS_ATTENTION)).getByText("Not summarised yet")).toBeInTheDocument();
    expect(within(view.section("Going well")).getByText("Not summarised yet")).toBeInTheDocument();
    expect(screen.queryByText("No open concerns in view")).not.toBeInTheDocument();
    expect(screen.queryByText("No highlights in view")).not.toBeInTheDocument();
  });

  it("shows no waiting note when every completed Visit is summarised", () => {
    const view = renderSections();

    expect(view.section(NEEDS_ATTENTION)).not.toHaveTextContent("not summarised yet");
  });

  it("shows each section's empty state", () => {
    renderSections({ page: { ...EMPTY_PAGE, visitNotes: [] } });

    expect(screen.getByText("No open concerns in view")).toBeInTheDocument();
    expect(screen.getByText("No highlights in view")).toBeInTheDocument();
    expect(screen.getByText("No resolved concerns in view")).toBeInTheDocument();
    expect(screen.getByText("No visits in view")).toBeInTheDocument();
  });
});
