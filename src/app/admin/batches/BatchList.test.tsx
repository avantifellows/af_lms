import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import BatchList from "./BatchList";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const programs = [
  { id: 1, name: "Program Alpha" },
  { id: 2, name: "Program Beta" },
];

const sampleBatches = [
  {
    id: 10,
    name: "Batch A",
    batch_id: "BA-001",
    program_id: 1,
    metadata: { stream: "engineering", grade: 11 },
  },
  {
    id: 20,
    name: "Batch B",
    batch_id: "BA-002",
    program_id: 1,
    metadata: null,
  },
];

const defaultProps = {
  initialBatches: sampleBatches,
  programs,
  initialProgramId: 1,
};

function renderBatchList(
  overrides: Partial<typeof defaultProps> = {}
) {
  const props = { ...defaultProps, ...overrides };
  return render(<BatchList {...props} />);
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

// ---------------------------------------------------------------------------
// Initial rendering
// ---------------------------------------------------------------------------

describe("BatchList — initial rendering", () => {
  it("renders the program selector with initial program selected", () => {
    renderBatchList();
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("1");
  });

  it("renders all program options", () => {
    renderBatchList();
    const options = screen.getAllByRole("option");
    // Program options only (no grade/stream selects visible initially)
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Program Alpha");
    expect(options[1]).toHaveTextContent("Program Beta");
  });

  it("renders batch names and IDs in the table", () => {
    renderBatchList();
    expect(screen.getByText("Batch A")).toBeInTheDocument();
    expect(screen.getByText("BA-001")).toBeInTheDocument();
    expect(screen.getByText("Batch B")).toBeInTheDocument();
    expect(screen.getByText("BA-002")).toBeInTheDocument();
  });

  it("displays stream label for batch with metadata", () => {
    renderBatchList();
    expect(screen.getByText("Engineering")).toBeInTheDocument();
  });

  it("displays grade label for batch with metadata", () => {
    renderBatchList();
    expect(screen.getByText("Grade 11")).toBeInTheDocument();
  });

  it("displays 'Not set' for batch without metadata", () => {
    renderBatchList();
    // Batch B has null metadata → two "Not set" badges (stream + grade)
    const notSetBadges = screen.getAllByText("Not set");
    expect(notSetBadges.length).toBeGreaterThanOrEqual(2);
  });

  it("renders Edit buttons for each batch", () => {
    renderBatchList();
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    expect(editButtons).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty batch list
// ---------------------------------------------------------------------------

describe("BatchList — empty state", () => {
  it("shows empty message when no batches", () => {
    renderBatchList({ initialBatches: [] });
    expect(
      screen.getByText("No batches found for Program Alpha")
    ).toBeInTheDocument();
  });

  it("shows program name in empty message based on selected program", () => {
    renderBatchList({ initialBatches: [], initialProgramId: 2 });
    expect(
      screen.getByText("No batches found for Program Beta")
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Program change (fetches new batches)
// ---------------------------------------------------------------------------

describe("BatchList — program change", () => {
  it("fetches batches when program is changed", async () => {
    const user = userEvent.setup();
    const newBatches = [
      {
        id: 30,
        name: "Batch C",
        batch_id: "BC-001",
        program_id: 2,
        metadata: { stream: "medical", grade: 12 },
      },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => newBatches,
    });

    renderBatchList();

    await user.selectOptions(screen.getByRole("combobox"), "2");

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/batches?program_id=2");
    });

    await waitFor(() => {
      expect(screen.getByText("Batch C")).toBeInTheDocument();
    });
    expect(screen.getByText("BC-001")).toBeInTheDocument();
  });

  it("shows loading state while fetching", async () => {
    const user = userEvent.setup();
    // Never resolve to keep loading
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    renderBatchList();

    await user.selectOptions(screen.getByRole("combobox"), "2");

    expect(screen.getByText("Loading batches...")).toBeInTheDocument();
  });

  it("shows error on fetch failure (non-ok response)", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: false });

    renderBatchList();

    await user.selectOptions(screen.getByRole("combobox"), "2");

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch batches")).toBeInTheDocument();
    });
  });

  it("shows error on network error", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    renderBatchList();

    await user.selectOptions(screen.getByRole("combobox"), "2");

    await waitFor(() => {
      expect(screen.getByText("Failed to fetch batches")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Inline edit mode
// ---------------------------------------------------------------------------

describe("BatchList — edit mode", () => {
  it("enters edit mode when Edit is clicked", async () => {
    const user = userEvent.setup();
    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]); // Edit Batch A

    // Should show Save / Cancel buttons
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("pre-fills stream select with current metadata value", async () => {
    const user = userEvent.setup();
    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]); // Batch A has stream: "engineering"

    // Find the stream select — the comboboxes now include program + stream + grade
    const selects = screen.getAllByRole("combobox");
    // selects: [program, stream, grade]
    const streamSelect = selects[1];
    expect(streamSelect).toHaveValue("engineering");
  });

  it("pre-fills grade select with current metadata value", async () => {
    const user = userEvent.setup();
    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]); // Batch A has grade: 11

    const selects = screen.getAllByRole("combobox");
    const gradeSelect = selects[2];
    expect(gradeSelect).toHaveValue("11");
  });

  it("defaults to empty/0 for batch with no metadata", async () => {
    const user = userEvent.setup();
    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[1]); // Batch B has null metadata

    const selects = screen.getAllByRole("combobox");
    const streamSelect = selects[1];
    const gradeSelect = selects[2];
    expect(streamSelect).toHaveValue("");
    expect(gradeSelect).toHaveValue("0");
  });

  it("cancels edit mode", async () => {
    const user = userEvent.setup();
    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Should be back to view mode — Edit buttons visible again
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Save" })
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Save edit
// ---------------------------------------------------------------------------

describe("BatchList — save edit", () => {
  it("saves edited metadata successfully", async () => {
    const user = userEvent.setup();
    const updatedBatch = {
      id: 10,
      name: "Batch A",
      batch_id: "BA-001",
      program_id: 1,
      metadata: { stream: "medical", grade: 12 },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => updatedBatch,
    });

    renderBatchList();

    // Enter edit mode for Batch A
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    // Change stream to "medical"
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "medical");

    // Change grade to 12
    await user.selectOptions(selects[2], "12");

    // Save
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/batches/10", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { stream: "medical", grade: 12 } }),
      });
    });

    // Should exit edit mode
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Save" })
      ).not.toBeInTheDocument();
    });
  });

  it("sends only non-empty metadata fields", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...sampleBatches[1],
        metadata: { stream: "ca" },
      }),
    });

    renderBatchList();

    // Edit Batch B (null metadata)
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[1]);

    // Set stream but leave grade at 0 ("Not set")
    const selects = screen.getAllByRole("combobox");
    await user.selectOptions(selects[1], "ca");

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/batches/20", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metadata: { stream: "ca" } }),
      });
    });
  });

  it("shows 'Saving...' while save is in progress", async () => {
    const user = userEvent.setup();
    mockFetch.mockReturnValueOnce(new Promise(() => {})); // Never resolve

    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Saving...")).toBeInTheDocument();
  });

  it("shows error on save failure with server error message", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Batch not found" }),
    });

    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Batch not found")).toBeInTheDocument();
    });
  });

  it("shows generic error when server returns no error field", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });

    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update batch")
      ).toBeInTheDocument();
    });
  });

  it("shows error on network error during save", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update batch")
      ).toBeInTheDocument();
    });
  });

  it("clears previous error when entering edit mode", async () => {
    const user = userEvent.setup();

    // First: trigger an error
    mockFetch.mockRejectedValueOnce(new Error("fail"));
    renderBatchList();

    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons[0]);
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(
        screen.getByText("Failed to update batch")
      ).toBeInTheDocument();
    });

    // Now click Edit on Batch B — error should be cleared
    // Need to wait for saving to finish (setSaving(false) in finally)
    await waitFor(() => {
      // After save error, edit mode remains. Cancel first.
    });

    // Cancel current edit
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    // Click edit on another batch — error should clear
    const editButtons2 = screen.getAllByRole("button", { name: "Edit" });
    await user.click(editButtons2[1]);

    expect(
      screen.queryByText("Failed to update batch")
    ).not.toBeInTheDocument();
  });

  it("updates displayed stream label after unknown stream value", () => {
    // Test a stream value not in STREAM_OPTIONS — fallback to raw value
    const batchWithUnknownStream = [
      {
        id: 100,
        name: "Batch X",
        batch_id: "BX-001",
        program_id: 1,
        metadata: { stream: "unknown_stream" },
      },
    ];
    renderBatchList({ initialBatches: batchWithUnknownStream });
    // Should display the raw stream value as fallback
    expect(screen.getByText("unknown_stream")).toBeInTheDocument();
  });
});
