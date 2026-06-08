import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AdmissionReadinessCard from "./AdmissionReadinessCard";
import type { AdmissionSummary } from "@/lib/enrollment-readiness";

function summary(over: Partial<AdmissionSummary> = {}): AdmissionSummary {
  return {
    total: 20,
    reported: 8,
    infoAvailable: 15,
    infoAvailablePct: 75,
    docsAvailablePct: 60,
    ...over,
  };
}

const combined = summary();
const perGrade = [
  { grade: 11, summary: summary({ total: 12, reported: 3, infoAvailablePct: 70, docsAvailablePct: 50 }) },
  { grade: 12, summary: summary({ total: 8, reported: 5, infoAvailablePct: 90, docsAvailablePct: 65 }) },
];

describe("AdmissionReadinessCard", () => {
  it("renders the heading, grade badge, and combined metrics", () => {
    render(<AdmissionReadinessCard combined={combined} perGrade={perGrade} />);
    expect(
      screen.getByRole("heading", { name: /Admission Tracking/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Grades 11 & 12")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument(); // combined reported
    expect(screen.getByText("75%")).toBeInTheDocument(); // combined info
    expect(screen.getByText("60%")).toBeInTheDocument(); // combined docs
  });

  it("renders a per-grade breakdown row for each admission grade", () => {
    render(<AdmissionReadinessCard combined={combined} perGrade={perGrade} />);
    expect(screen.getByText("Grade 11")).toBeInTheDocument();
    expect(screen.getByText("Grade 12")).toBeInTheDocument();
    expect(screen.getByText("12 students")).toBeInTheDocument();
    expect(screen.getByText("8 students")).toBeInTheDocument();
  });

  it("dashes consent-derived metrics while loading", () => {
    render(
      <AdmissionReadinessCard combined={combined} perGrade={perGrade} loading />,
    );
    expect(screen.getByText("Loading consent…")).toBeInTheDocument();
    // total + info still show; reported + docs dashed
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.queryByText("8")).not.toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
  });

  it("surfaces an error state", () => {
    render(
      <AdmissionReadinessCard combined={combined} perGrade={perGrade} error />,
    );
    expect(screen.getByText("Consent data unavailable")).toBeInTheDocument();
  });
});
