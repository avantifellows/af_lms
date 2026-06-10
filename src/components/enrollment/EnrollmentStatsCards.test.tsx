import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import EnrollmentStatsCards from "./EnrollmentStatsCards";
import type { ProgramStats } from "@/lib/enrollment-stats";
import type { AdmissionSummary } from "@/lib/enrollment-readiness";

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

function Harness({
  programs,
  admission,
  consentLoading,
  consentError,
}: {
  programs: ProgramStats[];
  admission?: AdmissionSummary | null;
  consentLoading?: boolean;
  consentError?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number>(programs[0]?.id ?? 0);
  return (
    <EnrollmentStatsCards
      programs={programs}
      selectedId={selectedId}
      onSelect={setSelectedId}
      admission={admission}
      consentLoading={consentLoading}
      consentError={consentError}
    />
  );
}

const admissionSummary: AdmissionSummary = {
  total: 40,
  reported: 8,
  infoAvailable: 30,
  infoAvailablePct: 75,
  docsAvailablePct: 60,
};

describe("EnrollmentStatsCards", () => {
  it("renders nothing when there are no programs", () => {
    const { container } = render(<Harness programs={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the single program's pills without tabs", () => {
    render(<Harness programs={[nvsStats]} />);
    expect(screen.queryByRole("button", { name: "JNV NVS" })).not.toBeInTheDocument();
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.getByTestId("enrollment-stats-total")).toHaveTextContent("3");
    expect(screen.getByText("Grade")).toBeInTheDocument();
    expect(screen.getByText("Gender")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("Female")).toBeInTheDocument();
    expect(screen.getByText("ST")).toBeInTheDocument();
  });

  it("renders tabs when multiple programs are passed and defaults to the first", () => {
    render(<Harness programs={[coeStats, nvsStats]} />);
    expect(screen.getByRole("button", { name: "JNV CoE" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "JNV NVS" })).toBeInTheDocument();
    expect(screen.getByText("JNV CoE Students")).toBeInTheDocument();
    expect(screen.queryByText("JNV NVS Students")).not.toBeInTheDocument();
    expect(screen.getByText("OBC")).toBeInTheDocument();
    expect(screen.getByText("Male")).toBeInTheDocument();
  });

  it("switches the visible breakdown when a different program tab is clicked", () => {
    render(<Harness programs={[coeStats, nvsStats]} />);
    fireEvent.click(screen.getByRole("button", { name: "JNV NVS" }));
    expect(screen.getByText("JNV NVS Students")).toBeInTheDocument();
    expect(screen.queryByText("JNV CoE Students")).not.toBeInTheDocument();
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
    render(<Harness programs={[sparse]} />);
    const noData = screen.getAllByText("No data");
    expect(noData).toHaveLength(3);
  });

  it("renders pill counts next to their labels", () => {
    render(<Harness programs={[coeStats]} />);
    const labelSpan = screen.getByText("Grade 11");
    const pill = labelSpan.parentElement;
    expect(pill).not.toBeNull();
    expect(within(pill as HTMLElement).getByText("40")).toBeInTheDocument();
  });

  it("does not render the admission row without admission data", () => {
    render(<Harness programs={[coeStats]} />);
    expect(screen.queryByTestId("admission-stats-row")).not.toBeInTheDocument();
  });

  it("renders the compact admission row scoped to the filter", () => {
    render(<Harness programs={[coeStats]} admission={admissionSummary} />);
    const row = screen.getByTestId("admission-stats-row");
    expect(within(row).getByText("Admission")).toBeInTheDocument();
    expect(within(row).getByText("8/40")).toBeInTheDocument(); // reported/total
    expect(within(row).getByText("75%")).toBeInTheDocument(); // info
    expect(within(row).getByText("60%")).toBeInTheDocument(); // docs
  });

  it("dashes consent-derived metrics while consent is loading", () => {
    render(
      <Harness programs={[coeStats]} admission={admissionSummary} consentLoading />,
    );
    const row = screen.getByTestId("admission-stats-row");
    // info is computed locally so it still shows; reported + docs are pending
    expect(within(row).getByText("75%")).toBeInTheDocument();
    expect(within(row).queryByText("8/40")).not.toBeInTheDocument();
    expect(within(row).getAllByText("…").length).toBe(2);
  });
});
