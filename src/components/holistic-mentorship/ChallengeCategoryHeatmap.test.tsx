import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChallengeCategoryHeatmap from "./ChallengeCategoryHeatmap";

const ZERO = {
  "academic.subject_concept": 0,
  "academic.backlogs_workload": 0,
  "academic.exam_related": 0,
  "academic.test_preparation": 0,
  "academic.other": 0,
  "academic.no_major_issue": 0,
  "non_academic.time_management": 0,
  "non_academic.confidence_motivation": 0,
  "non_academic.adjustment": 0,
  "non_academic.wellness": 0,
  "non_academic.emotional_social": 0,
  "non_academic.career_uncertainty": 0,
  "non_academic.financial": 0,
  "non_academic.communication_language": 0,
  "non_academic.other": 0,
  "non_academic.no_major_issue": 0,
};

const GRADE_11_PHASES = [
  { id: 71, number: 1, title: "Settling in", state: "open" },
  { id: 72, number: 2, title: "Mid-term check", state: "open" },
  { id: 74, number: 4, title: "Year end", state: "locked" },
];

function heatmap(overrides: Record<string, unknown> = {}) {
  return {
    programIds: [1],
    academicYear: "2026-2027",
    grade: 11,
    phaseId: null,
    phases: GRADE_11_PHASES,
    defaultPhaseId: 72,
    academicYears: ["2026-2027", "2025-2026"],
    total: {
      studentCount: 3,
      counts: { ...ZERO, "academic.subject_concept": 1, "academic.exam_related": 2, "non_academic.financial": 3 },
    },
    schools: [
      {
        code: "SCH001", name: "Alpha School", studentCount: 2,
        counts: { ...ZERO, "academic.exam_related": 2, "non_academic.financial": 2 },
      },
      {
        code: "SCH002", name: "Beta School", studentCount: 1,
        counts: { ...ZERO, "academic.subject_concept": 1, "non_academic.financial": 1 },
      },
    ],
    hiddenSchoolCount: 2,
    ...overrides,
  };
}

function respond(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: async () => body } as Response);
}

function stubHeatmap(handler: (params: URLSearchParams) => unknown) {
  const fetchMock = vi.fn((url: string) => {
    const params = new URL(url, "http://localhost").searchParams;
    return respond(handler(params));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requested(fetchMock: ReturnType<typeof stubHeatmap>) {
  return fetchMock.mock.calls.map(([url]) => String(url));
}

describe("ChallengeCategoryHeatmap", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the All Schools row, each School's n and percentages, and the hidden-School note", async () => {
    stubHeatmap(() => heatmap());

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

    const table = await screen.findByRole("table", { name: "Challenge Category Heatmap" });
    const rows = within(table).getAllByRole("row");
    // Two header rows, then All Schools, Alpha, Beta.
    expect(rows).toHaveLength(5);
    expect(within(rows[0]).getByRole("columnheader", { name: "Academic" })).toHaveAttribute("colspan", "6");
    expect(within(rows[0]).getByRole("columnheader", { name: "Non-academic" })).toHaveAttribute("colspan", "10");
    expect(within(rows[1]).getAllByRole("columnheader")).toHaveLength(16);
    expect(within(rows[1]).getByRole("columnheader", { name: "Academic: Subject/concept issues" }))
      .toHaveAttribute("title", "Subject/concept issues");
    expect(within(rows[1]).getByRole("columnheader", { name: "Non-academic: No major issue reported" }))
      .toBeInTheDocument();

    const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);
    expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("All Schools");
    expect(within(rows[2]).getByRole("rowheader")).toHaveTextContent("n = 3");
    // 1/3 = 33.3%, 2/3 = 66.7%, 3/3 = 100.0%.
    expect(cells(rows[2])).toEqual([
      "33.3%", "0.0%", "66.7%", "0.0%", "0.0%", "0.0%",
      "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "100.0%", "0.0%", "0.0%", "0.0%",
    ]);
    // Text follows the cell: black on the light 33.3% cell, white on the dark 66.7% one.
    const allSchoolsCells = within(rows[2]).getAllByRole("cell");
    expect(allSchoolsCells[0]).toHaveStyle({ backgroundColor: "rgb(221, 165, 130)", color: "rgb(0, 0, 0)" });
    expect(allSchoolsCells[2]).toHaveStyle({ backgroundColor: "rgb(187, 82, 71)", color: "rgb(255, 255, 255)" });
    expect(within(rows[3]).getByRole("rowheader")).toHaveTextContent("Alpha School");
    expect(within(rows[3]).getByRole("rowheader")).toHaveTextContent("n = 2");
    expect(cells(rows[3])).toEqual([
      "0.0%", "0.0%", "100.0%", "0.0%", "0.0%", "0.0%",
      "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "0.0%", "100.0%", "0.0%", "0.0%", "0.0%",
    ]);
    expect(within(rows[4]).getByRole("rowheader")).toHaveTextContent("Beta School");
    expect(within(rows[4]).getByRole("rowheader")).toHaveTextContent("n = 1");
    expect(screen.getByText("2 Schools have no categorized Notes yet")).toBeInTheDocument();
  });
  it("opens on Grade 11 and the latest Open Phase, and resets Phase when the Grade changes", async () => {
    const fetchMock = stubHeatmap((params) => params.get("grade") === "12"
      ? heatmap({ grade: 12, phases: [{ id: 81, number: 3, title: "Board prep", state: "open" }], defaultPhaseId: 81,
        phaseId: params.get("phase_id") ? 81 : null })
      : heatmap({ phaseId: params.get("phase_id") ? Number(params.get("phase_id")) : null }));
    const user = userEvent.setup();

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

    expect(screen.getByLabelText("Grade")).toHaveValue("11");
    await waitFor(() => expect(screen.getByLabelText("Phase")).toHaveDisplayValue("Phase 2 - Mid-term check"));
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Grade 11", "Grade 12", "All Phases", "Phase 1 - Settling in", "Phase 2 - Mid-term check", "Phase 4 - Year end",
    ]);
    expect(requested(fetchMock)).toEqual([
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=11",
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=11&phase_id=72",
    ]);

    await user.selectOptions(screen.getByLabelText("Phase"), "All Phases");
    await waitFor(() => expect(requested(fetchMock)).toHaveLength(3));
    expect(requested(fetchMock)[2]).toBe(
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=11",
    );
    await user.selectOptions(screen.getByLabelText("Grade"), "12");

    await waitFor(() => expect(screen.getByLabelText("Phase")).toHaveDisplayValue("Phase 3 - Board prep"));
    expect(requested(fetchMock).slice(3)).toEqual([
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=12",
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=12&phase_id=81",
    ]);
  });

  it("resets Phase to the new default when the Program or Academic Year changes", async () => {
    const fetchMock = stubHeatmap((params) => heatmap({
      phases: params.get("academic_year") === "2025-2026"
        ? [{ id: 61, number: 1, title: "Last year", state: "open" }]
        : GRADE_11_PHASES,
      defaultPhaseId: params.get("academic_year") === "2025-2026" ? 61 : 72,
    }));
    const user = userEvent.setup();
    const view = render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);
    await waitFor(() => expect(screen.getByLabelText("Phase")).toHaveDisplayValue("Phase 2 - Mid-term check"));
    await user.selectOptions(screen.getByLabelText("Phase"), "Phase 1 - Settling in");
    await waitFor(() => expect(requested(fetchMock)).toHaveLength(3));

    view.rerender(<ChallengeCategoryHeatmap programId={1} academicYear="2025-2026" />);
    await waitFor(() => expect(screen.getByLabelText("Phase")).toHaveDisplayValue("Phase 1 - Last year"));
    view.rerender(<ChallengeCategoryHeatmap programId={78} academicYear="2025-2026" />);

    await waitFor(() => expect(requested(fetchMock).at(-1)).toBe(
      "/api/holistic-mentorship/challenge-categories?program_id=78&academic_year=2025-2026&grade=11&phase_id=61",
    ));
    expect(requested(fetchMock).slice(3)).toEqual([
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2025-2026&grade=11",
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2025-2026&grade=11&phase_id=61",
      "/api/holistic-mentorship/challenge-categories?program_id=78&academic_year=2025-2026&grade=11",
      "/api/holistic-mentorship/challenge-categories?program_id=78&academic_year=2025-2026&grade=11&phase_id=61",
    ]);
  });

  it("locks Phase to All Phases for All Programs, even straight after a single Program", async () => {
    const fetchMock = stubHeatmap((params) => params.get("program_id") === "all"
      ? heatmap({ programIds: [1, 78], phases: [], defaultPhaseId: null })
      : heatmap());
    const view = render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);
    await waitFor(() => expect(screen.getByLabelText("Phase")).toHaveDisplayValue("Phase 2 - Mid-term check"));

    view.rerender(<ChallengeCategoryHeatmap programId="all" academicYear="2026-2027" />);

    const phase = screen.getByLabelText("Phase");
    expect(phase).toBeDisabled();
    expect(within(phase).getAllByRole("option").map((option) => option.textContent)).toEqual(["All Phases"]);
    await screen.findByRole("table", { name: "Challenge Category Heatmap" });
    expect(phase).toBeDisabled();
    expect(phase).toHaveDisplayValue("All Phases");
    expect(within(phase).getAllByRole("option")).toHaveLength(1);
    expect(requested(fetchMock).slice(2)).toEqual([
      "/api/holistic-mentorship/challenge-categories?program_id=all&academic_year=2026-2027&grade=11",
    ]);
  });

  it("uses All Phases with a single request when the Grade has no Open Phase", async () => {
    const fetchMock = stubHeatmap(() => heatmap({ defaultPhaseId: null }));

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

    await screen.findByRole("table", { name: "Challenge Category Heatmap" });
    expect(screen.getByLabelText("Phase")).toHaveDisplayValue("All Phases");
    expect(requested(fetchMock)).toEqual([
      "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=11",
    ]);
  });
  it("shows an empty state instead of a grid when no Student has categorized Notes", async () => {
    stubHeatmap(() => heatmap({
      defaultPhaseId: null,
      total: { studentCount: 0, counts: ZERO },
      schools: [],
      hiddenSchoolCount: 1,
    }));

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

    expect(await screen.findByText(
      "No submitted Post-Session Notes with Challenge Categories match this selection yet.",
    )).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("1 School has no categorized Notes yet")).toBeInTheDocument();
  });

  describe("Download CSV", () => {
    const filename = "challenge-categories-2026-2027-grade-11-program-1-phase-2.csv";

    function stubDownload(csvResponse: () => Response) {
      const fetchMock = vi.fn((url: string) => {
        const params = new URL(url, "http://localhost").searchParams;
        return params.get("format") === "csv" ? Promise.resolve(csvResponse()) : respond(heatmap());
      });
      vi.stubGlobal("fetch", fetchMock);
      const createObjectURL = vi.fn((blob: Blob) => (void blob, "blob:heatmap"));
      const revokeObjectURL = vi.fn();
      const NativeURL = URL;
      vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL, revokeObjectURL }));
      const downloads: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(`${this.download} <- ${this.href}`);
      });
      return { fetchMock, createObjectURL, revokeObjectURL, downloads };
    }

    it("downloads the current filters' grid under the server's filename", async () => {
      const { fetchMock, createObjectURL, revokeObjectURL, downloads } = stubDownload(() => new Response(
        "School,UDISE Code", {
          status: 200,
          headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"` },
        },
      ));
      const user = userEvent.setup();
      render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);
      await screen.findByRole("table", { name: "Challenge Category Heatmap" });

      await user.click(screen.getByRole("button", { name: "Download CSV" }));

      await waitFor(() => expect(downloads).toEqual([`${filename} <- blob:heatmap`]));
      expect(requested(fetchMock).at(-1)).toBe(
        "/api/holistic-mentorship/challenge-categories?program_id=1&academic_year=2026-2027&grade=11&phase_id=72&format=csv",
      );
      expect(await createObjectURL.mock.calls[0][0].text()).toBe("School,UDISE Code");
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:heatmap");
    });

    it("shows the route's error and keeps the control usable when the download fails", async () => {
      const { downloads } = stubDownload(() => new Response("upstream unavailable", { status: 502 }));
      const user = userEvent.setup();
      render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);
      await screen.findByRole("table", { name: "Challenge Category Heatmap" });

      await user.click(screen.getByRole("button", { name: "Download CSV" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to download Challenge Categories (502)");
      expect(screen.getByRole("button", { name: "Download CSV" })).toBeEnabled();
      expect(downloads).toEqual([]);
    });

    it("has no Download CSV while loading or in the empty state", async () => {
      stubHeatmap(() => heatmap({ defaultPhaseId: null, total: { studentCount: 0, counts: ZERO }, schools: [] }));

      render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

      expect(screen.getByRole("status")).toHaveTextContent("Loading Challenge Categories...");
      expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
      expect(await screen.findByText(
        "No submitted Post-Session Notes with Challenge Categories match this selection yet.",
      )).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Download CSV" })).not.toBeInTheDocument();
    });
  });

  it("shows loading, then a safe error with Retry that reloads the heatmap", async () => {
    let fail = true;
    const fetchMock = vi.fn(() => fail
      ? respond({ error: "Unable to load Challenge Categories. Please try again." }, false)
      : respond(heatmap({ defaultPhaseId: null })));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading Challenge Categories...");
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load Challenge Categories. Please try again.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table", { name: "Challenge Category Heatmap" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to a generic message when the error response is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({
      ok: false, json: async () => { throw new SyntaxError("Unexpected token"); },
    } as unknown as Response)));

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load Challenge Categories. Please try again.");
  });

  it("reports the heatmap's Academic Years to the shared selector", async () => {
    stubHeatmap(() => heatmap({ defaultPhaseId: null }));
    const onAcademicYears = vi.fn();

    render(<ChallengeCategoryHeatmap programId={1} academicYear="2026-2027" onAcademicYears={onAcademicYears} />);

    await waitFor(() => expect(onAcademicYears).toHaveBeenCalledWith(["2026-2027", "2025-2026"]));
  });
});
