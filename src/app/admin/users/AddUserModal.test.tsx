import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddUserModal from "./AddUserModal";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const regions = ["North", "South", "East", "West"];

const defaultProps = {
  user: null,
  regions,
  onClose: vi.fn(),
  onSave: vi.fn(),
};

const editUser = {
  id: 42,
  email: "existing@example.com",
  level: 2,
  role: "program_manager",
  school_codes: null,
  regions: ["North"],
  program_ids: [1, 2],
  read_only: false,
};

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, onClose: vi.fn(), onSave: vi.fn(), ...overrides };
  const result = render(<AddUserModal {...props} />);
  return { ...result, props };
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
// Create mode rendering
// ---------------------------------------------------------------------------

describe("AddUserModal — create mode", () => {
  it("renders 'Add User' title when no user prop", () => {
    renderModal();
    // Title text appears in the heading
    expect(screen.getByRole("heading", { name: "Add User" })).toBeInTheDocument();
  });

  it("renders email input that is editable", () => {
    renderModal();
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    expect(emailInput).not.toBeDisabled();
    expect(emailInput.value).toBe("");
  });

  it("renders submit button as 'Add User'", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Add User" })).toBeInTheDocument();
  });

  it("renders Cancel button", () => {
    renderModal();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("renders role selector with default 'teacher'", () => {
    renderModal();
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(select.value).toBe("teacher");
  });

  it("renders permission level selector with default '1'", () => {
    renderModal();
    const selects = screen.getAllByRole("combobox");
    const levelSelect = selects[1] as HTMLSelectElement;
    expect(levelSelect.value).toBe("1");
  });

  it("renders program checkboxes (CoE, Nodal, NVS)", () => {
    renderModal();
    expect(screen.getByText("JNV CoE")).toBeInTheDocument();
    expect(screen.getByText("JNV Nodal")).toBeInTheDocument();
    expect(screen.getByText("JNV NVS")).toBeInTheDocument();
  });

  it("shows no programs selected validation message initially", () => {
    renderModal();
    expect(screen.getByText("At least one program must be selected.")).toBeInTheDocument();
  });

  it("renders read-only checkbox unchecked by default", () => {
    renderModal();
    const checkbox = screen.getByRole("checkbox", { name: /read-only/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edit mode rendering
// ---------------------------------------------------------------------------

describe("AddUserModal — edit mode", () => {
  it("renders 'Edit User' title when user prop provided", () => {
    renderModal({ user: editUser });
    expect(screen.getByText("Edit User")).toBeInTheDocument();
  });

  it("renders email input as disabled with pre-filled value", () => {
    renderModal({ user: editUser });
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    expect(emailInput).toBeDisabled();
    expect(emailInput.value).toBe("existing@example.com");
  });

  it("renders submit button as 'Save Changes'", () => {
    renderModal({ user: editUser });
    expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
  });

  it("pre-fills role from user prop", () => {
    renderModal({ user: editUser });
    const select = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
    expect(select.value).toBe("program_manager");
  });

  it("pre-fills level from user prop", () => {
    renderModal({ user: editUser });
    const selects = screen.getAllByRole("combobox");
    const levelSelect = selects[1] as HTMLSelectElement;
    expect(levelSelect.value).toBe("2");
  });

  it("pre-fills selected programs", () => {
    renderModal({ user: editUser });
    const checkboxes = screen.getAllByRole("checkbox");
    // CoE (id=1) checked, Nodal (id=2) checked, NVS (id=64) not, read-only not
    const programCheckboxes = checkboxes.filter(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV")
    );
    expect((programCheckboxes[0] as HTMLInputElement).checked).toBe(true); // CoE
    expect((programCheckboxes[1] as HTMLInputElement).checked).toBe(true); // Nodal
    expect((programCheckboxes[2] as HTMLInputElement).checked).toBe(false); // NVS
  });
});

// ---------------------------------------------------------------------------
// Level-based UI visibility
// ---------------------------------------------------------------------------

describe("AddUserModal — level-based UI", () => {
  it("shows school search when level is 1", () => {
    renderModal();
    expect(screen.getByPlaceholderText("Search schools by name or code...")).toBeInTheDocument();
  });

  it("shows region picker when level is 2", () => {
    renderModal({ user: { ...editUser, level: 2 } });
    expect(screen.getByText("Select Regions")).toBeInTheDocument();
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("South")).toBeInTheDocument();
  });

  it("hides school search when level is 2", () => {
    renderModal({ user: { ...editUser, level: 2 } });
    expect(screen.queryByPlaceholderText("Search schools by name or code...")).not.toBeInTheDocument();
  });

  it("hides both school and region pickers when level is 3", () => {
    renderModal({ user: { ...editUser, level: 3 } });
    expect(screen.queryByPlaceholderText("Search schools by name or code...")).not.toBeInTheDocument();
    expect(screen.queryByText("Select Regions")).not.toBeInTheDocument();
  });

  it("hides both school and region pickers when level is 4", () => {
    renderModal({ user: { ...editUser, level: 4 } });
    expect(screen.queryByPlaceholderText("Search schools by name or code...")).not.toBeInTheDocument();
    expect(screen.queryByText("Select Regions")).not.toBeInTheDocument();
  });

  it("switches from school picker to region picker when level changes from 1 to 2", async () => {
    const user = userEvent.setup();
    renderModal();
    // Initially level=1, should show school search
    expect(screen.getByPlaceholderText("Search schools by name or code...")).toBeInTheDocument();

    // Change level to 2
    const levelSelect = screen.getAllByRole("combobox")[1];
    await user.selectOptions(levelSelect, "2");

    expect(screen.queryByPlaceholderText("Search schools by name or code...")).not.toBeInTheDocument();
    expect(screen.getByText("Select Regions")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Region selection (level 2)
// ---------------------------------------------------------------------------

describe("AddUserModal — region selection", () => {
  it("toggles region checkbox on click", async () => {
    const user = userEvent.setup();
    renderModal({ user: { ...editUser, level: 2, regions: [] } });

    const northCheckbox = screen.getByRole("checkbox", { name: "North" });
    expect((northCheckbox as HTMLInputElement).checked).toBe(false);

    await user.click(northCheckbox);
    expect((northCheckbox as HTMLInputElement).checked).toBe(true);

    await user.click(northCheckbox);
    expect((northCheckbox as HTMLInputElement).checked).toBe(false);
  });

  it("shows selected regions text when regions are checked", () => {
    renderModal({ user: { ...editUser, level: 2, regions: ["North", "South"] } });
    expect(screen.getByText("Selected: North, South")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// School search (level 1) with debounce
// ---------------------------------------------------------------------------

describe("AddUserModal — school search (debounce)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch schools when search query is less than 2 chars", async () => {
    renderModal();
    const input = screen.getByPlaceholderText("Search schools by name or code...");

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "A");
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fetches schools after debounce when query >= 2 chars", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([{ code: "SC001", name: "Test School", region: "North" }]),
    });

    renderModal();
    const input = screen.getByPlaceholderText("Search schools by name or code...");

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "Te");
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/schools?q=Te");
    });
  });

  it("displays search results and adds school on click", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ code: "SC001", name: "Test School", region: "North" }]),
    });

    renderModal();
    const input = screen.getByPlaceholderText("Search schools by name or code...");

    await act(async () => {
      await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).type(input, "Test");
    });

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(screen.getByText("Test School")).toBeInTheDocument();
    });

    // Click to add the school
    await act(async () => {
      fireEvent.click(screen.getByText("Test School"));
    });

    // School should appear as a chip
    expect(screen.getByText("SC001")).toBeInTheDocument();
  });

  it("clears search results when level changes away from 1", async () => {
    renderModal();

    // Change level to 3 — school search should disappear
    const levelSelect = screen.getAllByRole("combobox")[1];
    await act(async () => {
      fireEvent.change(levelSelect, { target: { value: "3" } });
    });

    expect(screen.queryByPlaceholderText("Search schools by name or code...")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// School chip management
// ---------------------------------------------------------------------------

describe("AddUserModal — school chip management", () => {
  it("shows pre-filled schools as chips in edit mode", () => {
    renderModal({
      user: { ...editUser, level: 1, school_codes: ["SC001", "SC002"], regions: null },
    });
    expect(screen.getByText("SC001")).toBeInTheDocument();
    expect(screen.getByText("SC002")).toBeInTheDocument();
  });

  it("removes school chip on × button click", async () => {
    const user = userEvent.setup();
    renderModal({
      user: { ...editUser, level: 1, school_codes: ["SC001", "SC002"], regions: null },
    });

    // Find the remove buttons (×)
    const removeButtons = screen.getAllByText("×");
    await user.click(removeButtons[0]);

    expect(screen.queryByText("SC001")).not.toBeInTheDocument();
    expect(screen.getByText("SC002")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Program selection
// ---------------------------------------------------------------------------

describe("AddUserModal — program selection", () => {
  it("toggles program checkbox", async () => {
    const user = userEvent.setup();
    renderModal();

    // Find CoE checkbox
    const checkboxes = screen.getAllByRole("checkbox");
    const coeCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV CoE")
    ) as HTMLInputElement;

    expect(coeCheckbox.checked).toBe(false);
    await user.click(coeCheckbox);
    expect(coeCheckbox.checked).toBe(true);
    await user.click(coeCheckbox);
    expect(coeCheckbox.checked).toBe(false);
  });

  it("shows NVS-only warning when only NVS is selected", async () => {
    const user = userEvent.setup();
    renderModal();

    // Select NVS only
    const checkboxes = screen.getAllByRole("checkbox");
    const nvsCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV NVS")
    ) as HTMLInputElement;

    await user.click(nvsCheckbox);

    expect(screen.getByText(/NVS-only users have limited access/)).toBeInTheDocument();
  });

  it("hides NVS-only warning when another program is also selected", async () => {
    const user = userEvent.setup();
    renderModal();

    const checkboxes = screen.getAllByRole("checkbox");
    const nvsCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV NVS")
    ) as HTMLInputElement;
    const coeCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV CoE")
    ) as HTMLInputElement;

    await user.click(nvsCheckbox);
    await user.click(coeCheckbox);

    expect(screen.queryByText(/NVS-only users have limited access/)).not.toBeInTheDocument();
  });

  it("hides validation message once a program is selected", async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.getByText("At least one program must be selected.")).toBeInTheDocument();

    const checkboxes = screen.getAllByRole("checkbox");
    const coeCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV CoE")
    ) as HTMLInputElement;

    await user.click(coeCheckbox);

    expect(screen.queryByText("At least one program must be selected.")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Role descriptions
// ---------------------------------------------------------------------------

describe("AddUserModal — role descriptions", () => {
  it("shows teacher description when role is teacher", () => {
    renderModal();
    expect(screen.getByText(/Teachers can view and manage students/)).toBeInTheDocument();
  });

  it("shows PM description when role is program_manager", async () => {
    const user = userEvent.setup();
    renderModal();

    const roleSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(roleSelect, "program_manager");

    expect(screen.getByText(/Program Managers can conduct school visits/)).toBeInTheDocument();
  });

  it("shows admin description when role is admin", async () => {
    const user = userEvent.setup();
    renderModal();

    const roleSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(roleSelect, "admin");

    expect(screen.getByText(/Admins have full access to all features/)).toBeInTheDocument();
  });

  it("shows program admin description when role is program_admin", async () => {
    const user = userEvent.setup();
    renderModal();

    const roleSelect = screen.getAllByRole("combobox")[0];
    await user.selectOptions(roleSelect, "program_admin");

    expect(screen.getByText(/Program Admins can oversee scoped schools/)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Form submission — create mode
// ---------------------------------------------------------------------------

describe("AddUserModal — form submission (create)", () => {
  it("submits new user with correct payload", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const { props } = renderModal();

    // Fill email
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    await user.type(emailInput, "new@example.com");

    // Select a program (CoE)
    const checkboxes = screen.getAllByRole("checkbox");
    const coeCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV CoE")
    ) as HTMLInputElement;
    await user.click(coeCheckbox);

    // Submit
    await user.click(screen.getByRole("button", { name: "Add User" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level: 1,
          role: "teacher",
          read_only: false,
          program_ids: [1],
          email: "new@example.com",
          school_codes: [],
          regions: null,
        }),
      });
    });

    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalled();
    });
  });

  it("shows 'Saving...' while submitting", async () => {
    const user = userEvent.setup();
    // Never-resolving fetch
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    renderModal();

    // Select a program
    const checkboxes = screen.getAllByRole("checkbox");
    const coeCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).closest('label')?.textContent?.includes("JNV CoE")
    ) as HTMLInputElement;
    await user.click(coeCheckbox);

    // Fill email
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    await user.type(emailInput, "test@example.com");

    await user.click(screen.getByRole("button", { name: "Add User" }));

    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
  });

  it("shows error when no programs selected on submit", async () => {
    const user = userEvent.setup();
    renderModal();

    // Fill email
    const emailInput = document.querySelector('input[type="email"]') as HTMLInputElement;
    await user.type(emailInput, "test@example.com");

    // Submit without selecting programs
    await user.click(screen.getByRole("button", { name: "Add User" }));

    await waitFor(() => {
      expect(screen.getByText("At least one program must be selected")).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Form submission — edit mode
// ---------------------------------------------------------------------------

describe("AddUserModal — form submission (edit)", () => {
  it("submits edit with PATCH method and user ID in URL", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const { props } = renderModal({ user: editUser });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/42", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      });
    });

    // Verify the body does NOT include email (editing mode)
    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody).not.toHaveProperty("email");
    expect(callBody.level).toBe(2);
    expect(callBody.role).toBe("program_manager");
    expect(callBody.regions).toEqual(["North"]);
    expect(callBody.school_codes).toBeNull();

    await waitFor(() => {
      expect(props.onSave).toHaveBeenCalled();
    });
  });

  it("sends school_codes for level 1 and regions=null", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    renderModal({
      user: { ...editUser, level: 1, school_codes: ["SC001"], regions: null },
    });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.school_codes).toEqual(["SC001"]);
      expect(callBody.regions).toBeNull();
    });
  });

  it("sends null for both school_codes and regions at level 3+", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    renderModal({
      user: { ...editUser, level: 3, school_codes: null, regions: null },
    });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.school_codes).toBeNull();
      expect(callBody.regions).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("AddUserModal — error handling", () => {
  it("displays API error message on failed save", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Email already exists" }),
    });

    renderModal({ user: editUser });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("Email already exists")).toBeInTheDocument();
    });
  });

  it("displays generic error when response has no error field", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({}),
    });

    renderModal({ user: editUser });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("Failed to save user")).toBeInTheDocument();
    });
  });

  it("displays generic error when fetch throws", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    renderModal({ user: editUser });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  it("handles non-Error thrown values", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce("string error");

    renderModal({ user: editUser });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByText("An error occurred")).toBeInTheDocument();
    });
  });

  it("re-enables button after error", async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error("fail"));

    renderModal({ user: editUser });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save Changes" })).not.toBeDisabled();
    });
  });
});

// ---------------------------------------------------------------------------
// Close / cancel behavior
// ---------------------------------------------------------------------------

describe("AddUserModal — close/cancel", () => {
  it("calls onClose when Cancel button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("calls onClose when X button is clicked", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();

    // The X button is the one with the SVG, no accessible name besides the SVG
    const closeButtons = screen.getAllByRole("button");
    const xButton = closeButtons.find((btn) => btn.querySelector("svg"));
    expect(xButton).toBeDefined();

    await user.click(xButton!);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("calls onClose when backdrop overlay is clicked", () => {
    const { props } = renderModal();

    // The backdrop is the div with bg-black bg-opacity-30
    const backdrop = document.querySelector(".bg-black.bg-opacity-30");
    expect(backdrop).toBeTruthy();

    fireEvent.click(backdrop!);
    expect(props.onClose).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Read-only checkbox
// ---------------------------------------------------------------------------

describe("AddUserModal — read-only toggle", () => {
  it("toggles read-only checkbox", async () => {
    const user = userEvent.setup();
    renderModal();

    const checkbox = screen.getByRole("checkbox", { name: /read-only/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await user.click(checkbox);
    expect(checkbox.checked).toBe(true);
  });

  it("submits read_only=true when checked", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    renderModal({ user: { ...editUser, read_only: true } });

    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => {
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.read_only).toBe(true);
    });
  });
});
