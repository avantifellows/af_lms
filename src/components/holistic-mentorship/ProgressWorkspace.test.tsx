import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProgressWorkspace from "./ProgressWorkspace";

const payload = {
  rows: [{
    studentId: 41, studentName: "Student One", externalStudentId: "AF-41", grade: 11,
    schoolName: "School One", schoolCode: "SCH001", mentorName: "Mentor One", mentorEmail: "mentor@example.com",
    phaseId: 70, phaseNumber: 2, phaseTitle: "Check-in", phaseState: "active", progress: "completed",
    completedAt: "2026-07-01T10:30:00.000Z", notesAuthor: "Mentor One",
    notesAuthorEmail: "mentor@example.com", notesLastEditedAt: "2026-07-01", answers: [],
  }],
  counts: { totalMapped: 73, pending: 30, completed: 20, skipped: 18, noActivePhase: 5 },
  options: {
    schools: [{ code: "SCH001", name: "School One" }],
    mentors: [{ userId: 9, name: "Mentor One" }],
    phases: [{ id: 70, number: 2, title: "Check-in", grade: 11, state: "open" }],
  },
  academicYears: ["2026-2027", "2025-2026", "2023-2024"],
  pageSize: 50,
  refreshedAt: "2026-07-17T10:00:00.000Z",
};

describe("ProgressWorkspace", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200, headers: { "content-type": "application/json" },
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports dynamic years and shows required row details, counts, and drill-down", async () => {
    const onAcademicYears = vi.fn();
    render(<ProgressWorkspace onAcademicYears={onAcademicYears} />);

    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(onAcademicYears).toHaveBeenCalledWith(["2026-2027", "2025-2026", "2023-2024"]);
    expect(screen.getAllByText("73").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("mentor@example.com")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Completed on" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Student progress table" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table", { name: "Student progress results" })).toHaveAttribute(
      "aria-busy",
      "false"
    );
    expect(screen.getByText(/Last refreshed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open Student One/ })).toHaveAttribute(
      "href", "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027"
    );
  });

  it("loads on filter change and manual Refresh without polling", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
  });

  it("clears year-specific selectors when the Academic Year changes", async () => {
    const view = render(<ProgressWorkspace academicYear="2026-2027" />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Phase lens"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    fireEvent.change(screen.getByLabelText("Filter by Mentor"), { target: { value: "9" } });
    view.rerender(<ProgressWorkspace academicYear="2025-2026" />);

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/holistic-mentorship/progress?academic_year=2025-2026&page=1&sort=school&direction=asc",
      expect.anything()
    ));
    expect(screen.getByText(/Earlier academic years are read-only/)).toBeInTheDocument();
  });

  it("distinguishes an Academic Year with no Mappings from filters with no matches", async () => {
    const emptyCounts = { totalMapped: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ...payload,
      rows: [],
      counts: emptyCounts,
      options: { schools: [], mentors: [], phases: [] },
    }))));
    const first = render(<ProgressWorkspace />);

    expect(await screen.findByText("No mapped Students exist for this Academic Year.")).toBeInTheDocument();
    first.unmount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...payload,
      rows: [],
      counts: emptyCounts,
    }))));
    render(<ProgressWorkspace />);

    expect(await screen.findByText("No mapped Students match these filters.")).toBeInTheDocument();
  });

  it("restores filters, sorting, page, and scroll after drill-down navigation", async () => {
    sessionStorage.setItem("holistic-progress-view", JSON.stringify({
      filters: {
        academicYear: "2026-2027", school: "SCH001", grade: "11", mentor: "9", phase: "70",
        progress: "completed", search: "Student", sort: "progress", direction: "desc",
      },
      page: 2,
    }));
    sessionStorage.setItem("holistic-progress-scroll", "420");
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);

    render(<StrictMode><ProgressWorkspace /></StrictMode>);

    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls).toEqual([[
      "/api/holistic-mentorship/progress?academic_year=2026-2027&page=2&sort=progress&direction=desc&school_code=SCH001&grade=11&mentor_user_id=9&phase_id=70&progress=completed&search=Student",
      expect.anything(),
    ]]);
    expect(screen.getByLabelText("Filter by School")).toHaveValue("SCH001");
    expect(screen.getByLabelText("Page 2 of 2")).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 420 }));
  });

  it("exports every matching row with the current filters and sort", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve(
      input.includes("format=csv")
        ? new Response("Academic Year,Student", { status: 200, headers: { "content-type": "text/csv" } })
        : new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
    ));
    vi.stubGlobal("fetch", fetchMock);
    const createObjectURL = vi.fn(() => "blob:progress");
    const revokeObjectURL = vi.fn();
    const NativeURL = URL;
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    fireEvent.click(screen.getByRole("button", { name: "School" }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const exportCall = fetchMock.mock.calls.find(([url]) => url.includes("format=csv"));
    expect(exportCall).toBeDefined();
    const query = new URL(String(exportCall![0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      academic_year: "2026-2027", school_code: "SCH001", sort: "school", direction: "desc", format: "csv",
    });
    expect(query.has("page")).toBe(false);
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:progress");
  });

  it("shows a useful error when CSV export fails with a non-JSON response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => Promise.resolve(
      input.includes("format=csv")
        ? new Response("upstream unavailable", { status: 502 })
        : new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
    )));
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to export progress (502)");
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeEnabled();
  });

  it("keeps Profile access in the Student detailed view", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    expect(screen.queryByRole("button", { name: "Profile for Student One" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Student One" })).toBeInTheDocument();
  });
});
