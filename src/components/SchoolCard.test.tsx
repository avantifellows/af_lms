import { render, screen } from "@testing-library/react";
import SchoolCard, { School } from "./SchoolCard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const baseSchool: School = {
  id: "1",
  code: "SCH001",
  name: "Test School",
  district: "Test District",
  state: "Test State",
};

describe("SchoolCard", () => {
  it("renders school name, district, state, and code", () => {
    render(<SchoolCard school={baseSchool} href="/school/123" />);
    expect(screen.getByText("Test School")).toBeInTheDocument();
    expect(screen.getByText("Test District, Test State")).toBeInTheDocument();
    expect(screen.getByText(/Code: SCH001/)).toBeInTheDocument();
  });

  it("links to the correct href", () => {
    render(<SchoolCard school={baseSchool} href="/school/123" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/school/123");
  });

  it("shows student count when showStudentCount=true and count exists", () => {
    const school: School = { ...baseSchool, student_count: 42 };
    render(
      <SchoolCard school={school} href="/school/123" showStudentCount />
    );
    const studentTexts = screen.getAllByText("42 students");
    expect(studentTexts.length).toBeGreaterThanOrEqual(1);
  });

  it("does not show student count when showStudentCount=false", () => {
    const school: School = { ...baseSchool, student_count: 42 };
    render(<SchoolCard school={school} href="/school/123" />);
    expect(screen.queryByText("42 students")).not.toBeInTheDocument();
  });

  it("shows grade breakdown when showGradeBreakdown=true", () => {
    const school: School = {
      ...baseSchool,
      grade_counts: [
        { grade: 9, count: 20 },
        { grade: 10, count: 15 },
      ],
    };
    render(
      <SchoolCard
        school={school}
        href="/school/123"
        showGradeBreakdown
      />
    );
    expect(screen.getByText("G9: 20")).toBeInTheDocument();
    expect(screen.getByText("G10: 15")).toBeInTheDocument();
  });

  it("does not show grade breakdown when showGradeBreakdown=false", () => {
    const school: School = {
      ...baseSchool,
      grade_counts: [{ grade: 9, count: 20 }],
    };
    render(<SchoolCard school={school} href="/school/123" />);
    expect(screen.queryByText("G9: 20")).not.toBeInTheDocument();
  });

  it("shows region when showRegion=true and region exists", () => {
    const school: School = { ...baseSchool, region: "North" };
    render(
      <SchoolCard school={school} href="/school/123" showRegion />
    );
    expect(screen.getByText(/Region: North/)).toBeInTheDocument();
  });

  it("does not show region when showRegion=false", () => {
    const school: School = { ...baseSchool, region: "North" };
    render(<SchoolCard school={school} href="/school/123" />);
    expect(screen.queryByText(/Region: North/)).not.toBeInTheDocument();
  });

  it("does not show region when region is null", () => {
    const school: School = { ...baseSchool, region: null };
    render(
      <SchoolCard school={school} href="/school/123" showRegion />
    );
    expect(screen.queryByText(/Region:/)).not.toBeInTheDocument();
  });

  it("renders actions when provided", () => {
    render(
      <SchoolCard
        school={baseSchool}
        href="/school/123"
        actions={<button>Edit</button>}
      />
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("does not render actions container when actions not provided", () => {
    const { container } = render(
      <SchoolCard school={baseSchool} href="/school/123" />
    );
    // No actions div with mt-4 class
    expect(container.querySelector(".mt-4.flex.gap-2")).not.toBeInTheDocument();
  });
});
