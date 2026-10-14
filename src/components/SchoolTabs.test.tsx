import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolTabs, { VisitHistorySection } from "./SchoolTabs";

let mockSearchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("SchoolTabs", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    window.history.replaceState(null, "", "/school/123");
  });

  const tabs = [
    { id: "students", label: "Students", content: <div>Students Content</div> },
    { id: "visits", label: "Visits", content: <div>Visits Content</div> },
    { id: "info", label: "Info", content: <div>Info Content</div> },
  ];

  it("renders all tab labels", () => {
    render(<SchoolTabs tabs={tabs} />);
    expect(screen.getByText("Students")).toBeInTheDocument();
    expect(screen.getByText("Visits")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("shows first tab content by default when no defaultTab", () => {
    render(<SchoolTabs tabs={tabs} />);
    expect(screen.getByText("Students Content")).toBeInTheDocument();
    expect(screen.queryByText("Visits Content")).not.toBeInTheDocument();
  });

  it("shows defaultTab content when specified", () => {
    render(<SchoolTabs tabs={tabs} defaultTab="visits" />);
    expect(screen.getByText("Visits Content")).toBeInTheDocument();
    expect(screen.queryByText("Students Content")).not.toBeInTheDocument();
  });

  it("switches content when clicking a tab", async () => {
    const user = userEvent.setup();
    render(<SchoolTabs tabs={tabs} />);

    expect(screen.getByText("Students Content")).toBeInTheDocument();

    await user.click(screen.getByText("Visits"));

    expect(screen.getByText("Visits Content")).toBeInTheDocument();
    expect(screen.queryByText("Students Content")).not.toBeInTheDocument();
  });

  it("supports one-stop keyboard tabs linked to their panel", async () => {
    const user = userEvent.setup();
    render(<SchoolTabs tabs={tabs} />);

    const students = screen.getByRole("tab", { name: "Students" });
    const visits = screen.getByRole("tab", { name: "Visits" });
    students.focus();
    await user.keyboard("{ArrowRight}");

    expect(visits).toHaveFocus();
    expect(visits).toHaveAttribute("aria-selected", "true");
    expect(visits).toHaveAttribute("tabindex", "0");
    expect(students).toHaveAttribute("tabindex", "-1");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby", visits.id);
    expect(visits).toHaveAttribute("aria-controls", panel.id);
    expect(students).toHaveAttribute("aria-controls", panel.id);

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "Info" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(students).toHaveFocus();
  });

  it("seeds active tab from ?tab= query param when present and valid", () => {
    mockSearchParams = new URLSearchParams("tab=info");
    render(<SchoolTabs tabs={tabs} />);
    expect(screen.getByText("Info Content")).toBeInTheDocument();
    expect(screen.queryByText("Students Content")).not.toBeInTheDocument();
    mockSearchParams = new URLSearchParams();
  });

  it("falls back to defaultTab when ?tab= points to a non-existent tab", () => {
    mockSearchParams = new URLSearchParams("tab=ghost");
    render(<SchoolTabs tabs={tabs} defaultTab="visits" />);
    expect(screen.getByText("Visits Content")).toBeInTheDocument();
    mockSearchParams = new URLSearchParams();
  });

  it("replaces the current URL with ?tab= when switching tabs", async () => {
    const user = userEvent.setup();
    render(<SchoolTabs tabs={tabs} />);
    await user.click(screen.getByText("Visits"));
    expect(window.location.pathname + window.location.search).toBe("/school/123?tab=visits");
  });

  it("writes the selected tab to the live URL before mounting its content", async () => {
    window.history.replaceState(null, "", "/school/123?source=progress");
    mockSearchParams = new URLSearchParams("source=progress");
    const user = userEvent.setup();
    function UrlProbe() {
      return <div>Mounted at {window.location.search}</div>;
    }
    const tabsWithUrlProbe = [
      ...tabs,
      {
        id: "performance",
        label: "Performance",
        content: <UrlProbe />,
      },
    ];

    render(<SchoolTabs tabs={tabsWithUrlProbe} />);
    await user.click(screen.getByRole("tab", { name: "Performance" }));

    expect(screen.getByText("Mounted at ?source=progress&tab=performance")).toBeInTheDocument();
  });

  it("preserves the Holistic return marker when switching tabs", async () => {
    mockSearchParams = new URLSearchParams("program_id=94&source=progress");
    const user = userEvent.setup();
    render(<SchoolTabs tabs={tabs} />);

    await user.click(screen.getByText("Info"));

    expect(window.location.pathname + window.location.search).toBe(
      "/school/123?program_id=94&source=progress&tab=info"
    );
    mockSearchParams = new URLSearchParams();
  });

  describe("history navigation", () => {
    // Counts mounts, so a test can tell a section was mounted afresh.
    let performanceMounts = 0;
    function PerformanceProbe() {
      const [n] = useState(() => ++performanceMounts);
      return <div>Performance Content #{n}</div>;
    }
    const withPerformance = [
      ...tabs,
      { id: "performance", label: "Performance", content: <PerformanceProbe /> },
    ];

    afterEach(() => {
      mockSearchParams = new URLSearchParams();
      performanceMounts = 0;
    });

    function urlBecomes(rerender: (ui: React.ReactElement) => void, query: string) {
      mockSearchParams = new URLSearchParams(query);
      rerender(<SchoolTabs tabs={withPerformance} />);
    }

    it("shows the tab a Back/Forward URL names, remounting Performance when it returns", () => {
      mockSearchParams = new URLSearchParams("tab=performance&grade=12&session=sess-a");
      const { rerender } = render(<SchoolTabs tabs={withPerformance} />);
      expect(screen.getByText("Performance Content #1")).toBeInTheDocument();

      urlBecomes(rerender, "tab=visits&grade=12&session=sess-a");
      expect(screen.getByText("Visits Content")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Visits" })).toHaveAttribute("aria-selected", "true");

      urlBecomes(rerender, "tab=performance&grade=12&session=sess-a");
      expect(screen.getByText("Performance Content #2")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Performance" })).toHaveAttribute("aria-selected", "true");
    });

    it("falls back to the first tab when history lands on an absent or unknown tab", () => {
      mockSearchParams = new URLSearchParams("tab=info");
      const { rerender } = render(<SchoolTabs tabs={withPerformance} />);
      expect(screen.getByText("Info Content")).toBeInTheDocument();

      urlBecomes(rerender, "grade=12");
      expect(screen.getByText("Students Content")).toBeInTheDocument();

      urlBecomes(rerender, "tab=info");
      urlBecomes(rerender, "tab=ghost");
      expect(screen.getByText("Students Content")).toBeInTheDocument();
    });

    it("a past click doesn't outlive the URL: history back to that click's starting tab shows it", async () => {
      const user = userEvent.setup();
      const { rerender } = render(<SchoolTabs tabs={withPerformance} />);

      await user.click(screen.getByRole("tab", { name: "Performance" }));
      // The click's replace lands and the tab re-renders with it.
      urlBecomes(rerender, "tab=performance");
      expect(screen.getByText("Performance Content #1")).toBeInTheDocument();

      // Back to an entry without ?tab=, the URL the click started from.
      urlBecomes(rerender, "grade=12");
      expect(screen.getByText("Students Content")).toBeInTheDocument();
    });

    it("an unknown defaultTab falls back to the first tab", () => {
      render(<SchoolTabs tabs={withPerformance} defaultTab="ghost" />);
      expect(screen.getByText("Students Content")).toBeInTheDocument();
    });

    it("a tab click replaces, without scrolling, keeping Performance filters, session and Holistic params", async () => {
      mockSearchParams = new URLSearchParams(
        "program_id=94&source=progress&tab=performance&grade=12&stream=pcm&category=chapter&session=sess-a"
      );
      const user = userEvent.setup();
      render(<SchoolTabs tabs={withPerformance} />);

      await user.click(screen.getByRole("tab", { name: "Info" }));
      expect(window.location.pathname + window.location.search).toBe(
        "/school/123?program_id=94&source=progress&tab=info&grade=12&stream=pcm&category=chapter&session=sess-a"
      );
      expect(screen.getByText("Info Content")).toBeInTheDocument();
    });
  });

  it("applies active styling to the selected tab button", () => {
    render(<SchoolTabs tabs={tabs} defaultTab="visits" />);
    const visitsBtn = screen.getByText("Visits");
    expect(visitsBtn.className).toContain("border-accent");
    expect(visitsBtn.className).toContain("text-accent");
    expect(visitsBtn.className).toContain("uppercase");
    expect(visitsBtn.className).toContain("font-bold");

    const studentsBtn = screen.getByText("Students");
    expect(studentsBtn.className).toContain("border-transparent");
  });
});

describe("VisitHistorySection", () => {
  it("shows 'No visits recorded yet' and 'Start First Visit' link when empty and canEdit", () => {
    render(<VisitHistorySection visits={[]} schoolCode="ABC123" canEdit />);
    expect(screen.getByText("No visits recorded yet")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start First Visit" });
    expect(link).toHaveAttribute("href", "/school/ABC123/visit/new");
  });

  it("hides 'Start First Visit' link when empty and canEdit is false", () => {
    render(<VisitHistorySection visits={[]} schoolCode="ABC123" />);
    expect(screen.getByText("No visits recorded yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start First Visit" })).not.toBeInTheDocument();
  });

  it("renders visit dates and status badges when visits provided", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: "2026-01-15T09:00:00Z",
        completed_at: "2026-01-15T15:00:00Z",
      },
      {
        id: 2,
        visit_date: "2026-01-20",
        status: "in_progress",
        inserted_at: "2026-01-20T10:00:00Z",
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("shows the visitor's name when the API supplies one", () => {
    const visits = [
      {
        id: 7,
        visit_date: "2026-03-01",
        status: "completed",
        pm_email: "priya@avantifellows.org",
        pm_name: "Priya Sharma",
        inserted_at: "2026-03-01T09:00:00Z",
        completed_at: "2026-03-01T11:00:00Z",
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);

    expect(screen.getByText("Visited by")).toBeInTheDocument();
    const name = screen.getByText("Priya Sharma");
    expect(name).toBeInTheDocument();
    expect(name).toHaveAttribute("title", "priya@avantifellows.org");
    expect(screen.queryByText("priya@avantifellows.org")).not.toBeInTheDocument();
  });

  it("falls back to the visitor's email when no name is known", () => {
    const visits = [
      {
        id: 8,
        visit_date: "2026-03-02",
        status: "in_progress",
        pm_email: "newpm@avantifellows.org",
        pm_name: null,
        inserted_at: "2026-03-02T09:00:00Z",
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);

    expect(screen.getByText("Visited by")).toBeInTheDocument();
    const email = screen.getByText("newpm@avantifellows.org");
    expect(email).toBeInTheDocument();
    expect(email).not.toHaveAttribute("title");
  });

  it("omits the visitor line when neither name nor email is present", () => {
    const visits = [
      {
        id: 9,
        visit_date: "2026-03-03",
        status: "completed",
        inserted_at: "2026-03-03T09:00:00Z",
        completed_at: "2026-03-03T11:00:00Z",
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);

    expect(screen.queryByText("Visited by")).not.toBeInTheDocument();
  });

  it("does not render an 'Ended' status badge", () => {
    const visits = [
      {
        id: 3,
        visit_date: "2026-02-01",
        status: "in_progress",
        inserted_at: "2026-02-01T09:00:00Z",
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);
    expect(screen.queryByText("Ended")).not.toBeInTheDocument();
  });

  it("uses completed_at for completed timestamp rendering", () => {
    const visits = [
      {
        id: 4,
        visit_date: "2026-02-10",
        status: "completed",
        inserted_at: "2026-02-10T09:00:00Z",
        completed_at: "2026-02-10T10:30:00Z",
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);

    expect(screen.getByText(/^Started:/)).toBeInTheDocument();
    expect(screen.getByText(/^Completed:/)).toBeInTheDocument();
  });

  it("shows 'View' link for completed visits", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    const link = screen.getByRole("link", { name: "View" });
    expect(link).toHaveAttribute("href", "/visits/1");
  });

  it("shows 'Continue' link for in-progress visits", () => {
    const visits = [
      {
        id: 2,
        visit_date: "2026-01-20",
        status: "in_progress",
        inserted_at: null,
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    expect(screen.getByRole("link", { name: "Continue" })).toBeInTheDocument();
  });

  it("shows 'Continue' link for in-progress visits without completed_at", () => {
    const visits = [
      {
        id: 3,
        visit_date: "2026-01-25",
        status: "in_progress",
        inserted_at: "2026-01-25T09:00:00Z",
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    const link = screen.getByRole("link", { name: "Continue" });
    expect(link).toHaveAttribute("href", "/visits/3");
  });

  it("shows 'Start New Visit' link when visits exist and canEdit", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="XYZ" canEdit />);
    const link = screen.getByRole("link", { name: "Start New Visit" });
    expect(link).toHaveAttribute("href", "/school/XYZ/visit/new");
  });

  it("hides 'Start New Visit' link when canEdit is false", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="XYZ" />);
    expect(screen.queryByRole("link", { name: "Start New Visit" })).not.toBeInTheDocument();
  });

  it("renders Visit History heading when visits exist", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        completed_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    expect(screen.getByText("Visit History")).toBeInTheDocument();
  });
});
