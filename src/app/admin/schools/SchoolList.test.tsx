import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SchoolList from "./SchoolList";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleSchools = [
  {
    id: 1,
    code: "SCH001",
    name: "Delhi Public School",
    region: "North",
    program_ids: [1, 2],
  },
  {
    id: 2,
    code: "SCH002",
    name: "Bangalore Academy",
    region: "South",
    program_ids: [64],
  },
  {
    id: 3,
    code: "SCH003",
    name: "Mumbai International",
    region: "West",
    program_ids: null,
  },
  {
    id: 4,
    code: "SCH004",
    name: "Chennai School",
    region: "",
    program_ids: [1],
  },
];

function renderSchoolList(
  overrides: { initialSchools?: typeof sampleSchools } = {}
) {
  const props = { initialSchools: sampleSchools, ...overrides };
  return render(<SchoolList {...props} />);
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Rendering
// ===========================================================================

describe("SchoolList", () => {
  describe("initial rendering", () => {
    it("renders all schools in the table", () => {
      renderSchoolList();
      expect(screen.getByText("Delhi Public School")).toBeInTheDocument();
      expect(screen.getByText("Bangalore Academy")).toBeInTheDocument();
      expect(screen.getByText("Mumbai International")).toBeInTheDocument();
      expect(screen.getByText("Chennai School")).toBeInTheDocument();
    });

    it("displays school codes", () => {
      renderSchoolList();
      expect(screen.getByText("SCH001")).toBeInTheDocument();
      expect(screen.getByText("SCH002")).toBeInTheDocument();
    });

    it("displays school regions and dash for empty region", () => {
      renderSchoolList();
      expect(screen.getByText("North")).toBeInTheDocument();
      expect(screen.getByText("South")).toBeInTheDocument();
      // Empty region should show dash
      const dashes = screen.getAllByText("-");
      expect(dashes.length).toBeGreaterThanOrEqual(1);
    });

    it("displays program badges for schools with programs", () => {
      renderSchoolList();
      // Delhi Public School has CoE + Nodal
      expect(screen.getAllByText("CoE").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("Nodal").length).toBeGreaterThanOrEqual(1);
      // Bangalore Academy has NVS
      expect(screen.getAllByText("NVS").length).toBeGreaterThanOrEqual(1);
    });

    it("displays 'No programs' for schools without programs", () => {
      renderSchoolList();
      expect(screen.getByText("No programs")).toBeInTheDocument();
    });

    it("renders Edit buttons for each school", () => {
      renderSchoolList();
      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      expect(editButtons).toHaveLength(4);
    });
  });

  // =========================================================================
  // Stats
  // =========================================================================

  describe("stats display", () => {
    it("displays correct program counts", () => {
      renderSchoolList();

      // Check stats by finding the label and then checking sibling count
      const coeLabel = screen.getByText("CoE Schools");
      const coeCard = coeLabel.closest("div.bg-white")!;
      expect(within(coeCard).getByText("2")).toBeInTheDocument();

      const nodalLabel = screen.getByText("Nodal Schools");
      const nodalCard = nodalLabel.closest("div.bg-white")!;
      expect(within(nodalCard).getByText("1")).toBeInTheDocument();

      const nvsLabel = screen.getByText("NVS Schools");
      const nvsCard = nvsLabel.closest("div.bg-white")!;
      expect(within(nvsCard).getByText("1")).toBeInTheDocument();

      const noneLabel = screen.getByText("No Programs");
      const noneCard = noneLabel.closest("div.bg-white")!;
      expect(within(noneCard).getByText("1")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Search / Filter
  // =========================================================================

  describe("search functionality", () => {
    it("filters schools by name (case-insensitive)", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const searchInput = screen.getByPlaceholderText(
        "Search by name or code..."
      );
      await user.type(searchInput, "delhi");

      expect(screen.getByText("Delhi Public School")).toBeInTheDocument();
      expect(screen.queryByText("Bangalore Academy")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Mumbai International")
      ).not.toBeInTheDocument();
    });

    it("filters schools by code", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const searchInput = screen.getByPlaceholderText(
        "Search by name or code..."
      );
      await user.type(searchInput, "SCH002");

      expect(screen.getByText("Bangalore Academy")).toBeInTheDocument();
      expect(
        screen.queryByText("Delhi Public School")
      ).not.toBeInTheDocument();
    });

    it("updates the showing count when filtering", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      expect(screen.getByText("Showing 4 of 4 schools")).toBeInTheDocument();

      const searchInput = screen.getByPlaceholderText(
        "Search by name or code..."
      );
      await user.type(searchInput, "delhi");

      expect(screen.getByText("Showing 1 of 4 schools")).toBeInTheDocument();
    });

    it("shows empty table when search matches nothing", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const searchInput = screen.getByPlaceholderText(
        "Search by name or code..."
      );
      await user.type(searchInput, "nonexistent");

      expect(screen.getByText("Showing 0 of 4 schools")).toBeInTheDocument();
      // Table headers still present but no data rows
      expect(screen.queryByText("Delhi Public School")).not.toBeInTheDocument();
    });
  });

  describe("program filter", () => {
    it("filters by CoE program", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "1");

      expect(screen.getByText("Delhi Public School")).toBeInTheDocument();
      expect(screen.getByText("Chennai School")).toBeInTheDocument();
      expect(screen.queryByText("Bangalore Academy")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Mumbai International")
      ).not.toBeInTheDocument();
      expect(screen.getByText("Showing 2 of 4 schools")).toBeInTheDocument();
    });

    it("filters by NVS program", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "64");

      expect(screen.getByText("Bangalore Academy")).toBeInTheDocument();
      expect(
        screen.queryByText("Delhi Public School")
      ).not.toBeInTheDocument();
      expect(screen.getByText("Showing 1 of 4 schools")).toBeInTheDocument();
    });

    it("shows all schools when filter reset to All Programs", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const select = screen.getByRole("combobox");
      await user.selectOptions(select, "64");
      expect(screen.getByText("Showing 1 of 4 schools")).toBeInTheDocument();

      await user.selectOptions(select, "all");
      expect(screen.getByText("Showing 4 of 4 schools")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Empty state
  // =========================================================================

  describe("empty state", () => {
    it("renders with no schools", () => {
      renderSchoolList({ initialSchools: [] });
      expect(screen.getByText("Showing 0 of 0 schools")).toBeInTheDocument();
    });
  });

  // =========================================================================
  // Edit Modal
  // =========================================================================

  describe("edit modal", () => {
    it("opens modal with correct school info when Edit is clicked", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]); // Edit Delhi Public School

      expect(screen.getByText("Edit Programs")).toBeInTheDocument();
      // School name appears in both table and modal — use getAllByText
      expect(screen.getAllByText("Delhi Public School").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("(SCH001)")).toBeInTheDocument();
    });

    it("pre-selects existing programs in modal checkboxes", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]); // Delhi has CoE (1) + Nodal (2)

      const checkboxes = screen.getAllByRole("checkbox");
      // CoE = checked, Nodal = checked, NVS = unchecked
      expect(checkboxes[0]).toBeChecked(); // CoE
      expect(checkboxes[1]).toBeChecked(); // Nodal
      expect(checkboxes[2]).not.toBeChecked(); // NVS
    });

    it("pre-selects no programs for school with null program_ids", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[2]); // Mumbai International (null programs)

      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[0]).not.toBeChecked();
      expect(checkboxes[1]).not.toBeChecked();
      expect(checkboxes[2]).not.toBeChecked();
    });

    it("toggles program checkboxes on/off", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]); // Delhi has CoE (1) + Nodal (2)

      const checkboxes = screen.getAllByRole("checkbox");
      // Uncheck CoE
      await user.click(checkboxes[0]);
      expect(checkboxes[0]).not.toBeChecked();

      // Check NVS
      await user.click(checkboxes[2]);
      expect(checkboxes[2]).toBeChecked();

      // Re-check CoE
      await user.click(checkboxes[0]);
      expect(checkboxes[0]).toBeChecked();
    });

    it("closes modal on Cancel click", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);
      expect(screen.getByText("Edit Programs")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /cancel/i }));
      expect(screen.queryByText("Edit Programs")).not.toBeInTheDocument();
    });

    it("closes modal on backdrop click", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);
      expect(screen.getByText("Edit Programs")).toBeInTheDocument();

      // The backdrop is the div with bg-black bg-opacity-30
      const backdrop = document.querySelector(".bg-opacity-30");
      expect(backdrop).not.toBeNull();
      await user.click(backdrop!);
      expect(screen.queryByText("Edit Programs")).not.toBeInTheDocument();
    });

    it("closes modal on X button click", async () => {
      const user = userEvent.setup();
      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);
      expect(screen.getByText("Edit Programs")).toBeInTheDocument();

      // The X button is inside the modal header, find the SVG close button
      const modal = screen.getByText("Edit Programs").closest("div")!;
      const closeButton = within(modal).getAllByRole("button")[0]; // First button in modal header area
      await user.click(closeButton);
      expect(screen.queryByText("Edit Programs")).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Save
  // =========================================================================

  describe("save changes", () => {
    it("saves program changes and updates local state", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]); // Delhi Public School

      // Toggle NVS on
      const checkboxes = screen.getAllByRole("checkbox");
      await user.click(checkboxes[2]);

      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );

      expect(mockFetch).toHaveBeenCalledWith("/api/admin/schools/SCH001", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ program_ids: [1, 2, 64] }),
      });

      // Modal should close
      expect(screen.queryByText("Edit Programs")).not.toBeInTheDocument();
    });

    it("shows 'Saving...' during save", async () => {
      const user = userEvent.setup();
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
      );

      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);

      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );

      expect(
        screen.getByRole("button", { name: /saving\.\.\./i })
      ).toBeDisabled();

      resolveFetch({ ok: true, json: async () => ({}) });
    });

    it("displays server error message on failed save", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Unauthorized access" }),
      });

      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);

      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );

      expect(
        await screen.findByText("Unauthorized access")
      ).toBeInTheDocument();
      // Modal should remain open
      expect(screen.getByText("Edit Programs")).toBeInTheDocument();
    });

    it("displays generic error when response has no error message", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);

      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );

      expect(await screen.findByText("Failed to save")).toBeInTheDocument();
    });

    it("handles network error on save", async () => {
      const user = userEvent.setup();
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);

      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );

      expect(await screen.findByText("Network error")).toBeInTheDocument();
    });

    it("handles non-Error thrown during save", async () => {
      const user = userEvent.setup();
      mockFetch.mockRejectedValueOnce("unexpected");

      renderSchoolList();

      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);

      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );

      expect(
        await screen.findByText("An error occurred")
      ).toBeInTheDocument();
    });

    it("clears error when modal is re-opened", async () => {
      const user = userEvent.setup();
      mockFetch.mockRejectedValueOnce(new Error("Save failed"));

      renderSchoolList();

      // Trigger an error
      const editButtons = screen.getAllByRole("button", { name: /edit/i });
      await user.click(editButtons[0]);
      await user.click(
        screen.getByRole("button", { name: /save changes/i })
      );
      expect(await screen.findByText("Save failed")).toBeInTheDocument();

      // Close and re-open
      await user.click(screen.getByRole("button", { name: /cancel/i }));
      await user.click(editButtons[0]);
      expect(screen.queryByText("Save failed")).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Unknown program ID fallback
  // =========================================================================

  describe("unknown program ID", () => {
    it("displays fallback label and styling for unknown program IDs", () => {
      renderSchoolList({
        initialSchools: [
          {
            id: 99,
            code: "SCH099",
            name: "Test School",
            region: "East",
            program_ids: [999],
          },
        ],
      });

      expect(screen.getByText("Program 999")).toBeInTheDocument();
    });
  });
});
