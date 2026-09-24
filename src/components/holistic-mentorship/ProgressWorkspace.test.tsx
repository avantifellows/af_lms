import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  counts: { total: 73, pending: 30, completed: 20, skipped: 18, noActivePhase: 5 },
  coverage: { eligible: 90, assigned: 73, unassigned: 17 },
  options: {
    schools: [{ code: "SCH001", name: "School One" }],
    mentors: [{ userId: 9, name: "Mentor One" }],
    phases: [{ id: 70, number: 2, title: "Check-in", grade: 11, state: "open" }],
  },
  coverageSchools: [
    { code: "SCH001", name: "School One" },
    { code: "SCH002", name: "School Without Mappings" },
  ],
  academicYears: ["2026-2027", "2025-2026", "2023-2024"],
  pageSize: 50,
  refreshedAt: "2026-07-17T10:00:00.000Z",
};

const unassignedPayload = {
  ...payload,
  rows: [
    {
      progress: "unassigned", studentId: 52, studentName: "Asha Rao", externalStudentId: "AF-52", grade: 11,
      schoolName: "School One", schoolCode: "SCH001", activePhaseId: 70,
    },
    {
      progress: "unassigned", studentId: 52, studentName: "Asha Rao", externalStudentId: "AF-52", grade: 12,
      schoolName: "School Two", schoolCode: "SCH002", activePhaseId: null,
    },
  ],
  counts: { total: 212, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
};

async function showUnassigned(body: unknown = unassignedPayload) {
  vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => Promise.resolve(new Response(JSON.stringify(
    input.includes("progress=unassigned") ? body : payload,
  )))));
  render(<ProgressWorkspace />);
  await screen.findByText("Student One");
  fireEvent.change(screen.getByLabelText("Filter by Progress"), { target: { value: "unassigned" } });
}

function cardValues(group: string) {
  return within(screen.getByRole("region", { name: group })).getAllByRole("listitem")
    .map((card) => [card.firstElementChild?.textContent, card.lastElementChild?.textContent]);
}

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

  it.each([
    [500, ""],
    [502, "<html>Bad gateway</html>"],
    [200, ""],
  ])("shows a useful error and recovers after an invalid response (%s)", async (status, body) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(body, { status }));
    render(<ProgressWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load progress. Please try again.");
    expect(screen.queryByText("Student One")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the API's controlled timeout message", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      error: "Progress took too long to load. Please try again.",
    }), { status: 503 }));
    render(<ProgressWorkspace />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Progress took too long to load. Please try again.");
  });

  it("reports dynamic years and shows required row details, counts, and drill-down", async () => {
    const onAcademicYears = vi.fn();
    render(<ProgressWorkspace onAcademicYears={onAcademicYears} />);

    expect(await screen.findByText("Student One")).toBeInTheDocument();
    await waitFor(() => expect(onAcademicYears).toHaveBeenCalledWith(
      ["2026-2027", "2025-2026", "2023-2024"]
    ));
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
      "href", "/holistic-mentorship/students/41/phases/70?school_code=SCH001&academic_year=2026-2027&program_id=1&source=progress"
    );
  });

  it("says Assigned instead of mapped in cards, the Progress filter, and pagination", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    expect(screen.getByText("Assigned").nextElementSibling).toHaveTextContent("73");
    expect(screen.getByText(
      "Shows assigned Mentees by default. Choose Unassigned in the Progress filter to list eligible Students " +
      "without a Mentor (current year only). Mapping and Notes are read-only for Admins.",
    )).toBeInTheDocument();
    const progress = screen.getByLabelText("Filter by Progress");
    expect(progress).toHaveValue("");
    expect(Array.from(progress.querySelectorAll("option")).map((option) => [option.value, option.textContent])).toEqual([
      ["", "All Assigned"], ["pending", "Pending"], ["completed", "Completed"],
      ["skipped", "Skipped"], ["no_active_phase", "No active phase"], ["unassigned", "Unassigned"],
    ]);
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1-1 of 73 assigned Mentees");
    const labels = [...screen.getAllByText((_, element) => element?.tagName === "P"
      && element.className.includes("uppercase")), ...screen.getAllByRole("heading"),
      ...progress.querySelectorAll("option")];
    expect(labels.map((element) => element.textContent).filter((text) => /mapped/i.test(text ?? ""))).toEqual([]);
    expect(labels.map((element) => element.textContent).filter((text) => /%/.test(text ?? ""))).toEqual([]);
    expect(screen.queryByText(/mapped/i)).not.toBeInTheDocument();
  });

  it("offers Unassigned only for the current year and disables it while a Mentor is selected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload)))));
    const view = render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    const unassigned = () => screen.getByRole("option", { name: "Unassigned" }) as HTMLOptionElement;

    expect(unassigned().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Filter by Mentor"), { target: { value: "9" } });
    expect(unassigned().disabled).toBe(true);

    view.rerender(<ProgressWorkspace academicYear="2025-2026" />);
    await screen.findByText("Student One");
    expect(Array.from(screen.getByLabelText("Filter by Progress").querySelectorAll("option"))
      .map((option) => option.value)).toEqual(["", "pending", "completed", "skipped", "no_active_phase"]);
  });

  it("requests the Unassigned list when Unassigned is chosen", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    fireEvent.change(screen.getByLabelText("Filter by Progress"), { target: { value: "unassigned" } });

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/holistic-mentorship/progress?academic_year=2026-2027&program_id=1&page=1&sort=school&direction=asc&progress=unassigned",
      expect.anything(),
    ));
  });

  it("shows Unassigned rows read-only with dashes, a badge, and an active-Phase link", async () => {
    const log = vi.spyOn(console, "error");
    await showUnassigned();
    const rows = await screen.findAllByRole("row", { name: /Asha Rao/ });

    expect(rows).toHaveLength(2);
    const [first, second] = rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(first).toEqual(["Asha RaoAF-52", "School OneSCH001", "11", "—", "—", "Unassigned", "—", "Open Student"]);
    expect(second).toEqual(["Asha RaoAF-52", "School TwoSCH002", "12", "—", "—", "Unassigned", "—", "Open Student"]);
    expect(within(rows[0]).getByRole("link", { name: "Open Asha Rao" })).toHaveAttribute(
      "href", "/holistic-mentorship/students/52/phases/70?school_code=SCH001&academic_year=2026-2027&program_id=1&source=progress",
    );
    expect(within(rows[0]).queryAllByRole("button")).toEqual([]);
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  });

  it("disables Open Student when the Unassigned Student's Grade has no active Phase", async () => {
    await showUnassigned();
    const [, noActivePhase] = await screen.findAllByRole("row", { name: /Asha Rao/ });

    expect(within(noActivePhase).queryByRole("link")).not.toBeInTheDocument();
    const button = within(noActivePhase).getByRole("button", { name: "Open Student" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "No active Phase");
  });

  it("shows Unassigned pagination, zero Progress cards, and unchanged Coverage cards", async () => {
    await showUnassigned();
    await screen.findAllByRole("row", { name: /Asha Rao/ });

    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 1-2 of 212 Unassigned Students");
    expect(cardValues("Progress")).toEqual([["Pending", "0"], ["Completed", "0"], ["Skipped", "0"]]);
    expect(cardValues("Coverage")).toEqual([
      ["Eligible Students", "90"], ["Assigned", "73"], ["Unassigned", "17"],
    ]);
  });

  it("shows Unassigned loading and empty-state text", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => input.includes("progress=unassigned")
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : Promise.resolve(new Response(JSON.stringify(payload)))));
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Filter by Progress"), { target: { value: "unassigned" } });

    expect(await screen.findByText("Loading Unassigned Students...")).toBeInTheDocument();
    finish(new Response(JSON.stringify({
      ...unassignedPayload, rows: [], counts: { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 },
    })));
    expect(await screen.findByText("No Unassigned Students match these filters.")).toBeInTheDocument();
  });

  it("exports the Unassigned list with the current filters and no page", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => Promise.resolve(
      input.includes("format=csv")
        ? new Response("Academic Year,Student", { status: 200, headers: { "content-type": "text/csv" } })
        : new Response(JSON.stringify(input.includes("progress=unassigned") ? unassignedPayload : payload)),
    ));
    vi.stubGlobal("fetch", fetchMock);
    const NativeURL = URL;
    vi.stubGlobal("URL", Object.assign(class extends NativeURL {}, {
      createObjectURL: vi.fn(() => "blob:progress"), revokeObjectURL: vi.fn(),
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Filter by Progress"), { target: { value: "unassigned" } });
    await screen.findAllByRole("row", { name: /Asha Rao/ });

    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const exportCall = fetchMock.mock.calls.find(([url]) => url.includes("format=csv"));
    const query = new URL(String(exportCall![0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      academic_year: "2026-2027", program_id: "1", sort: "school", direction: "asc",
      progress: "unassigned", format: "csv",
    });
  });

  it("shows current-year Coverage and Progress card groups", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    expect(cardValues("Coverage")).toEqual([
      ["Eligible Students", "90"], ["Assigned", "73"], ["Unassigned", "17"],
    ]);
    expect(cardValues("Progress")).toEqual([
      ["Pending", "30"], ["Completed", "20"], ["Skipped", "18"], ["No active phase", "5"],
    ]);
  });

  it("shows a dash in every Coverage card while a Mentor is selected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify(payload)))));
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");

    fireEvent.change(screen.getByLabelText("Filter by Mentor"), { target: { value: "9" } });

    expect(cardValues("Coverage")).toEqual([
      ["Eligible Students", "—"], ["Assigned", "—"], ["Unassigned", "—"],
    ]);
    await screen.findByText("Student One");
    expect(cardValues("Coverage")).toEqual([
      ["Eligible Students", "—"], ["Assigned", "—"], ["Unassigned", "—"],
    ]);
  });

  it("shows only an Assigned total before progress counts for a past Academic Year", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...payload,
      counts: { total: 41, pending: 11, completed: 25, skipped: 5, noActivePhase: 0 },
      coverage: null,
    }))));
    render(<ProgressWorkspace academicYear="2025-2026" />);
    await screen.findByText("Student One");

    expect(screen.queryByRole("region", { name: "Coverage" })).not.toBeInTheDocument();
    expect(screen.queryByText("Eligible Students")).not.toBeInTheDocument();
    expect(screen.queryByText("Unassigned")).not.toBeInTheDocument();
    expect(cardValues("Progress")).toEqual([
      ["Assigned", "41"], ["Pending", "11"], ["Completed", "25"], ["Skipped", "5"],
    ]);
    expect(screen.getByText(/Viewing 2025-2026/).parentElement).toHaveTextContent(
      "Viewing 2025-2026. This view shows Students who had a Mapping during that Academic Year. " +
      "Earlier academic years are read-only. Eligible and Unassigned counts aren't available for " +
      "earlier years because LMS keeps no trustworthy record of historical eligibility.",
    );
  });

  it("links every permitted School to Assignment Coverage, including a School without Mappings", async () => {
    render(<ProgressWorkspace programId={78} />);

    expect(await screen.findByRole("link", { name: "Open Assignment Coverage for School One" }))
      .toHaveAttribute("href", "/school/SCH001?tab=holistic_mentorship&program_id=78&source=progress");
    expect(screen.getByRole("link", { name: "Open Assignment Coverage for School Without Mappings" }))
      .toHaveAttribute("href", "/school/SCH002?tab=holistic_mentorship&program_id=78&source=progress");
  });

  it("loads on filter change and manual Refresh without polling", async () => {
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const refresh = screen.getByRole("button", { name: "Refresh" });
    await waitFor(() => expect(refresh).toBeEnabled());
    fireEvent.click(refresh);
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
      "/api/holistic-mentorship/progress?academic_year=2025-2026&program_id=1&page=1&sort=school&direction=asc",
      expect.anything()
    ));
    expect(screen.getByText(/Earlier academic years are read-only/)).toBeInTheDocument();
  });

  it("clears the previous Program's rows while the next Program loads", async () => {
    let finishEmrs!: (response: Response) => void;
    const emrsResponse = new Promise<Response>((resolve) => { finishEmrs = resolve; });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload)))
      .mockReturnValueOnce(emrsResponse));
    const view = render(<ProgressWorkspace programId={1} />);
    await screen.findByText("Student One");

    view.rerender(<ProgressWorkspace programId={78} />);

    expect(await screen.findByText("Loading assigned Students...")).toBeInTheDocument();
    expect(screen.queryByText("Student One")).not.toBeInTheDocument();
    finishEmrs(new Response(JSON.stringify({ ...payload, rows: [] })));
  });

  it("distinguishes an Academic Year with no Mappings from filters with no matches", async () => {
    const emptyCounts = { total: 0, pending: 0, completed: 0, skipped: 0, noActivePhase: 0 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      ...payload,
      rows: [],
      counts: emptyCounts,
      options: { schools: [], mentors: [], phases: [] },
    }))));
    const first = render(<ProgressWorkspace />);

    expect(await screen.findByText("No assigned Students exist for this Academic Year.")).toBeInTheDocument();
    first.unmount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...payload,
      rows: [],
      counts: emptyCounts,
    }))));
    render(<ProgressWorkspace />);

    expect(await screen.findByText("No assigned Students match these filters.")).toBeInTheDocument();
  });

  it("restores filters, sorting, page, and scroll after drill-down navigation", async () => {
    sessionStorage.setItem("holistic-progress-view", JSON.stringify({
      scope: "1:2026-2027",
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
      "/api/holistic-mentorship/progress?academic_year=2026-2027&program_id=1&page=2&sort=progress&direction=desc&school_code=SCH001&grade=11&mentor_user_id=9&phase_id=70&progress=completed&search=Student",
      expect.anything(),
    ]]);
    expect(screen.getByLabelText("Filter by School")).toHaveValue("SCH001");
    expect(screen.getByLabelText("Page 2 of 2")).toBeInTheDocument();
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 420 }));
  });

  it("does not restore School, Mentor, or Phase filters from another Program", async () => {
    sessionStorage.setItem("holistic-progress-view", JSON.stringify({
      scope: "1:2026-2027",
      filters: {
        school: "SCH001",
        grade: "11",
        mentor: "9",
        phase: "70",
        progress: "",
        search: "",
        sort: "school",
        direction: "asc",
      },
      page: 2,
    }));

    render(<ProgressWorkspace programId={78} />);

    await screen.findByText("Student One");
    const request = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(request).toContain("program_id=78");
    expect(request).toContain("grade=11");
    expect(request).toContain("page=1");
    expect(request).not.toContain("school_code=");
    expect(request).not.toContain("mentor_user_id=");
    expect(request).not.toContain("phase_id=");
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
