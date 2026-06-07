import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import CentreOptionConfig from "./CentreOptionConfig";
import type { CentreOptionSet } from "@/lib/centres";

const optionSets: CentreOptionSet[] = [
  {
    id: 1,
    code: "type",
    label: "Centre Type",
    allowMulti: false,
    sortOrder: 1,
    options: [
      option(11, "type", "coe", "CoE", 1, true),
      option(12, "type", "legacy", "Legacy Type", 2, false),
    ],
  },
  {
    id: 2,
    code: "category",
    label: "Centre Category",
    allowMulti: false,
    sortOrder: 2,
    options: [option(21, "category", "school", "School", 1, true)],
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
      option(41, "stream", "jee", "JEE", 1, true),
      option(42, "stream", "foundation", "Math Foundation", 2, false),
    ],
  },
];

function option(
  id: number,
  optionSetCode: CentreOptionSet["code"],
  code: string,
  label: string,
  sortOrder: number,
  isActive: boolean
) {
  return {
    id,
    optionSetCode,
    code,
    label,
    sortOrder,
    isActive,
    insertedAt: "",
    updatedAt: "",
  };
}

function renderConfig() {
  return render(<CentreOptionConfig initialOptionSets={optionSets} />);
}

describe("CentreOptionConfig", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders fixed Centre option sets and keeps inactive options visible", () => {
    renderConfig();

    for (const name of [
      "Centre Type",
      "Centre Category",
      "Centre Sub-category",
      "Centre Stream",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    }

    expect(screen.queryByRole("button", { name: /New option set/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete option set/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Program/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Exam Track/i)).not.toBeInTheDocument();

    const typeSection = sectionFor("Centre Type");
    expect(within(typeSection).getByDisplayValue("coe")).toBeDisabled();
    expect(within(typeSection).getByDisplayValue("Legacy Type")).toBeInTheDocument();
    expect(within(typeSection).getByText("Inactive")).toBeInTheDocument();

    const streamSection = sectionFor("Centre Stream");
    expect(within(streamSection).getByDisplayValue("foundation")).toBeDisabled();
    expect(within(streamSection).getByText("Inactive")).toBeInTheDocument();
  });

  it("creates a new option with a suggested code that admins can confirm", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        option: {
          id: 31,
          optionSetCode: "category",
          code: "residential",
          label: "Residential Model",
          sortOrder: 2,
          isActive: true,
          insertedAt: "",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      }),
    } as Response);
    renderConfig();

    const categorySection = sectionFor("Centre Category");
    await user.click(within(categorySection).getByRole("button", { name: "New option" }));
    await user.type(within(categorySection).getByLabelText("New Centre Category label"), "Residential Model");

    const codeInput = within(categorySection).getByLabelText("New Centre Category code");
    expect(codeInput).toHaveValue("residential_model");
    await user.clear(codeInput);
    await user.type(codeInput, "residential");
    await user.click(within(categorySection).getByRole("button", { name: "Save new option" }));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/centres/options",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          option_set_code: "category",
          code: "residential",
          label: "Residential Model",
          sort_order: 2,
          is_active: true,
        }),
      })
    );
    expect(await within(categorySection).findByDisplayValue("residential")).toBeDisabled();
    expect(within(categorySection).getByDisplayValue("Residential Model")).toBeInTheDocument();
    expect(within(categorySection).getByText("2026-04-01")).toBeInTheDocument();
  });

  it("edits option label, order, and active state without changing the code", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        option: {
          id: 21,
          optionSetCode: "category",
          code: "school",
          label: "Partner School",
          sortOrder: 5,
          isActive: false,
          insertedAt: "",
          updatedAt: "2026-04-02T00:00:00.000Z",
        },
      }),
    } as Response);
    renderConfig();

    const categorySection = sectionFor("Centre Category");
    expect(within(categorySection).getByDisplayValue("school")).toBeDisabled();

    const labelInput = within(categorySection).getByLabelText("school label");
    await user.clear(labelInput);
    await user.type(labelInput, "Partner School");

    const orderInput = within(categorySection).getByLabelText("school order");
    await user.clear(orderInput);
    await user.type(orderInput, "5");
    await user.click(within(categorySection).getByRole("checkbox", { name: "Active" }));
    await user.click(within(categorySection).getByRole("button", { name: "Save" }));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/admin/centres/options/21",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          label: "Partner School",
          sort_order: 5,
          is_active: false,
        }),
      })
    );
    expect(await within(categorySection).findByDisplayValue("Partner School")).toBeInTheDocument();
    expect(within(categorySection).getByDisplayValue("school")).toBeDisabled();
    expect(within(categorySection).getByDisplayValue("5")).toBeInTheDocument();
    expect(within(categorySection).getByText("Inactive")).toBeInTheDocument();
    expect(within(categorySection).getByText("2026-04-02")).toBeInTheDocument();
  });

  it("shows create validation errors from the API without closing the new option row", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Invalid Centre option create payload",
        fields: {
          code: "Option code is required",
          label: "Option label is required",
        },
      }),
    } as Response);
    renderConfig();

    const streamSection = sectionFor("Centre Stream");
    await user.click(within(streamSection).getByRole("button", { name: "New option" }));
    await user.click(within(streamSection).getByRole("button", { name: "Save new option" }));

    expect(await within(streamSection).findByText("Invalid Centre option create payload")).toBeInTheDocument();
    expect(within(streamSection).getByText("Option code is required")).toBeInTheDocument();
    expect(within(streamSection).getByText("Option label is required")).toBeInTheDocument();
    expect(within(streamSection).getByLabelText("New Centre Stream label")).toBeInTheDocument();
  });

  it("shows save errors for existing options without changing the visible option", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "Invalid Centre option edit payload",
        fields: { label: "Option label is required" },
      }),
    } as Response);
    renderConfig();

    const categorySection = sectionFor("Centre Category");
    const labelInput = within(categorySection).getByLabelText("school label");
    await user.clear(labelInput);
    await user.click(within(categorySection).getByRole("button", { name: "Save" }));

    expect(await within(categorySection).findByText("Invalid Centre option edit payload")).toBeInTheDocument();
    expect(within(categorySection).getByText("Option label is required")).toBeInTheDocument();
    expect(within(categorySection).getByDisplayValue("school")).toBeDisabled();
  });
});

function sectionFor(heading: string) {
  return screen.getByRole("heading", { name: heading }).closest("section")!;
}
