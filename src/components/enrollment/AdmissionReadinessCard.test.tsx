import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import AdmissionReadinessCard from "./AdmissionReadinessCard";
import type { AdmissionSummary } from "@/lib/enrollment-readiness";

const summary: AdmissionSummary = {
  total: 20,
  reported: 8,
  infoAvailable: 15,
  infoAvailablePct: 75,
  docsAvailablePct: 60,
};

describe("AdmissionReadinessCard", () => {
  it("renders the grade-11 heading and all four metrics", () => {
    render(<AdmissionReadinessCard summary={summary} />);
    expect(
      screen.getByRole("heading", { name: /Grade 11 Admission Tracking/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument(); // total
    expect(screen.getByText("8")).toBeInTheDocument(); // reported
    expect(screen.getByText("75%")).toBeInTheDocument(); // info
    expect(screen.getByText("60%")).toBeInTheDocument(); // docs
  });

  it("dashes out consent-derived metrics while loading", () => {
    render(<AdmissionReadinessCard summary={summary} loading />);
    expect(screen.getByText("Loading consent…")).toBeInTheDocument();
    // total + info still show; reported + docs are dashed
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.queryByText("8")).not.toBeInTheDocument();
    expect(screen.queryByText("60%")).not.toBeInTheDocument();
  });

  it("surfaces an error state", () => {
    render(<AdmissionReadinessCard summary={summary} error />);
    expect(screen.getByText("Consent data unavailable")).toBeInTheDocument();
  });
});
