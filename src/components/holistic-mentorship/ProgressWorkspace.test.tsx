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

  it("shows fixed Program, dynamic years, required row details, counts, and drill-down", async () => {
    render(<ProgressWorkspace />);

    expect(await screen.findByText("Student One")).toBeInTheDocument();
    expect(screen.getByLabelText("Program")).toHaveValue("1");
    expect(screen.getByLabelText("Program")).toBeDisabled();
    expect(screen.getByRole("option", { name: "2023-2024" })).toBeInTheDocument();
    expect(screen.getByText("73")).toBeInTheDocument();
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
    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.change(screen.getByLabelText("Phase lens"), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText("Filter by School"), { target: { value: "SCH001" } });
    fireEvent.change(screen.getByLabelText("Filter by Mentor"), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("Academic Year"), { target: { value: "2025-2026" } });

    await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(
      "/api/holistic-mentorship/progress?academic_year=2025-2026&page=1&sort=school&direction=asc",
      expect.anything()
    ));
    expect(screen.getByText("Earlier academic years are read-only.")).toBeInTheDocument();
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
    expect(screen.getByLabelText("Sort results")).toHaveValue("progress");
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
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
    fireEvent.change(screen.getByLabelText("Sort results"), { target: { value: "phase" } });
    fireEvent.click(screen.getByRole("button", { name: "Ascending" }));
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const exportCall = fetchMock.mock.calls.find(([url]) => url.includes("format=csv"));
    expect(exportCall).toBeDefined();
    const query = new URL(String(exportCall![0]), "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toMatchObject({
      academic_year: "2026-2027", school_code: "SCH001", sort: "phase", direction: "desc", format: "csv",
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

  it("reuses a queued regeneration request key for idempotent delivery retry", async () => {
    const requestKey = "d16e7d82-dc60-4b79-a064-9ed80badc119";
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.includes("/profiles/41") && init?.method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, requestKey, state: "queued" })));
      }
      if (input.includes("/profiles/41")) {
        return Promise.resolve(new Response(JSON.stringify({
          summaries: [], regeneration: { requestKey, state: "queued", requestedAt: "2026-07-17T10:00:00.000Z" },
        })));
      }
      return Promise.resolve(new Response(JSON.stringify(payload)));
    }));

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.click(screen.getByRole("button", { name: "Profile for Student One" }));
    await screen.findByText("Regeneration status:");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate Profile" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      "/api/holistic-mentorship/profiles/41",
      expect.objectContaining({ body: JSON.stringify({ request_key: requestKey, force: true }) })
    ));
  });

  it("does not create another request while regeneration is running", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string) => {
      if (input.includes("/profiles/41")) {
        return Promise.resolve(new Response(JSON.stringify({
          summaries: [],
          regeneration: {
            requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119",
            state: "running",
            requestedAt: "2026-07-17T10:00:00.000Z",
          },
        })));
      }
      return Promise.resolve(new Response(JSON.stringify(payload)));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.click(screen.getByRole("button", { name: "Profile for Student One" }));
    await screen.findByText("running", { exact: true });

    expect(screen.getByRole("button", { name: "Regenerate Profile" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("opens Profile in a labelled native dialog, closes on cancel, and restores focus", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => Promise.resolve(
      input.includes("/profiles/41")
        ? new Response(JSON.stringify({ summaries: [], regeneration: null }))
        : new Response(JSON.stringify(payload))
    )));

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    const trigger = screen.getByRole("button", { name: "Profile for Student One" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: /Student One Student Profile/ });
    expect(dialog.tagName).toBe("DIALOG");
    expect(dialog).toHaveAttribute("open");
    await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toHaveFocus());

    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it("waits for stored status and prevents duplicate regeneration requests", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    let resolveProfile!: (response: Response) => void;
    let resolveRegeneration!: (response: Response) => void;
    const profileResponse = new Promise<Response>((resolve) => { resolveProfile = resolve; });
    const regenerationResponse = new Promise<Response>((resolve) => { resolveRegeneration = resolve; });
    const fetchMock = vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.includes("/profiles/41") && init?.method === "POST") return regenerationResponse;
      if (input.includes("/profiles/41")) return profileResponse;
      return Promise.resolve(new Response(JSON.stringify(payload)));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.click(screen.getByRole("button", { name: "Profile for Student One" }));

    const regenerate = screen.getByRole("button", { name: "Regenerate Profile" });
    expect(regenerate).toBeDisabled();
    resolveProfile(new Response(JSON.stringify({ summaries: [], regeneration: null })));
    await waitFor(() => expect(regenerate).toBeEnabled());

    fireEvent.click(regenerate);
    fireEvent.click(regenerate);
    expect(regenerate).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

    resolveRegeneration(new Response(JSON.stringify({ state: "queued" }), { status: 202 }));
    await screen.findByText("Regeneration queued.");
  });

  it("fails safely when Profile status cannot be read as JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) => Promise.resolve(
      input.includes("/profiles/41")
        ? new Response("gateway failure", { status: 502 })
        : new Response(JSON.stringify(payload))
    )));

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.click(screen.getByRole("button", { name: "Profile for Student One" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load Profile (502)");
    expect(screen.getByRole("button", { name: "Regenerate Profile" })).toBeDisabled();
  });

  it("shows a safe retry error when regeneration returns non-JSON", async () => {
    vi.stubGlobal("confirm", vi.fn(() => true));
    let profileReads = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string, init?: RequestInit) => {
      if (input.includes("/profiles/41") && init?.method === "POST") {
        return Promise.resolve(new Response("sensitive upstream details", { status: 502 }));
      }
      if (input.includes("/profiles/41")) {
        profileReads += 1;
        return Promise.resolve(new Response(JSON.stringify({
          summaries: [{ position: 1, title: "Strengths", summary: "Stored summary" }],
          regeneration: profileReads > 1
            ? { requestKey: "d16e7d82-dc60-4b79-a064-9ed80badc119", state: "failed", requestedAt: "2026-07-17T10:00:00.000Z" }
            : null,
        })));
      }
      return Promise.resolve(new Response(JSON.stringify(payload)));
    }));

    render(<ProgressWorkspace />);
    await screen.findByText("Student One");
    fireEvent.click(screen.getByRole("button", { name: "Profile for Student One" }));
    await screen.findByText("Stored summary");
    fireEvent.click(screen.getByRole("button", { name: "Regenerate Profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to queue regeneration (502)");
    expect(screen.queryByText("sensitive upstream details")).not.toBeInTheDocument();
    expect(screen.getByText("failed", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("Stored summary")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate Profile" })).toBeEnabled();
  });
});
