import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import EnrollmentStatsCards, {
  type ProgramStats,
} from "./EnrollmentStatsCards";

const coeStats: ProgramStats = {
  id: 1,
  label: "JNV CoE",
  total: 115,
  byGrade: [
    { grade: 11, count: 40 },
    { grade: 12, count: 75 },
  ],
  byGender: [
    { value: "Male", count: 84 },
    { value: "Female", count: 31 },
  ],
  byCategory: [
    { value: "OBC", count: 38 },
    { value: "SC", count: 31 },
    { value: "ST", count: 21 },
  ],
};

const nvsStats: ProgramStats = {
  id: 64,
  label: "JNV NVS",
  total: 3,
  byGrade: [{ grade: 11, count: 3 }],
  byGender: [{ value: "Female", count: 3 }],
  byCategory: [{ value: "ST", count: 3 }],
};

describe("EnrollmentStatsCards", () => {
  it("renders nothing when there are no programs", () => {
    const { container } = render(<EnrollmentStatsCards programs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the single program's pills without tabs", () => {
    render(<EnrollmentStatsCards programs={[nvsStats]} />);
    // No tab buttons (only one program)
    expect(screen.queryByRole("button", { name: "JNV NVS" })).not.toBeInTheDocument();
    // Card heading with total inline
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("3");
    // Row labels
    expect(screen.getByText("Grade")).toBeInTheDocument();
    expect(screen.getByText("Gender")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    // Pill content
    expect(screen.getByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("Female")).toBeInTheDocument();
    expect(screen.getByText("ST")).toBeInTheDocument();
  });

  it("renders tabs when multiple programs are passed and defaults to the first", () => {
    render(<EnrollmentStatsCards programs={[coeStats, nvsStats]} />);
    expect(screen.getByRole("button", { name: "JNV CoE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JNV NVS" })).toBeInTheDocument();
    // Default selection: CoE (the first one)
    expect(screen.getByText("JNV CoE Students")).toBeInTheDocument();
    expect(screen.queryByText("JNV NVS Students")).not.toBeInTheDocument();
    // CoE breakdowns visible
    expect(screen.getByText("OBC")).toBeInTheDocument();
    expect(screen.getByText("Male")).toBeInTheDocument();
  });

  it("switches the visible breakdown when a different program tab is clicked", () => {
    render(<EnrollmentStatsCards programs={[coeStats, nvsStats]} />);
    fireEvent.click(screen.getByRole("button", { name: "JNV NVS" }));
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.queryByText("JNV CoE Students")).not.toBeInTheDocument();
    // Total updates
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("3");
  });

  it("shows 'No data' for an empty breakdown row", () => {
    const sparse: ProgramStats = {
      id: 2,
      label: "JNV Nodal",
      total: 0,
      byGrade: [],
      byGender: [],
      byCategory: [],
    };
    render(<EnrollmentStatsCards programs={[sparse]} />);
    const noData = screen.getAllByText("No data");
    expect(noData).toHaveLength(3); // grade, gender, category
  });

  it("renders pill counts next to their labels", () => {
    render(<EnrollmentStatsCards programs={[coeStats]} />);
    // The "Grade 11" pill should sit next to its count of 40.
    // The outer pill is the parent of the label span, two levels up.
    const labelSpan = screen.getByText("Grade 11");
    const pill = labelSpan.parentElement;
    expect(pill).not.toBeNull();
    expect(within(pill as HTMLElement).getByText("40")).toBeInTheDocument();
  });
});
