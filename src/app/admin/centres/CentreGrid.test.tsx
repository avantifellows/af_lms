import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CentreGrid from "./CentreGrid";
import type {
  CentreListFilters,
  CentreListRow,
  CentreListSummary,
  CentreOptionSet,
} from "@/lib/centres";

const optionSets: CentreOptionSet[] = [
  {
    id: 1,
    code: "type",
    label: "Centre Type",
    allowMulti: false,
    sortOrder: 1,
    options: [
      {
        id: 11,
        optionSetCode: "type",
        code: "coe",
        label: "CoE",
        sortOrder: 1,
        isActive: true,
        insertedAt: "",
        updatedAt: "",
      },
      {
        id: 12,
        optionSetCode: "type",
        code: "legacy",
        label: "Legacy Type",
        sortOrder: 2,
        isActive: false,
        insertedAt: "",
        updatedAt: "",
      },
    ],
  },
  {
    id: 2,
    code: "category",
    label: "Centre Category",
    allowMulti: false,
    sortOrder: 2,
    options: [
      {
        id: 21,
        optionSetCode: "category",
        code: "school",
        label: "School",
        sortOrder: 1,
        isActive: true,
        insertedAt: "",
        updatedAt: "",
      },
    ],
  },
  {
    id: 3,
    code: "sub_category",
    label: "Centre Sub-category",
    allowMulti: false,
    sortOrder: 3,
    options: [],
  },
  {
    id: 4,
    code: "stream",
    label: "Centre Stream",
    allowMulti: true,
    sortOrder: 4,
    options: [
      {
        id: 41,
        optionSetCode: "stream",
        code: "jee",
        label: "JEE",
        sortOrder: 1,
        isActive: true,
        insertedAt: "",
        updatedAt: "",
      },
      {
        id: 42,
        optionSetCode: "stream",
        code: "legacy_stream",
        label: "Legacy Stream",
        sortOrder: 2,
        isActive: false,
        insertedAt: "",
        updatedAt: "",
      },
    ],
  },
];

const filters: CentreListFilters = {
  search: "",
  searchTerms: [],
  active: "all",
  schoolLink: "all",
  typeCode: null,
  categoryCode: null,
  subCategoryCode: null,
  streamCode: null,
  isPhysical: "all",
};

const rows: CentreListRow[] = [
  {
    id: 1,
    name: "JNV Bhavnagar CoE",
    schoolId: 10,
    typeCode: "coe",
    typeLabel: "CoE",
    typeOptionActive: true,
    categoryCode: "school",
    categoryLabel: "School",
    categoryOptionActive: true,
    subCategoryCode: null,
    subCategoryLabel: null,
    subCategoryOptionActive: null,
    streamCodes: ["jee"],
    streams: [{ code: "jee", label: "JEE", isActive: true }],
    isPhysical: true,
    isActive: true,
    programId: 1,
    programName: "JNV CoE",
    insertedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    school: {
      id: 10,
      name: "JNV Bhavnagar",
      code: "SCH001",
      udiseCode: "24010100101",
      region: "West",
      state: "Gujarat",
      district: "Bhavnagar",
    },
  },
  {
    id: 2,
    name: "Bench Teacher Bucket",
    schoolId: null,
    typeCode: "legacy",
    typeLabel: "Legacy Type",
    typeOptionActive: false,
    categoryCode: null,
    categoryLabel: null,
    categoryOptionActive: null,
    subCategoryCode: null,
    subCategoryLabel: null,
    subCategoryOptionActive: null,
    streamCodes: [],
    streams: [],
    isPhysical: false,
    isActive: false,
    programId: null,
    programName: null,
    insertedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    school: null,
  },
];

const summary: CentreListSummary = {
  totalCentres: 2,
  activeCentres: 1,
  linkedCentres: 1,
  physicalCentres: 1,
};

function renderGrid({
  initialPagination = { page: 1, limit: 25, totalRows: 2, totalPages: 1 },
}: {
  initialPagination?: {
    page: number;
    limit: number;
    totalRows: number;
    totalPages: number;
  };
} = {}) {
  return render(
    <CentreGrid
      initialRows={rows}
      initialSummary={summary}
      initialFilters={filters}
      initialPagination={initialPagination}
      optionSets={optionSets}
    />
  );
}

describe("CentreGrid", () => {
  beforeEach(() => {
    // Default stub routes the on-mount /api/admin/programs fetch (and anything
    // else a test doesn't explicitly mock) to a benign response so the program
    // selector populates without interfering with per-test fetch expectations.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).startsWith("/api/admin/programs")) {
          return { ok: true, json: async () => ({ programs: [] }) } as Response;
        }
        return { ok: true, json: async () => ({}) } as Response;
      })
    );
    window.history.replaceState(null, "", "/admin/centres");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Centre cards with collapsed summary fields and expandable details", async () => {
    const user = userEvent.setup();
    renderGrid();

    expect(screen.getByRole("heading", { name: "Centres" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Centre" })).toBeInTheDocument();
    expect(screen.getByText("Total Centres")).toBeInTheDocument();
    expect(screen.getByText("Active Centres")).toBeInTheDocument();
    expect(screen.getByText("Centres linked to Schools")).toBeInTheDocument();
    expect(screen.getByText("Total Physical Centres")).toBeInTheDocument();

    const linkedToggle = screen.getByRole("button", {
      name: "Show details for JNV Bhavnagar CoE",
    });
    const linkedCard = linkedToggle.closest("li") as HTMLElement;
    expect(within(linkedCard).getByText("JNV Bhavnagar CoE")).toBeInTheDocument();
    expect(within(linkedCard).getByText("JNV Bhavnagar")).toBeInTheDocument();
    expect(within(linkedCard).getByText("CoE")).toBeInTheDocument();
    expect(within(linkedCard).getByText("School")).toBeInTheDocument();
    expect(within(linkedCard).getByText("Physical")).toBeInTheDocument();
    expect(within(linkedCard).getByText("Active")).toBeInTheDocument();
    // School metadata and streams stay behind the expand toggle
    expect(within(linkedCard).queryByText("SCH001")).not.toBeInTheDocument();
    expect(within(linkedCard).queryByText("JEE")).not.toBeInTheDocument();

    await user.click(linkedToggle);
    expect(within(linkedCard).getByText("SCH001")).toBeInTheDocument();
    expect(within(linkedCard).getByText("24010100101")).toBeInTheDocument();
    expect(within(linkedCard).getByText("West")).toBeInTheDocument();
    expect(within(linkedCard).getByText("Gujarat")).toBeInTheDocument();
    expect(within(linkedCard).getByText("Bhavnagar")).toBeInTheDocument();
    expect(within(linkedCard).getByText("JEE")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide details for JNV Bhavnagar CoE" })
    ).toBeInTheDocument();

    const unlinkedToggle = screen.getByRole("button", {
      name: "Show details for Bench Teacher Bucket",
    });
    const unlinkedCard = unlinkedToggle.closest("li") as HTMLElement;
    expect(within(unlinkedCard).getByText("Unlinked")).toBeInTheDocument();
    expect(within(unlinkedCard).getByText("Legacy Type")).toBeInTheDocument();
    expect(within(unlinkedCard).getByText("Inactive")).toBeInTheDocument();

    await user.click(unlinkedToggle);
    expect(
      within(unlinkedCard).getByText("No School linked to this Centre")
    ).toBeInTheDocument();
    expect(within(unlinkedCard).getByText("No streams")).toBeInTheDocument();
  });

  it("loads Centres through API-supported filters when filters are applied", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/admin/centres/search-suggestions")) {
        return { ok: true, json: async () => ({ suggestions: [] }) } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          filters: { ...filters, search: "bench", active: "false", schoolLink: "unlinked" },
          rows: [rows[1]],
          pagination: { page: 1, limit: 25, totalRows: 1, totalPages: 1 },
        }),
      } as Response;
    });
    renderGrid();

    await user.type(screen.getByLabelText("Search"), "bench");
    await user.selectOptions(screen.getByLabelText("Active"), "false");
    await user.selectOptions(screen.getByLabelText("School Link"), "unlinked");
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    const centreListCalls = mockFetch.mock.calls.filter(([input]) =>
      String(input).startsWith("/api/admin/centres?")
    );
    expect(centreListCalls).toHaveLength(1);
    const url = String(centreListCalls[0][0]);
    expect(url).toContain("/api/admin/centres?");
    expect(url).toContain("search=bench");
    expect(url).toContain("active=false");
    expect(url).toContain("school_link=unlinked");
    expect(url).not.toContain("type=");
    expect(await screen.findByText("Bench Teacher Bucket")).toBeInTheDocument();
    expect(screen.queryByText("JNV Bhavnagar CoE")).not.toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/centres");
    expect(window.location.search).toContain("search=bench");
    expect(window.location.search).toContain("active=false");
    expect(window.location.search).toContain("school_link=unlinked");
  });

  it("debounces search suggestions and applies checked suggestion terms", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/admin/centres/search-suggestions")) {
        return {
          ok: true,
          json: async () => ({
            suggestions: [
              {
                kind: "centre_name",
                value: "JNV Barwani",
                label: "JNV Barwani",
                detail: "Centre name",
              },
            ],
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          filters: { ...filters, search: "", searchTerms: ["JNV Barwani"] },
          summary,
          rows: [rows[0]],
          pagination: { page: 1, limit: 25, totalRows: 1, totalPages: 1 },
        }),
      } as Response;
    });
    renderGrid();

    await user.type(screen.getByLabelText("Search"), "bar");
    expect(await screen.findByText("JNV Barwani")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /JNV Barwani/ }));

    const centreListCall = mockFetch.mock.calls.find(([url]) =>
      String(url).startsWith("/api/admin/centres?")
    );
    expect(String(centreListCall?.[0])).toContain("search_terms=");
    expect(await screen.findByText("JNV Bhavnagar CoE")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/centres");
    expect(new URLSearchParams(window.location.search).get("search_terms")).toBe(
      "[\"JNV Barwani\"]"
    );
  });

  it("loads later Centre pages without resetting filters", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/admin/centres/search-suggestions")) {
        return { ok: true, json: async () => ({ suggestions: [] }) } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          filters: { ...filters, search: "bench" },
          rows: [rows[1]],
          pagination: { page: 2, limit: 25, totalRows: 54, totalPages: 3 },
        }),
      } as Response;
    });
    renderGrid({
      initialPagination: { page: 1, limit: 25, totalRows: 54, totalPages: 3 },
    });

    await user.type(screen.getByLabelText("Search"), "bench");
    await user.click(screen.getByRole("button", { name: "Next Centre page" }));

    const centreListCalls = mockFetch.mock.calls.filter(([input]) =>
      String(input).startsWith("/api/admin/centres?")
    );
    expect(centreListCalls).toHaveLength(1);
    const url = String(centreListCalls[0][0]);
    expect(url).toContain("search=bench");
    expect(url).toContain("page=2");
    expect(url).toContain("limit=25");
    expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByText(/Showing/)).toHaveTextContent("Showing 26-50 of 54");
    expect(window.location.pathname).toBe("/admin/centres");
    expect(window.location.search).toContain("search=bench");
    expect(window.location.search).toContain("page=2");
  });

  it("creates a Centre with active options and a School selected from search", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    const createdCentre: CentreListRow = {
      ...rows[0],
      id: 3,
      name: "New Jaipur Centre",
      schoolId: 50,
      updatedAt: "2026-02-01T00:00:00.000Z",
      school: {
        id: 50,
        name: "JNV Jaipur",
        code: "SCH050",
        udiseCode: "08010100101",
        region: "North",
        state: "Rajasthan",
        district: "Jaipur",
      },
    };
    mockFetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("/api/admin/programs")) {
        return { ok: true, json: async () => ({ programs: [] }) } as Response;
      }
      if (url.startsWith("/api/admin/centres/search-suggestions")) {
        return { ok: true, json: async () => ({ suggestions: [] }) } as Response;
      }
      if (url.startsWith("/api/admin/schools")) {
        return {
          ok: true,
          json: async () => [
            {
              id: 50,
              name: "JNV Jaipur",
              code: "SCH050",
              udise_code: "08010100101",
              region: "North",
              state: "Rajasthan",
              district: "Jaipur",
            },
          ],
        } as Response;
      }
      // POST /api/admin/centres
      return { ok: true, json: async () => ({ centre: createdCentre }) } as Response;
    });

    renderGrid();

    await user.click(screen.getByRole("button", { name: "New Centre" }));
    await user.type(screen.getByLabelText("Centre name"), "New Jaipur Centre");

    const modalTypeSelect = screen.getAllByLabelText("Type").at(-1) as HTMLSelectElement;
    expect(Array.from(modalTypeSelect.options).map((option) => option.text)).not.toContain(
      "Legacy Type (inactive)"
    );
    await user.selectOptions(modalTypeSelect, "coe");
    await user.click(screen.getByRole("checkbox", { name: "JEE" }));

    await user.type(screen.getByPlaceholderText("Search name, code, UDISE"), "080101");
    await user.click(await screen.findByRole("button", { name: /JNV Jaipur/ }));

    await user.click(screen.getByRole("checkbox", { name: "Physical Centre" }));
    await user.click(screen.getByRole("button", { name: "Save Centre" }));

    const schoolsCall = mockFetch.mock.calls.find(([input]) =>
      String(input).startsWith("/api/admin/schools")
    );
    expect(schoolsCall?.[0]).toBe("/api/admin/schools?scope=centres&q=080101");
    expect(schoolsCall?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    const postCall = mockFetch.mock.calls.find(
      ([input, init]) =>
        String(input) === "/api/admin/centres" &&
        (init as RequestInit | undefined)?.method === "POST"
    );
    expect(postCall?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "New Jaipur Centre",
          school_id: 50,
          type_code: "coe",
          category_code: null,
          sub_category_code: null,
          stream_codes: ["jee"],
          is_physical: true,
          is_active: true,
          program_id: null,
        }),
      })
    );
    expect(await screen.findByText("New Jaipur Centre")).toBeInTheDocument();
    expect(screen.getByText("JNV Jaipur")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show details for New Jaipur Centre" })
    );
    expect(screen.getByText("2026-02-01")).toBeInTheDocument();
  });

  it("edits and deactivates a Centre without offering hard delete", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    const updatedCentre: CentreListRow = {
      ...rows[0],
      name: "JNV Bhavnagar CoE Updated",
      schoolId: null,
      school: null,
      isActive: false,
      updatedAt: "2026-03-04T00:00:00.000Z",
    };
    mockFetch.mockImplementation(async (input) => {
      if (String(input).startsWith("/api/admin/programs")) {
        return { ok: true, json: async () => ({ programs: [] }) } as Response;
      }
      // PATCH /api/admin/centres/1
      return { ok: true, json: async () => ({ centre: updatedCentre }) } as Response;
    });
    renderGrid();

    const linkedCard = screen
      .getByRole("button", { name: "Show details for JNV Bhavnagar CoE" })
      .closest("li") as HTMLElement;
    await user.click(within(linkedCard).getByRole("button", { name: "Edit" }));

    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    const nameInput = screen.getByLabelText("Centre name");
    await user.clear(nameInput);
    await user.type(nameInput, "JNV Bhavnagar CoE Updated");
    await user.click(screen.getByRole("button", { name: "Unlink" }));
    await user.click(screen.getByRole("checkbox", { name: "Active Centre" }));
    await user.click(screen.getByRole("button", { name: "Save Centre" }));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/centres/1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          name: "JNV Bhavnagar CoE Updated",
          school_id: null,
          type_code: "coe",
          category_code: "school",
          sub_category_code: null,
          stream_codes: ["jee"],
          is_physical: true,
          is_active: false,
          program_id: 1,
        }),
      })
    );
    const updatedToggle = await screen.findByRole("button", {
      name: "Show details for JNV Bhavnagar CoE Updated",
    });
    const updatedCard = updatedToggle.closest("li") as HTMLElement;
    expect(within(updatedCard).getByText("Unlinked")).toBeInTheDocument();
    expect(within(updatedCard).getByText("Inactive")).toBeInTheDocument();

    await user.click(updatedToggle);
    expect(within(updatedCard).getByText("2026-03-04")).toBeInTheDocument();
  });

  it("keeps an existing inactive option visible when editing that Centre", async () => {
    const user = userEvent.setup();
    renderGrid();

    const legacyCard = screen
      .getByRole("button", { name: "Show details for Bench Teacher Bucket" })
      .closest("li") as HTMLElement;
    await user.click(within(legacyCard).getByRole("button", { name: "Edit" }));

    const modalTypeSelect = screen.getAllByLabelText("Type").at(-1) as HTMLSelectElement;
    expect(Array.from(modalTypeSelect.options).map((option) => option.text)).toContain(
      "Legacy Type (inactive)"
    );
    expect(modalTypeSelect).toHaveValue("legacy");
  });

  it("shows API validation failures without closing the form", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockImplementation(async (input) => {
      if (String(input).startsWith("/api/admin/programs")) {
        return { ok: true, json: async () => ({ programs: [] }) } as Response;
      }
      // POST /api/admin/centres
      return {
        ok: false,
        json: async () => ({
          error: "Invalid Centre payload",
          fields: { name: "Centre name is required" },
        }),
      } as Response;
    });
    renderGrid();

    await user.click(screen.getByRole("button", { name: "New Centre" }));
    await user.click(screen.getByRole("button", { name: "Save Centre" }));

    expect(await screen.findByText("Invalid Centre payload")).toBeInTheDocument();
    expect(screen.getByText("Centre name is required")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New Centre" })).toBeInTheDocument();
  });
});
