import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import UserList from "./UserList";

// ---------------------------------------------------------------------------
// Mock AddUserModal — we just need to know it renders and can call onClose/onSave
// ---------------------------------------------------------------------------

vi.mock("./AddUserModal", () => ({
  default: ({
    user,
    onClose,
    onSave,
  }: {
    user: unknown;
    regions: string[];
    onClose: () => void;
    onSave: () => void;
  }) => (
    <div data-testid="add-user-modal">
      <span data-testid="modal-user">{user ? "editing" : "creating"}</span>
      <button onClick={onClose}>modal-close</button>
      <button onClick={onSave}>modal-save</button>
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const currentUserEmail = "me@avantifellows.org";

const users = [
  {
    id: 1,
    email: "me@avantifellows.org",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [1, 2],
    read_only: false,
  },
  {
    id: 2,
    email: "pm@avantifellows.org",
    level: 2,
    role: "program_manager",
    school_codes: null,
    regions: ["North", "South"],
    program_ids: [1],
    read_only: false,
  },
  {
    id: 3,
    email: "teacher@example.com",
    level: 1,
    role: "teacher",
    school_codes: ["SCH001", "SCH002"],
    regions: null,
    program_ids: null,
    read_only: true,
  },
  {
    id: 4,
    email: "allschools@example.com",
    level: 3,
    role: "admin",
    school_codes: null,
    regions: null,
    program_ids: [64],
    read_only: false,
  },
];

const regions = ["North", "South", "East", "West"];

function renderList(
  overrides: {
    initialUsers?: typeof users;
    regions?: string[];
    currentUserEmail?: string;
  } = {}
) {
  return render(
    <UserList
      initialUsers={overrides.initialUsers ?? users}
      regions={overrides.regions ?? regions}
      currentUserEmail={overrides.currentUserEmail ?? currentUserEmail}
    />
  );
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  vi.stubGlobal("alert", vi.fn());
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Rendering
// ===========================================================================

describe("UserList", () => {
  describe("rendering", () => {
    it("renders all user emails", () => {
      renderList();
      expect(screen.getByText("me@avantifellows.org")).toBeInTheDocument();
      expect(screen.getByText("pm@avantifellows.org")).toBeInTheDocument();
      expect(screen.getByText("teacher@example.com")).toBeInTheDocument();
    });

    it("shows (you) tag next to current user email", () => {
      renderList();
      const cell = screen.getByText("me@avantifellows.org").closest("td")!;
      expect(within(cell).getByText("(you)")).toBeInTheDocument();
    });

    it("does not show (you) for other users", () => {
      renderList();
      const cell = screen.getByText("pm@avantifellows.org").closest("td")!;
      expect(within(cell).queryByText("(you)")).not.toBeInTheDocument();
    });

    it("renders role badges with correct labels", () => {
      renderList();
      // "Admin" appears multiple times (role badge + level badge for users 1 and 4)
      expect(screen.getAllByText("Admin").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("Program Manager")).toBeInTheDocument();
      expect(screen.getAllByText("Teacher").length).toBeGreaterThanOrEqual(1);
    });

    it("renders Program Admin role label", () => {
      renderList({
        initialUsers: [
          { ...users[1], id: 99, email: "pa@avantifellows.org", role: "program_admin" },
        ],
      });
      expect(screen.getByText("Program Admin")).toBeInTheDocument();
    });

    it("renders level badges", () => {
      renderList();
      // Level labels from LEVEL_LABELS
      expect(screen.getAllByText("All Schools").length).toBe(2); // level 3 (users 1 + 4)
      expect(screen.getByText("Region")).toBeInTheDocument(); // level 2
      expect(screen.getByText("School")).toBeInTheDocument(); // level 1
    });

    it("renders program badges for users with program_ids", () => {
      renderList();
      // user 1 has [1,2] => CoE, Nodal; user 2 has [1] => CoE; user 4 has [64] => NVS
      expect(screen.getAllByText("CoE").length).toBe(2);
      expect(screen.getByText("Nodal")).toBeInTheDocument();
      expect(screen.getByText("NVS")).toBeInTheDocument();
    });

    it("shows 'No programs' for users with null program_ids", () => {
      renderList();
      expect(screen.getByText("No programs")).toBeInTheDocument();
    });

    it("shows read-only and read/write badges", () => {
      renderList();
      expect(screen.getByText("Read-only")).toBeInTheDocument();
      expect(screen.getAllByText("Read/Write").length).toBe(3);
    });

    it("shows 'All JNV schools' for level 3 users", () => {
      renderList();
      expect(screen.getAllByText("All JNV schools").length).toBe(2); // users 1 (level 3 admin) + 4 (level 3 admin)
    });

    it("shows regions for level 2 users", () => {
      renderList();
      expect(screen.getByText("North, South")).toBeInTheDocument();
    });

    it("shows school codes for level 1 users", () => {
      renderList();
      expect(screen.getByText("SCH001, SCH002")).toBeInTheDocument();
    });

    it("shows 'No regions assigned' for level 2 user with null regions", () => {
      renderList({
        initialUsers: [
          { ...users[1], regions: null },
        ],
      });
      expect(screen.getByText("No regions assigned")).toBeInTheDocument();
    });

    it("shows 'No schools assigned' for level 1 user with null school_codes", () => {
      renderList({
        initialUsers: [
          { ...users[2], school_codes: null },
        ],
      });
      expect(screen.getByText("No schools assigned")).toBeInTheDocument();
    });

    it("renders fallback for unknown role", () => {
      renderList({
        initialUsers: [
          { ...users[0], role: "unknown_role" },
        ],
      });
      // Falls back to "Teacher" label
      expect(screen.getByText("Teacher")).toBeInTheDocument();
    });

    it("renders fallback for unknown program ID", () => {
      renderList({
        initialUsers: [
          { ...users[0], program_ids: [999] },
        ],
      });
      expect(screen.getByText("Program 999")).toBeInTheDocument();
    });

    it("renders Add User button", () => {
      renderList();
      expect(screen.getByRole("button", { name: "Add User" })).toBeInTheDocument();
    });

    it("renders Edit and Delete buttons per user", () => {
      renderList();
      expect(screen.getAllByRole("button", { name: "Edit" }).length).toBe(4);
      expect(screen.getAllByRole("button", { name: "Delete" }).length).toBe(4);
    });

    it("disables Delete for current user", () => {
      renderList();
      const rows = screen.getAllByRole("row");
      // Row 0 is header; row 1 is user 1 (me@avantifellows.org)
      const myRow = rows[1];
      const deleteBtn = within(myRow).getByRole("button", { name: "Delete" });
      expect(deleteBtn).toBeDisabled();
    });
  });

  // =========================================================================
  // Add User Modal
  // =========================================================================

  describe("Add User modal", () => {
    it("opens modal in create mode when Add User clicked", async () => {
      const user = userEvent.setup();
      renderList();

      expect(screen.queryByTestId("add-user-modal")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Add User" }));

      expect(screen.getByTestId("add-user-modal")).toBeInTheDocument();
      expect(screen.getByTestId("modal-user")).toHaveTextContent("creating");
    });

    it("closes modal via onClose", async () => {
      const user = userEvent.setup();
      renderList();

      await user.click(screen.getByRole("button", { name: "Add User" }));
      expect(screen.getByTestId("add-user-modal")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "modal-close" }));
      expect(screen.queryByTestId("add-user-modal")).not.toBeInTheDocument();
    });

    it("refetches users on save and closes modal", async () => {
      const user = userEvent.setup();
      renderList();

      const updatedUsers = [
        { ...users[0], email: "updated@example.com" },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => updatedUsers,
      });

      await user.click(screen.getByRole("button", { name: "Add User" }));
      await user.click(screen.getByRole("button", { name: "modal-save" }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/admin/users");
      });

      await waitFor(() => {
        expect(screen.queryByTestId("add-user-modal")).not.toBeInTheDocument();
      });

      expect(screen.getByText("updated@example.com")).toBeInTheDocument();
    });

    it("closes modal on save even if refetch fails", async () => {
      const user = userEvent.setup();
      renderList();

      mockFetch.mockResolvedValueOnce({ ok: false });

      await user.click(screen.getByRole("button", { name: "Add User" }));
      await user.click(screen.getByRole("button", { name: "modal-save" }));

      await waitFor(() => {
        expect(screen.queryByTestId("add-user-modal")).not.toBeInTheDocument();
      });
    });
  });

  // =========================================================================
  // Edit User Modal
  // =========================================================================

  describe("Edit User modal", () => {
    it("opens modal in edit mode when Edit clicked", async () => {
      const user = userEvent.setup();
      renderList();

      const editButtons = screen.getAllByRole("button", { name: "Edit" });
      await user.click(editButtons[1]); // click Edit on second user (pm)

      expect(screen.getByTestId("add-user-modal")).toBeInTheDocument();
      expect(screen.getByTestId("modal-user")).toHaveTextContent("editing");
    });

    it("closes edit modal via onClose", async () => {
      const user = userEvent.setup();
      renderList();

      const editButtons = screen.getAllByRole("button", { name: "Edit" });
      await user.click(editButtons[0]);

      await user.click(screen.getByRole("button", { name: "modal-close" }));
      expect(screen.queryByTestId("add-user-modal")).not.toBeInTheDocument();
    });
  });

  // =========================================================================
  // Delete User
  // =========================================================================

  describe("delete user", () => {
    it("disables delete for case-insensitive email match", () => {
      // Render with a user whose email differs only by case
      renderList({
        initialUsers: [
          { ...users[0], email: "ME@AVANTIFELLOWS.ORG" },
        ],
      });

      // Delete button should be disabled for case-insensitive match
      const rows = screen.getAllByRole("row");
      const userRow = rows[1];
      const deleteBtn = within(userRow).getByRole("button", { name: "Delete" });
      expect(deleteBtn).toBeDisabled();
    });

    it("shows confirm dialog before deleting", async () => {
      const user = userEvent.setup();
      const mockConfirm = vi.fn(() => false);
      vi.stubGlobal("confirm", mockConfirm);
      renderList();

      // Click delete on second user (pm)
      const rows = screen.getAllByRole("row");
      const pmRow = rows[2]; // row 0=header, row 1=me, row 2=pm
      await user.click(within(pmRow).getByRole("button", { name: "Delete" }));

      expect(mockConfirm).toHaveBeenCalledWith(
        "Are you sure you want to delete pm@avantifellows.org?"
      );
      // Fetch should NOT be called since confirm returned false
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("deletes user after confirmation and removes from list", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("confirm", vi.fn(() => true));
      mockFetch.mockResolvedValueOnce({ ok: true });
      renderList();

      expect(screen.getByText("pm@avantifellows.org")).toBeInTheDocument();

      const rows = screen.getAllByRole("row");
      const pmRow = rows[2];
      await user.click(within(pmRow).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(screen.queryByText("pm@avantifellows.org")).not.toBeInTheDocument();
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/admin/users/2", {
        method: "DELETE",
      });
    });

    it("shows 'Deleting...' while request is in progress", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("confirm", vi.fn(() => true));

      let resolveDelete!: (value: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveDelete = resolve;
        })
      );

      renderList();

      const rows = screen.getAllByRole("row");
      const pmRow = rows[2];
      await user.click(within(pmRow).getByRole("button", { name: "Delete" }));

      expect(within(pmRow).getByRole("button", { name: "Deleting..." })).toBeInTheDocument();

      resolveDelete({ ok: true });
      await waitFor(() => {
        expect(screen.queryByText("Deleting...")).not.toBeInTheDocument();
      });
    });

    it("shows alert with server error message on failed delete", async () => {
      const user = userEvent.setup();
      const mockAlert = vi.fn();
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.stubGlobal("alert", mockAlert);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Cannot delete admin" }),
      });

      renderList();

      const rows = screen.getAllByRole("row");
      const pmRow = rows[2];
      await user.click(within(pmRow).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockAlert).toHaveBeenCalledWith("Cannot delete admin");
      });
    });

    it("shows fallback alert when server returns no error message", async () => {
      const user = userEvent.setup();
      const mockAlert = vi.fn();
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.stubGlobal("alert", mockAlert);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      renderList();

      const rows = screen.getAllByRole("row");
      const pmRow = rows[2];
      await user.click(within(pmRow).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockAlert).toHaveBeenCalledWith("Failed to delete user");
      });
    });

    it("shows alert on network error during delete", async () => {
      const user = userEvent.setup();
      const mockAlert = vi.fn();
      vi.stubGlobal("confirm", vi.fn(() => true));
      vi.stubGlobal("alert", mockAlert);

      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      renderList();

      const rows = screen.getAllByRole("row");
      const pmRow = rows[2];
      await user.click(within(pmRow).getByRole("button", { name: "Delete" }));

      await waitFor(() => {
        expect(mockAlert).toHaveBeenCalledWith("Failed to delete user");
      });
    });
  });

  // =========================================================================
  // Empty state
  // =========================================================================

  describe("empty state", () => {
    it("renders empty table when no users", () => {
      renderList({ initialUsers: [] });
      // Table headers should still be visible
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Role")).toBeInTheDocument();
      // No user rows
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBe(1); // only header row
    });
  });
});
