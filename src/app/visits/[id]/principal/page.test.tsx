import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suspense } from "react";
import PrincipalMeetingPage from "./page";

// Mock next/navigation
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockFetch: ReturnType<typeof vi.fn>;

const visitResponse = {
  visit: {
    id: 42,
    school_name: "Test School",
    school_code: "SCH001",
    data: {
      principalMeeting: {
        syllabusStatus: "Physics 60% done",
        examPerformance: "Good results",
        programUpdates: "Mock test completed",
        potentialToppers: "5 students",
        supportRequired: "Extra lab time",
        classTimingConfirmed: true,
        classroomAvailable: false,
        resourceAccess: {
          tablets: true,
          printers: false,
          smartBoards: true,
        },
        notes: "All going well",
      },
    },
  },
};

const emptyVisitResponse = {
  visit: {
    id: 42,
    school_name: "Test School",
    school_code: "SCH001",
    data: {},
  },
};

async function renderPage(id = "42") {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <Suspense fallback={<div>Loading suspense...</div>}>
        <PrincipalMeetingPage params={Promise.resolve({ id })} />
      </Suspense>
    );
  });
  return result!;
}

describe("PrincipalMeetingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
  });

  describe("loading state", () => {
    it("shows loading skeleton while fetching", async () => {
      mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
      await renderPage();
      expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    });
  });

  describe("data loading", () => {
    it("loads visit data and displays pre-filled form", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(visitResponse),
      });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Test School")).toBeInTheDocument();

      // Check textareas have pre-filled values
      const textareas = document.querySelectorAll("textarea");
      expect(textareas[0]).toHaveValue("Physics 60% done");
      expect(textareas[1]).toHaveValue("Good results");
      expect(textareas[2]).toHaveValue("Mock test completed");
      expect(textareas[3]).toHaveValue("5 students");
      expect(textareas[4]).toHaveValue("Extra lab time");
      expect(textareas[5]).toHaveValue("All going well");

      // Check checkboxes
      const checkboxes = screen.getAllByRole("checkbox");
      expect(checkboxes[0]).toBeChecked(); // classTimingConfirmed
      expect(checkboxes[1]).not.toBeChecked(); // classroomAvailable
      expect(checkboxes[2]).toBeChecked(); // tablets
      expect(checkboxes[3]).not.toBeChecked(); // printers
      expect(checkboxes[4]).toBeChecked(); // smartBoards
    });

    it("uses school_code when school_name is absent", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            visit: { id: 42, school_code: "SCH001", data: {} },
          }),
      });

      await renderPage();

      await waitFor(() => {
        expect(screen.getByText("SCH001")).toBeInTheDocument();
      });
    });

    it("renders empty form when no principalMeeting data exists", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      for (const textarea of textareas) {
        expect(textarea).toHaveValue("");
      }

      const checkboxes = screen.getAllByRole("checkbox");
      for (const checkbox of checkboxes) {
        expect(checkbox).not.toBeChecked();
      }
    });

    it("shows error when fetch fails with non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Failed to load visit")
        ).toBeInTheDocument();
      });
    });

    it("shows error when fetch throws network error", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await renderPage();

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("shows fallback error for non-Error thrown", async () => {
      mockFetch.mockRejectedValueOnce("string error");

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Failed to load visit")
        ).toBeInTheDocument();
      });
    });
  });

  describe("form interactions", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });
    });

    it("updates textarea and shows unsaved status", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      expect(screen.getByText("All changes saved")).toBeInTheDocument();

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Physics 80%");

      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });

    it("toggles process confirmation checkboxes", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole("checkbox");
      // classTimingConfirmed
      await user.click(checkboxes[0]);
      expect(checkboxes[0]).toBeChecked();
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });

    it("toggles resource access checkboxes", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const checkboxes = screen.getAllByRole("checkbox");
      // tablets checkbox (index 2)
      await user.click(checkboxes[2]);
      expect(checkboxes[2]).toBeChecked();
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
  });

  describe("save functionality", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });
    });

    it("saves data via PATCH and shows saved status", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      // Make a change first
      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      // Mock save response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const saveButton = screen.getByRole("button", { name: "Save" });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText("All changes saved")).toBeInTheDocument();
      });

      // Verify PATCH call
      expect(mockFetch).toHaveBeenCalledWith("/api/pm/visits/42", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining('"section":"principalMeeting"'),
      });
    });

    it("shows error when save fails with server error message", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({ error: "Visit already ended" }),
      });

      const saveButton = screen.getByRole("button", { name: "Save" });
      await user.click(saveButton);

      await waitFor(() => {
        expect(
          screen.getByText("Visit already ended")
        ).toBeInTheDocument();
      });

      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });

    it("shows fallback error when save fails without error message", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}),
      });

      const saveButton = screen.getByRole("button", { name: "Save" });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText("Failed to save")).toBeInTheDocument();
      });
    });

    it("shows error on network failure during save", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockRejectedValueOnce(new Error("Network down"));

      const saveButton = screen.getByRole("button", { name: "Save" });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText("Network down")).toBeInTheDocument();
      });
    });

    it("shows fallback error for non-Error thrown during save", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockRejectedValueOnce("string error");

      const saveButton = screen.getByRole("button", { name: "Save" });
      await user.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText("Failed to save")).toBeInTheDocument();
      });
    });

    it("disables Save button when status is saved", async () => {
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const saveButton = screen.getByRole("button", { name: "Save" });
      expect(saveButton).toBeDisabled();
    });
  });

  describe("Save & Return to Overview", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });
    });

    it("saves and navigates to visit overview on success", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      // Make a change
      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const saveAndReturnButton = screen.getByRole("button", {
        name: "Save & Return to Overview",
      });
      await user.click(saveAndReturnButton);

      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/visits/42");
      });
    });

    it("navigates even when save fails (stale closure reads pre-error state)", async () => {
      const user = userEvent.setup();
      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () =>
          Promise.resolve({ error: "Save failed" }),
      });

      const saveAndReturnButton = screen.getByRole("button", {
        name: "Save & Return to Overview",
      });
      await user.click(saveAndReturnButton);

      await waitFor(() => {
        expect(screen.getByText("Save failed")).toBeInTheDocument();
      });

      // Note: router.push IS called because handleSaveAndContinue checks
      // `if (!error)` where `error` is the stale closure value (null),
      // not the newly set error state.
      expect(mockPush).toHaveBeenCalledWith("/visits/42");
    });

    it("shows Saving... text while save is in progress", async () => {
      const user = userEvent.setup();
      let resolveSave: (value: unknown) => void;

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const textareas = document.querySelectorAll("textarea");
      await user.type(textareas[0], "Test");

      mockFetch.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSave = resolve;
          })
      );

      const saveAndReturnButton = screen.getByRole("button", {
        name: "Save & Return to Overview",
      });
      await user.click(saveAndReturnButton);

      // Button text changes to "Saving..."
      expect(
        screen.getByRole("button", { name: "Saving..." })
      ).toBeInTheDocument();

      // Status text also shows "Saving..."
      expect(screen.getByText("Saving...", { selector: "span" })).toHaveClass(
        "text-yellow-600"
      );

      // Resolve to clean up
      await act(async () => {
        resolveSave!({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        });
      });
    });
  });

  describe("navigation links", () => {
    it("has back link to visit overview", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const backLink = screen.getByText(/Back to Visit Overview/);
      expect(backLink).toHaveAttribute("href", "/visits/42");
    });

    it("has Cancel link to visit overview", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      const cancelLink = screen.getByText("Cancel");
      expect(cancelLink).toHaveAttribute("href", "/visits/42");
    });
  });

  describe("form field labels", () => {
    it("renders all section labels", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText("Syllabus Completion Status")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Exam Performance Review")
      ).toBeInTheDocument();
      expect(screen.getByText("Program Updates")).toBeInTheDocument();
      expect(
        screen.getByText("Potential High Performers")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Support Required from School")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Standard Processes Enabled")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Access to Resources")
      ).toBeInTheDocument();
      expect(screen.getByText("Additional Notes")).toBeInTheDocument();
    });

    it("renders checkbox labels", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyVisitResponse),
      });

      await renderPage();

      await waitFor(() => {
        expect(
          screen.getByText("Principal Meeting")
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText("Fixed class timings consistently followed")
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Suitable classroom allocated without disturbances"
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Tablets/computers for practice and assessments"
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText("Printers and printing support")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Smart boards or projectors available")
      ).toBeInTheDocument();
    });
  });
});
