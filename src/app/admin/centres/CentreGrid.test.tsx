import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CentreGrid from "./CentreGrid";
import type {
  CentreListFilters,
  CentreListRow,
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
    insertedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-03T00:00:00.000Z",
    school: null,
  },
];

function renderGrid() {
  return render(
    <CentreGrid
      initialRows={rows}
      initialFilters={filters}
      initialPagination={{ page: 1, limit: 25, totalRows: 2, totalPages: 1 }}
      optionSets={optionSets}
    />
  );
}

describe("CentreGrid", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Centre rows with linked School metadata and option labels", () => {
    renderGrid();

    expect(screen.getByRole("heading", { name: "Centres" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New Centre" })).toBeInTheDocument();
    for (const header of [
      "Centre",
      "Linked School",
      "School Code",
      "UDISE",
      "Region",
      "State",
      "District",
      "Type",
      "Category",
      "Sub-category",
      "Centre Streams",
      "Physical",
      "Active",
      "Updated",
      "Actions",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }

    const linkedRow = screen.getByRole("row", { name: /JNV Bhavnagar CoE/ });
    expect(within(linkedRow).getByText("JNV Bhavnagar")).toBeInTheDocument();
    expect(within(linkedRow).getByText("SCH001")).toBeInTheDocument();
    expect(within(linkedRow).getByText("24010100101")).toBeInTheDocument();
    expect(within(linkedRow).getByText("West")).toBeInTheDocument();
    expect(within(linkedRow).getByText("Gujarat")).toBeInTheDocument();
    expect(within(linkedRow).getByText("Bhavnagar")).toBeInTheDocument();
    expect(within(linkedRow).getByText("CoE")).toBeInTheDocument();
    expect(within(linkedRow).getByText("School")).toBeInTheDocument();
    expect(within(linkedRow).getByText("JEE")).toBeInTheDocument();
    expect(within(linkedRow).getByText("Physical")).toBeInTheDocument();
    expect(within(linkedRow).getByText("Active")).toBeInTheDocument();

    const unlinkedRow = screen.getByRole("row", { name: /Bench Teacher Bucket/ });
    expect(within(unlinkedRow).getByText("Unlinked")).toBeInTheDocument();
    expect(within(unlinkedRow).getAllByText("-").length).toBeGreaterThanOrEqual(4);
    expect(within(unlinkedRow).getByText("Legacy Type")).toBeInTheDocument();
    expect(within(unlinkedRow).getByText("No streams")).toBeInTheDocument();
    expect(within(unlinkedRow).getByText("Inactive")).toBeInTheDocument();
  });

  it("loads Centres through API-supported filters when filters are applied", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        filters: { ...filters, search: "bench", active: "false", schoolLink: "unlinked" },
        rows: [rows[1]],
        pagination: { page: 1, limit: 25, totalRows: 1, totalPages: 1 },
      }),
    } as Response);
    renderGrid();

    await user.type(screen.getByLabelText("Search"), "bench");
    await user.selectOptions(screen.getByLabelText("Active"), "false");
    await user.selectOptions(screen.getByLabelText("School Link"), "unlinked");
    await user.click(screen.getByRole("button", { name: /Apply/ }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = String(mockFetch.mock.calls[0][0]);
    expect(url).toContain("/api/admin/centres?");
    expect(url).toContain("search=bench");
    expect(url).toContain("active=false");
    expect(url).toContain("school_link=unlinked");
    expect(url).not.toContain("type=");
    expect(await screen.findByText("Bench Teacher Bucket")).toBeInTheDocument();
    expect(screen.queryByText("JNV Bhavnagar CoE")).not.toBeInTheDocument();
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
    mockFetch
      .mockResolvedValueOnce({
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
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ centre: createdCentre }),
      } as Response);

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
    await user.click(screen.getAllByRole("button", { name: /Search/ }).at(-1)!);
    await user.click(await screen.findByRole("button", { name: /JNV Jaipur/ }));

    await user.click(screen.getByRole("checkbox", { name: "Physical Centre" }));
    await user.click(screen.getByRole("button", { name: "Save Centre" }));

    expect(mockFetch).toHaveBeenNthCalledWith(1, "/api/admin/schools?q=080101");
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "/api/admin/centres",
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
        }),
      })
    );
    expect(await screen.findByText("New Jaipur Centre")).toBeInTheDocument();
    expect(screen.getByText("JNV Jaipur")).toBeInTheDocument();
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
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ centre: updatedCentre }),
    } as Response);
    renderGrid();

    const linkedRow = screen.getByRole("row", { name: /JNV Bhavnagar CoE/ });
    await user.click(within(linkedRow).getByRole("button", { name: "Edit" }));

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
        }),
      })
    );
    const updatedRow = await screen.findByRole("row", {
      name: /JNV Bhavnagar CoE Updated/,
    });
    expect(within(updatedRow).getByText("Unlinked")).toBeInTheDocument();
    expect(within(updatedRow).getByText("Inactive")).toBeInTheDocument();
    expect(within(updatedRow).getByText("2026-03-04")).toBeInTheDocument();
  });

  it("keeps an existing inactive option visible when editing that Centre", async () => {
    const user = userEvent.setup();
    renderGrid();

    const legacyRow = screen.getByRole("row", { name: /Bench Teacher Bucket/ });
    await user.click(within(legacyRow).getByRole("button", { name: "Edit" }));

    const modalTypeSelect = screen.getAllByLabelText("Type").at(-1) as HTMLSelectElement;
    expect(Array.from(modalTypeSelect.options).map((option) => option.text)).toContain(
      "Legacy Type (inactive)"
    );
    expect(modalTypeSelect).toHaveValue("legacy");
  });

  it("shows API validation failures without closing the form", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Invalid Centre payload",
        fields: { name: "Centre name is required" },
      }),
    } as Response);
    renderGrid();

    await user.click(screen.getByRole("button", { name: "New Centre" }));
    await user.click(screen.getByRole("button", { name: "Save Centre" }));

    expect(await screen.findByText("Invalid Centre payload")).toBeInTheDocument();
    expect(screen.getByText("Centre name is required")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New Centre" })).toBeInTheDocument();
  });
});
