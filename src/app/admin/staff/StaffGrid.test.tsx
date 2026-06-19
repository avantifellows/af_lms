import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import StaffGrid from "./StaffGrid";
import type {
  StaffRosterFilters,
  StaffRosterRow,
  StaffRosterSummary,
} from "@/lib/staff-shared";

const FILTERS: StaffRosterFilters = {
  search: "",
  kind: "all",
  code: "all",
  exited: "exclude",
  centreId: null,
};

const SUMMARY: StaffRosterSummary = {
  total: 3,
  teachers: 2,
  staff: 0,
  pending: 1,
  missingCode: 2,
  exited: 0,
  vacantSeats: 4,
};

const ROWS: StaffRosterRow[] = [
  {
    kind: "teacher",
    recordId: 10,
    userId: 70,
    name: "Asha Teacher",
    email: "asha@avantifellows.org",
    employeeCode: "AF101",
    subjectName: "Physics",
    staffType: null,
    designation: "Senior Teacher",
    exitDate: null,
    seats: [{ id: 44, centreId: 8, centreName: "JNV Adilabad - CoE", role: "physics" }],
  },
  {
    kind: "teacher",
    recordId: 11,
    userId: 71,
    name: "Binu Codeless",
    email: "binu@avantifellows.org",
    employeeCode: null,
    subjectName: null,
    staffType: null,
    designation: null,
    exitDate: null,
    seats: [],
  },
  {
    kind: "pending_pm",
    recordId: 5,
    userId: null,
    name: "Pending Pm",
    email: "pm@avantifellows.org",
    employeeCode: null,
    subjectName: null,
    staffType: "program_manager",
    designation: null,
    exitDate: null,
    seats: [],
  },
];

function stubFetch(
  handler?: (url: string, init?: RequestInit) => Response | undefined
) {
  const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const handled = handler?.(url, init);
    if (handled) return handled;
    if (url.startsWith("/api/admin/centres")) {
      return new Response(
        JSON.stringify({
          rows: [
            { id: 8, name: "JNV Adilabad - CoE" },
            { id: 3, name: "JNV Bengaluru" },
          ],
        }),
        { status: 200 }
      );
    }
    if (url.startsWith("/api/admin/staff?")) {
      return new Response(JSON.stringify({ rows: ROWS, summary: SUMMARY }), {
        status: 200,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", mockFetch);
  return mockFetch;
}

function renderGrid() {
  return render(
    <StaffGrid
      initialRows={ROWS}
      initialSummary={SUMMARY}
      initialFilters={FILTERS}
    />
  );
}

describe("StaffGrid", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders summary stats and groups rows by centre", () => {
    stubFetch();
    renderGrid();
    expect(screen.getByText("Missing AF ID")).toBeTruthy();
    // Appears as the group header and as the card's Centre field
    expect(screen.getAllByText("JNV Adilabad - CoE").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("No Centre assigned")).toBeTruthy();
    expect(screen.getByText("Asha Teacher")).toBeTruthy();
    expect(screen.getByText("AF101")).toBeTruthy();
    expect(screen.getAllByText("No AF ID")).toHaveLength(2);
    expect(screen.getByText("PM (no staff record)")).toBeTruthy();
  });

  it("shows labeled fields on the card", () => {
    stubFetch();
    renderGrid();
    expect(screen.getAllByText("Role").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Centre").length).toBeGreaterThan(0);
    expect(screen.getByText("Physics")).toBeTruthy();
  });

  it("shows the staff seat tier at a centre, not the generic PM", () => {
    const phRows: StaffRosterRow[] = [
      {
        kind: "staff",
        recordId: 20,
        userId: 80,
        name: "Subramanya A",
        email: "subramanya@avantifellows.org",
        employeeCode: "AF183",
        subjectName: null,
        staffType: "program_manager",
        designation: "Director, Operations",
        exitDate: null,
        seats: [
          { id: 99, centreId: 8, centreName: "JNV Adilabad - CoE", role: "ph" },
        ],
      },
    ];
    stubFetch();
    render(
      <StaffGrid
        initialRows={phRows}
        initialSummary={SUMMARY}
        initialFilters={FILTERS}
      />
    );
    expect(screen.getByText("Subramanya A")).toBeTruthy();
    // Role column reflects the seat tier (PH), not the kind-derived "PM".
    expect(screen.getByText("PH")).toBeTruthy();
    expect(screen.queryByText("PM")).toBeNull();
  });

  it("offers a Centre filter fed by the centres API", async () => {
    stubFetch();
    renderGrid();
    const select = screen.getByLabelText("Filter by Centre");
    await waitFor(() => {
      expect(select.querySelectorAll("option").length).toBe(3); // All + 2 centres
    });
  });

  it("saves an AF code for a teacher via PATCH from the edit modal", async () => {
    const mockFetch = stubFetch((url, init) => {
      if (url.startsWith("/api/admin/staff/teachers/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return undefined;
    });

    renderGrid();
    fireEvent.click(screen.getByLabelText("Edit Binu Codeless"));
    fireEvent.change(screen.getByLabelText("Employee code"), {
      target: { value: "af202" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/staff/teachers/11",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ teacher_id: "AF202" }),
        })
      );
    });
    // Modal closes after a successful save
    await waitFor(() => {
      expect(screen.queryByLabelText("Employee code")).toBeNull();
    });
  });

  it("creates a staff record for a pending PM via POST", async () => {
    const mockFetch = stubFetch((url, init) => {
      if (url === "/api/admin/staff/members" && init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      return undefined;
    });

    renderGrid();
    fireEvent.click(screen.getByLabelText("Edit Pending Pm"));
    fireEvent.change(screen.getByLabelText("Employee code"), {
      target: { value: "AF300" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/staff/members",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            user_permission_id: 5,
            employee_code: "AF300",
          }),
        })
      );
    });
  });

  it("surfaces action errors inside the modal", async () => {
    stubFetch((url, init) => {
      if (url.startsWith("/api/admin/staff/teachers/") && init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ error: "Employee code AF1 is already used" }),
          { status: 409 }
        );
      }
      return undefined;
    });

    renderGrid();
    fireEvent.click(screen.getByLabelText("Edit Binu Codeless"));
    fireEvent.change(screen.getByLabelText("Employee code"), {
      target: { value: "AF1" },
    });
    fireEvent.click(screen.getByText("Save"));

    await waitFor(() => {
      expect(screen.getByText("Employee code AF1 is already used")).toBeTruthy();
    });
  });

  it("vacates a seat from the edit modal via PATCH with user_id null", async () => {
    const mockFetch = stubFetch((url, init) => {
      if (url === "/api/admin/staff/positions/44" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return undefined;
    });

    renderGrid();
    fireEvent.click(screen.getByLabelText("Edit Asha Teacher"));
    fireEvent.click(
      screen.getByLabelText("Remove Physics assignment at JNV Adilabad - CoE")
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/staff/positions/44",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ user_id: null }),
        })
      );
    });
  });

  it("changes a person's org tier across all seats via PATCH /positions", async () => {
    const pmRow: StaffRosterRow[] = [
      {
        kind: "staff",
        recordId: 20,
        userId: 80,
        name: "Rupesh PM",
        email: "rupesh@avantifellows.org",
        employeeCode: "AF462",
        subjectName: null,
        staffType: "program_manager",
        designation: null,
        exitDate: null,
        seats: [
          { id: 99, centreId: 8, centreName: "JNV Adilabad - CoE", role: "pm" },
          { id: 100, centreId: 9, centreName: "JNV Nirmal - CoE", role: "pm" },
        ],
      },
    ];
    const mockFetch = stubFetch((url, init) => {
      if (url === "/api/admin/staff/positions" && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return undefined;
    });

    render(
      <StaffGrid
        initialRows={pmRow}
        initialSummary={SUMMARY}
        initialFilters={FILTERS}
      />
    );
    // The person appears under each of their centres; open from the first card.
    fireEvent.click(screen.getAllByLabelText("Edit Rupesh PM")[0]);
    const roleSelect = screen.getByLabelText("Edit role") as HTMLSelectElement;
    expect(roleSelect.value).toBe("pm");
    fireEvent.change(roleSelect, { target: { value: "spm" } });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/staff/positions",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ user_id: 80, role: "spm" }),
        })
      );
    });
  });

  it("requires arming before marking exited", async () => {
    const mockFetch = stubFetch((url, init) => {
      if (url.startsWith("/api/admin/staff/teachers/") && init?.method === "PATCH") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return undefined;
    });

    renderGrid();
    fireEvent.click(screen.getByLabelText("Edit Asha Teacher"));
    expect(screen.queryByText("Confirm exit")).toBeNull();
    fireEvent.click(screen.getByText("Mark exited…"));
    fireEvent.click(screen.getByText("Confirm exit"));

    await waitFor(() => {
      const exitCall = mockFetch.mock.calls.find(
        (call) => String(call[0]) === "/api/admin/staff/teachers/10"
      );
      expect(exitCall).toBeTruthy();
      expect(String((exitCall![1] as RequestInit).body)).toContain("exit_date");
    });
  });

  it("hides the Edit button for not-backfilled teachers", () => {
    stubFetch();
    render(
      <StaffGrid
        initialRows={[
          {
            ...ROWS[1],
            kind: "pending_teacher",
            name: "Pending Teacher",
          },
        ]}
        initialSummary={SUMMARY}
        initialFilters={FILTERS}
      />
    );
    expect(screen.queryByLabelText("Edit Pending Teacher")).toBeNull();
  });
});
