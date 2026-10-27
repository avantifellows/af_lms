import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: mockRefresh }) }));

import type { CentreCoverageRow } from "@/lib/curriculum-plan-assignments";
import type { CurriculumPlanSummary } from "@/lib/curriculum-plans";
import CentreCoverage from "./CentreCoverage";

function plan(id: number, title: string, grade: number, displayStatus: CurriculumPlanSummary["displayStatus"]): CurriculumPlanSummary {
  return {
    id,
    title,
    academicYear: "2026-2027",
    grade,
    examTracks: ["jee_main"],
    status: displayStatus === "draft" ? "draft" : "active",
    displayStatus,
    closureDate: "2027-03-08",
    assignmentCount: 0,
  };
}

const PLANS = [plan(7, "G11 Others", 11, "active"), plan(8, "G11 HYD", 11, "draft"), plan(9, "G12", 12, "closed")];

const CENTRES: CentreCoverageRow[] = [
  {
    centreId: 1,
    centreName: "Anand Nodal",
    schoolName: "JNV Anand",
    region: "NORTH",
    programName: "JNV Nodal",
    grades: {
      11: {
        mappedTracks: ["jee_main", "cet"],
        plan: { id: 7, title: "G11 Others", displayStatus: "active" },
        uncoveredTracks: ["cet"],
      },
      12: { mappedTracks: ["jee_main"], plan: null, uncoveredTracks: [] },
    },
  },
  {
    centreId: 2,
    centreName: "Bhuj CoE",
    schoolName: "JNV Bhuj",
    region: "",
    programName: null,
    grades: { 11: null, 12: { mappedTracks: ["neet"], plan: { id: 9, title: "G12", displayStatus: "closed" }, uncoveredTracks: [] } },
  },
];

function respond(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const row = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

function renderCoverage(readOnly = false) {
  return render(<CentreCoverage academicYear="2026-2027" centres={CENTRES} plans={PLANS} readOnly={readOnly} />);
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CentreCoverage", () => {
  it("shows each Centre's plan per Grade, No plan, Not applicable and uncovered tracks", () => {
    renderCoverage();

    const anand = row("Anand Nodal");
    expect(anand).toHaveTextContent("JNV Anand · JNV Nodal");
    expect(within(anand).getByText("G11 Others")).toBeInTheDocument();
    expect(anand).toHaveTextContent("⚠ not covered: CET");
    expect(anand.querySelector('[data-coverage-grade="12"]')).toHaveTextContent("No plan");
    const bhuj = row("Bhuj CoE");
    expect(bhuj).toHaveTextContent("No region");
    expect(bhuj.querySelector('[data-coverage-grade="11"]')).toHaveTextContent("Not applicable");
    expect(bhuj.querySelector('[data-coverage-grade="12"]')).toHaveTextContent("G12Closed");
  });

  it("offers each Grade the Centre runs that Grade's plans, and sends only changed Grades", async () => {
    const fetchMock = respond({ ok: true });
    renderCoverage();

    fireEvent.click(within(row("Anand Nodal")).getByRole("button", { name: "Change plans" }));
    const grade11 = screen.getByLabelText("Grade 11 plan");
    expect(grade11).toHaveValue("7");
    expect(within(grade11).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "No plan",
      "G11 Others (Active)",
      "G11 HYD (Draft)",
    ]);
    expect(screen.getByLabelText("Grade 12 plan")).toHaveValue("");
    fireEvent.change(grade11, { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Plans saved for Anand Nodal.");
    expect(fetchMock).toHaveBeenCalledWith("/api/curriculum/plans/centres/1/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ academic_year: "2026-2027", assignments: [{ grade: 11, plan_id: 8 }] }),
    });
    expect(mockRefresh).toHaveBeenCalled();
    expect(screen.queryByLabelText("Grade 11 plan")).not.toBeInTheDocument();
  });

  it("removes a Grade's plan when No plan is chosen", async () => {
    const fetchMock = respond({ ok: true });
    renderCoverage();

    fireEvent.click(within(row("Bhuj CoE")).getByRole("button", { name: "Change plans" }));
    expect(screen.queryByLabelText("Grade 11 plan")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Grade 12 plan"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByRole("status");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      academic_year: "2026-2027",
      assignments: [{ grade: 12, plan_id: null }],
    });
  });

  it("closes without saving when nothing changed, and Cancel discards the edit", () => {
    const fetchMock = respond({ ok: true });
    renderCoverage();

    fireEvent.click(within(row("Anand Nodal")).getByRole("button", { name: "Change plans" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByLabelText("Grade 11 plan")).not.toBeInTheDocument();

    fireEvent.click(within(row("Anand Nodal")).getByRole("button", { name: "Change plans" }));
    fireEvent.change(screen.getByLabelText("Grade 11 plan"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(row("Anand Nodal")).getByText("G11 Others")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [() => respond({ errors: [{ message: "Curriculum Plan 8 is not a Grade 11 plan for 2026-2027" }] }, false), "Curriculum Plan 8 is not a Grade 11 plan for 2026-2027"],
    [() => respond({ error: "The Centre was assigned to another plan at the same time" }, false), "The Centre was assigned to another plan at the same time"],
    [() => respond({}, false), "Could not save the plans"],
    [() => vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))), "Could not save the plans"],
  ])("shows the save error and keeps editing", async (stub, message) => {
    stub();
    renderCoverage();

    fireEvent.click(within(row("Anand Nodal")).getByRole("button", { name: "Change plans" }));
    fireEvent.change(screen.getByLabelText("Grade 11 plan"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByTestId("coverage-error")).toHaveTextContent(message);
    expect(screen.getByLabelText("Grade 11 plan")).toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("disables Change plans for a read-only Admin", () => {
    renderCoverage(true);

    for (const button of screen.getAllByRole("button", { name: "Change plans" })) {
      expect(button).toBeDisabled();
    }
  });

  it("explains when no Centre is eligible", () => {
    render(<CentreCoverage academicYear="2027-2028" centres={[]} plans={[]} readOnly={false} />);

    expect(screen.getByText(/No eligible Centres for 2027-2028/)).toBeInTheDocument();
  });
});
