import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolTabs, { VisitHistorySection } from "./SchoolTabs";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("SchoolTabs", () => {
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

  it("applies active styling to the selected tab button", () => {
    render(<SchoolTabs tabs={tabs} defaultTab="visits" />);
    const visitsBtn = screen.getByText("Visits");
    expect(visitsBtn.className).toContain("border-blue-500");
    expect(visitsBtn.className).toContain("text-blue-600");

    const studentsBtn = screen.getByText("Students");
    expect(studentsBtn.className).toContain("border-transparent");
  });
});

describe("VisitHistorySection", () => {
  it("shows 'No visits recorded yet' and 'Start First Visit' link when empty", () => {
    render(<VisitHistorySection visits={[]} schoolCode="ABC123" />);
    expect(screen.getByText("No visits recorded yet")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Start First Visit" });
    expect(link).toHaveAttribute("href", "/school/ABC123/visit/new");
  });

  it("renders visit dates and status badges when visits provided", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: "2026-01-15T09:00:00Z",
        ended_at: "2026-01-15T15:00:00Z",
      },
      {
        id: 2,
        visit_date: "2026-01-20",
        status: "in_progress",
        inserted_at: "2026-01-20T10:00:00Z",
        ended_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);

    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("shows 'Ended' badge for non-completed visits with ended_at", () => {
    const visits = [
      {
        id: 3,
        visit_date: "2026-02-01",
        status: "in_progress",
        inserted_at: "2026-02-01T09:00:00Z",
        ended_at: "2026-02-01T14:00:00Z",
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="ABC123" />);
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("shows 'View' link for completed visits", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        ended_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    const link = screen.getByRole("link", { name: "View" });
    expect(link).toHaveAttribute("href", "/visits/1");
  });

  it("shows 'View' link for ended visits", () => {
    const visits = [
      {
        id: 2,
        visit_date: "2026-01-20",
        status: "active",
        inserted_at: null,
        ended_at: "2026-01-20T15:00:00Z",
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    expect(screen.getByRole("link", { name: "View" })).toBeInTheDocument();
  });

  it("shows 'Continue' link for in-progress visits without ended_at", () => {
    const visits = [
      {
        id: 3,
        visit_date: "2026-01-25",
        status: "in_progress",
        inserted_at: "2026-01-25T09:00:00Z",
        ended_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    const link = screen.getByRole("link", { name: "Continue" });
    expect(link).toHaveAttribute("href", "/visits/3");
  });

  it("shows 'Start New Visit' link when visits exist", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        ended_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="XYZ" />);
    const link = screen.getByRole("link", { name: "Start New Visit" });
    expect(link).toHaveAttribute("href", "/school/XYZ/visit/new");
  });

  it("renders Visit History heading when visits exist", () => {
    const visits = [
      {
        id: 1,
        visit_date: "2026-01-15",
        status: "completed",
        inserted_at: null,
        ended_at: null,
      },
    ];
    render(<VisitHistorySection visits={visits} schoolCode="SCH001" />);
    expect(screen.getByText("Visit History")).toBeInTheDocument();
  });
});
