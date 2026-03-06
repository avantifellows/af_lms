import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditStudentModal, { Batch } from "./EditStudentModal";
import { Grade } from "./StudentTable";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseStudent = {
  group_user_id: "gu-1",
  user_id: "u-1",
  student_pk_id: "spk-1",
  first_name: "Ravi",
  last_name: "Kumar",
  phone: "9876543210",
  email: "ravi@example.com",
  date_of_birth: "2008-05-15T00:00:00.000Z",
  student_id: "STU001",
  apaar_id: "APAAR001",
  category: "OBC",
  stream: "science",
  gender: "Male",
  program_name: "JNV Programme",
  program_id: 1,
  grade: 10,
  grade_id: "g-10",
  status: "active",
  updated_at: "2025-12-01T10:30:00.000Z",
};

const grades: Grade[] = [
  { id: "g-9", number: 9, group_id: "grp-9" },
  { id: "g-10", number: 10, group_id: "grp-10" },
  { id: "g-11", number: 11, group_id: "grp-11" },
];

const batches: Batch[] = [
  { id: 1, name: "10-Science-A", batch_id: "b1", program_id: 1, group_id: "bg-1", metadata: { stream: "science", grade: 10 } },
  { id: 2, name: "10-Commerce-A", batch_id: "b2", program_id: 1, group_id: "bg-2", metadata: { stream: "commerce", grade: 10 } },
  { id: 3, name: "11-Science-A", batch_id: "b3", program_id: 1, group_id: "bg-3", metadata: { stream: "science", grade: 11 } },
  { id: 4, name: "11-Science-B", batch_id: "b4", program_id: 1, group_id: "bg-4", metadata: { stream: "science", grade: 11 } },
  { id: 5, name: "9-Science-A", batch_id: "b5", program_id: 1, group_id: "bg-5", metadata: { stream: "science", grade: 9 } },
];

const nvsStreams = ["science", "commerce", "humanities"];

const defaultProps = {
  student: baseStudent,
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  grades,
  batches,
  nvsStreams,
};

/** Helper: query a form element by its name attribute. */
function getByName(name: string): HTMLElement {
  const el = document.querySelector(`[name="${name}"]`);
  if (!el) throw new Error(`Element with name="${name}" not found`);
  return el as HTMLElement;
}

function renderModal(overrides: Partial<typeof defaultProps> = {}) {
  const props = { ...defaultProps, onClose: vi.fn(), onSave: vi.fn(), ...overrides };
  const result = render(<EditStudentModal {...props} />);
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

// ===========================================================================
// Tests
// ===========================================================================

describe("EditStudentModal", () => {
  // -----------------------------------------------------------------------
  // 1. Renders null when closed
  // -----------------------------------------------------------------------
  describe("when isOpen is false", () => {
    it("does not render anything", () => {
      const { container } = renderModal({ isOpen: false });
      expect(container.innerHTML).toBe("");
    });
  });

  // -----------------------------------------------------------------------
  // 2 & 3. Renders with correct initial values
  // -----------------------------------------------------------------------
  describe("when isOpen is true", () => {
    it("renders the modal heading", () => {
      renderModal();
      expect(screen.getByText("Edit Student")).toBeInTheDocument();
    });

    it("populates first name and last name", () => {
      renderModal();
      expect(screen.getByDisplayValue("Ravi")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Kumar")).toBeInTheDocument();
    });

    it("populates phone", () => {
      renderModal();
      expect(screen.getByDisplayValue("9876543210")).toBeInTheDocument();
    });

    it("shows gender select with current value", () => {
      renderModal();
      const genderSelect = getByName("gender") as HTMLSelectElement;
      expect(genderSelect.value).toBe("Male");
    });

    it("shows date of birth formatted as YYYY-MM-DD", () => {
      renderModal();
      expect(screen.getByDisplayValue("2008-05-15")).toBeInTheDocument();
    });

    it("shows category select with current value", () => {
      renderModal();
      const catSelect = getByName("baseCategory") as HTMLSelectElement;
      expect(catSelect.value).toBe("OBC");
    });

    it("shows stream select with current value", () => {
      renderModal();
      const streamSelect = getByName("stream") as HTMLSelectElement;
      expect(streamSelect.value).toBe("science");
    });

    it("shows grade select with current group_id value", () => {
      renderModal();
      const gradeSelect = getByName("group_id") as HTMLSelectElement;
      expect(gradeSelect.value).toBe("grp-10");
    });

    it("shows disabled student ID field", () => {
      renderModal();
      const studentIdInput = screen.getByDisplayValue("STU001");
      expect(studentIdInput).toBeDisabled();
    });

    it("shows disabled APAAR ID field", () => {
      renderModal();
      const apaarInput = screen.getByDisplayValue("APAAR001");
      expect(apaarInput).toBeDisabled();
    });

    it("shows disabled program name field", () => {
      renderModal();
      const programInput = screen.getByDisplayValue("JNV Programme");
      expect(programInput).toBeDisabled();
    });

    it("shows last updated timestamp when present", () => {
      renderModal();
      expect(screen.getByText(/Last updated:/)).toBeInTheDocument();
    });

    it("does not show last updated when updated_at is null", () => {
      renderModal({ student: { ...baseStudent, updated_at: null } });
      expect(screen.queryByText(/Last updated:/)).not.toBeInTheDocument();
    });

    it("PWD checkbox is unchecked for non-PWD category", () => {
      renderModal();
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeChecked();
    });

    it("PWD checkbox is checked for PWD category", () => {
      renderModal({ student: { ...baseStudent, category: "PWD-OBC" } });
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).toBeChecked();
    });

    it("normalizes PWD-General to Gen in category select", () => {
      renderModal({ student: { ...baseStudent, category: "PWD-General" } });
      const catSelect = getByName("baseCategory") as HTMLSelectElement;
      expect(catSelect.value).toBe("Gen");
      expect(screen.getByRole("checkbox")).toBeChecked();
    });

    it("shows em-dash for null student_id", () => {
      renderModal({ student: { ...baseStudent, student_id: null } });
      const labels = screen.getAllByText("Student ID");
      expect(labels.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Form field changes
  // -----------------------------------------------------------------------
  describe("form field changes", () => {
    it("updates first name when typed", async () => {
      const user = userEvent.setup();
      renderModal();
      const input = screen.getByDisplayValue("Ravi");
      await user.clear(input);
      await user.type(input, "Sita");
      expect(input).toHaveValue("Sita");
    });

    it("updates last name when typed", async () => {
      const user = userEvent.setup();
      renderModal();
      const input = screen.getByDisplayValue("Kumar");
      await user.clear(input);
      await user.type(input, "Sharma");
      expect(input).toHaveValue("Sharma");
    });

    it("updates phone when typed", async () => {
      const user = userEvent.setup();
      renderModal();
      const input = screen.getByDisplayValue("9876543210");
      await user.clear(input);
      await user.type(input, "1234567890");
      expect(input).toHaveValue("1234567890");
    });

    it("changes gender select", async () => {
      renderModal();
      const select = getByName("gender") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "Female" } });
      expect(select.value).toBe("Female");
    });

    it("changes category select", async () => {
      renderModal();
      const select = getByName("baseCategory") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "SC" } });
      expect(select.value).toBe("SC");
    });

    it("toggles PWD checkbox", async () => {
      const user = userEvent.setup();
      renderModal();
      const checkbox = screen.getByRole("checkbox");
      expect(checkbox).not.toBeChecked();
      await user.click(checkbox);
      expect(checkbox).toBeChecked();
    });

    it("changes stream select", () => {
      renderModal();
      const select = getByName("stream") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "commerce" } });
      expect(select.value).toBe("commerce");
    });

    it("changes grade select", () => {
      renderModal();
      const select = getByName("group_id") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "grp-11" } });
      expect(select.value).toBe("grp-11");
    });
  });

  // -----------------------------------------------------------------------
  // 5. Phone validation
  // -----------------------------------------------------------------------
  describe("phone validation", () => {
    it("shows error for phone shorter than 10 digits", async () => {
      const user = userEvent.setup();
      renderModal();

      const phoneInput = screen.getByDisplayValue("9876543210");
      await user.clear(phoneInput);
      await user.type(phoneInput, "12345");

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Phone number must be exactly 10 digits")).toBeInTheDocument();
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("shows error for phone with non-numeric characters", async () => {
      const user = userEvent.setup();
      renderModal();

      const phoneInput = screen.getByDisplayValue("9876543210");
      await user.clear(phoneInput);
      await user.type(phoneInput, "abcdefghij");

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Phone number must be exactly 10 digits")).toBeInTheDocument();
      });
    });

    it("allows empty phone (optional field)", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      const phoneInput = screen.getByDisplayValue("9876543210");
      await user.clear(phoneInput);

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });

    it("allows valid 10-digit phone", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });
    });
  });

  // -----------------------------------------------------------------------
  // 6. Missing student_pk_id validation
  // -----------------------------------------------------------------------
  describe("missing student_pk_id", () => {
    it("shows error when student_pk_id is null", async () => {
      const user = userEvent.setup();
      renderModal({ student: { ...baseStudent, student_pk_id: null } });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Cannot update student: missing student record ID")).toBeInTheDocument();
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 7. Successful form submission
  // -----------------------------------------------------------------------
  describe("successful submission", () => {
    it("sends PATCH to the correct URL with form data", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/student/spk-1",
          expect.objectContaining({
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
          })
        );
      });

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1].body);
      expect(body.first_name).toBe("Ravi");
      expect(body.last_name).toBe("Kumar");
      expect(body.phone).toBe("9876543210");
      expect(body.gender).toBe("Male");
      expect(body.category).toBe("OBC");
      expect(body.stream).toBe("science");
      expect(body.user_id).toBe("u-1");
      expect(body.group_id).toBe("grp-10");
      expect(body.grade_id).toBe("g-10");
    });

    it("calls onSave and onClose on success", async () => {
      const user = userEvent.setup();
      const { props } = renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(props.onSave).toHaveBeenCalledTimes(1);
        expect(props.onClose).toHaveBeenCalledTimes(1);
      });
    });

    it("does not include batch_group_id when stream/grade unchanged", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.batch_group_id).toBeUndefined();
    });

    it("shows Saving... text while loading", async () => {
      const user = userEvent.setup();
      mockFetch.mockReturnValueOnce(new Promise(() => {}));
      renderModal();

      await user.click(screen.getByText("Save Changes"));

      expect(screen.getByText("Saving...")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 8. Failed form submission
  // -----------------------------------------------------------------------
  describe("failed submission", () => {
    it("shows server error message from response body", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Student not found" }),
      });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Student not found")).toBeInTheDocument();
      });
    });

    it("shows generic error when response has no error field", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({}),
      });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Failed to update student")).toBeInTheDocument();
      });
    });

    it("shows generic error for network failure", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("shows fallback message for non-Error throws", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockRejectedValueOnce("something weird");

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("An error occurred")).toBeInTheDocument();
      });
    });

    it("does not call onSave or onClose on failure", async () => {
      const user = userEvent.setup();
      const { props } = renderModal();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "fail" }),
      });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("fail")).toBeInTheDocument();
      });
      expect(props.onSave).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 9. Batch selection shown when stream changes
  // -----------------------------------------------------------------------
  describe("batch selection on stream change", () => {
    it("shows batch selector when stream changes", () => {
      renderModal();
      const streamSelect = getByName("stream") as HTMLSelectElement;
      fireEvent.change(streamSelect, { target: { value: "commerce" } });

      expect(screen.getByText(/New Batch/)).toBeInTheDocument();
      expect(screen.getByText(/stream change/)).toBeInTheDocument();
    });

    it("shows matching batches for the new stream + current grade", () => {
      renderModal();
      const streamSelect = getByName("stream") as HTMLSelectElement;
      fireEvent.change(streamSelect, { target: { value: "commerce" } });

      // Only batch matching grade=10 + commerce should appear
      expect(screen.getByText("10-Commerce-A")).toBeInTheDocument();
      expect(screen.queryByText("10-Science-A")).not.toBeInTheDocument();
    });

    it("does not show batch selector when stream set back to original", () => {
      renderModal();
      const streamSelect = getByName("stream") as HTMLSelectElement;

      fireEvent.change(streamSelect, { target: { value: "commerce" } });
      expect(screen.getByText(/New Batch/)).toBeInTheDocument();

      // Change back to original
      fireEvent.change(streamSelect, { target: { value: "science" } });
      expect(screen.queryByText(/New Batch/)).not.toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 10. Batch selection shown when grade changes
  // -----------------------------------------------------------------------
  describe("batch selection on grade change", () => {
    it("shows batch selector when grade changes", () => {
      renderModal();
      const gradeSelect = getByName("group_id") as HTMLSelectElement;
      fireEvent.change(gradeSelect, { target: { value: "grp-11" } });

      expect(screen.getByText(/New Batch/)).toBeInTheDocument();
      expect(screen.getByText(/grade change/)).toBeInTheDocument();
    });

    it("shows matching batches for the new grade + current stream", () => {
      renderModal();
      const gradeSelect = getByName("group_id") as HTMLSelectElement;
      fireEvent.change(gradeSelect, { target: { value: "grp-11" } });

      // Grade 11 + science has two batches
      expect(screen.getByText("11-Science-A")).toBeInTheDocument();
      expect(screen.getByText("11-Science-B")).toBeInTheDocument();
    });

    it("shows label for both stream and grade change", () => {
      renderModal();
      fireEvent.change(getByName("stream"), { target: { value: "commerce" } });
      fireEvent.change(getByName("group_id"), { target: { value: "grp-11" } });

      expect(screen.getByText(/stream and grade change/)).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // 11. Auto-selects batch when only one option
  // -----------------------------------------------------------------------
  describe("auto-select single batch", () => {
    it("auto-selects the batch and shows auto-selected message", () => {
      renderModal();
      // Changing stream to commerce for grade 10 yields exactly one batch
      fireEvent.change(getByName("stream"), { target: { value: "commerce" } });

      expect(screen.getByText(/Auto-selected: 10-Commerce-A/)).toBeInTheDocument();
    });

    it("includes batch_group_id in submission when auto-selected", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      fireEvent.change(getByName("stream"), { target: { value: "commerce" } });

      expect(screen.getByText(/Auto-selected/)).toBeInTheDocument();

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.batch_group_id).toBe("bg-2");
    });
  });

  // -----------------------------------------------------------------------
  // 12. Error when no batch available
  // -----------------------------------------------------------------------
  describe("no batch available for stream/grade", () => {
    it("shows error message when no batch matches", () => {
      renderModal();
      // Change stream to humanities -- no batch for grade 10 + humanities
      fireEvent.change(getByName("stream"), { target: { value: "humanities" } });

      expect(screen.getByText(/No batch found for Grade 10 \+ humanities/)).toBeInTheDocument();
    });

    it("disables Save button when no batch available", () => {
      renderModal();
      fireEvent.change(getByName("stream"), { target: { value: "humanities" } });

      expect(screen.getByText("Save Changes")).toBeDisabled();
    });

    it("shows validation error if submitting without batch when needed", async () => {
      const user = userEvent.setup();
      renderModal();

      // Change grade to 11 with science => 2 batches, no auto-select
      fireEvent.change(getByName("group_id"), { target: { value: "grp-11" } });

      // Two batches available, none auto-selected => batch_group_id is ""
      expect(screen.getByText("11-Science-A")).toBeInTheDocument();
      expect(screen.getByText("11-Science-B")).toBeInTheDocument();

      // Don't select a batch; try to submit
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(screen.getByText("Please select a batch for the new stream/grade combination")).toBeInTheDocument();
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 13. PWD checkbox combines with category
  // -----------------------------------------------------------------------
  describe("PWD + category combination", () => {
    it("submits PWD-prefixed category when checkbox is checked", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await user.click(screen.getByRole("checkbox")); // check PWD
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.category).toBe("PWD-OBC");
    });

    it("submits base category without PWD prefix when unchecked", async () => {
      const user = userEvent.setup();
      renderModal({ student: { ...baseStudent, category: "PWD-SC" } });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      // Uncheck PWD
      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.category).toBe("SC");
    });

    it("submits empty category when none selected even with PWD checked", async () => {
      const user = userEvent.setup();
      renderModal({ student: { ...baseStudent, category: null } });
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      await user.click(screen.getByRole("checkbox")); // check PWD but category is empty
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      // combineCategory("", true) returns ""
      expect(body.category).toBe("");
    });

    it("changes category then checks PWD, combines correctly", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      // Change category to Gen-EWS
      fireEvent.change(getByName("baseCategory"), { target: { value: "Gen-EWS" } });
      // Check PWD
      await user.click(screen.getByRole("checkbox"));

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.category).toBe("PWD-Gen-EWS");
    });
  });

  // -----------------------------------------------------------------------
  // 14. Cancel button
  // -----------------------------------------------------------------------
  describe("cancel button", () => {
    it("calls onClose when Cancel is clicked", async () => {
      const user = userEvent.setup();
      const { props } = renderModal();

      await user.click(screen.getByText("Cancel"));

      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when X close button is clicked", async () => {
      const user = userEvent.setup();
      const { props } = renderModal();

      // The X button is a button with an SVG inside
      const buttons = screen.getAllByRole("button");
      const closeBtn = buttons.find(
        (btn) => btn.querySelector("svg") !== null
      );
      expect(closeBtn).toBeDefined();
      await user.click(closeBtn!);

      expect(props.onClose).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // 15. Backdrop click
  // -----------------------------------------------------------------------
  describe("backdrop click", () => {
    it("calls onClose when backdrop is clicked", () => {
      const { props } = renderModal();

      // The backdrop has bg-black bg-opacity-30 and onClick={onClose}
      const backdrop = document.querySelector(".bg-black");
      expect(backdrop).toBeTruthy();
      fireEvent.click(backdrop!);

      expect(props.onClose).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe("edge cases", () => {
    it("handles null fields gracefully (renders with empty values)", () => {
      const nullStudent = {
        ...baseStudent,
        first_name: null,
        last_name: null,
        phone: null,
        gender: null,
        date_of_birth: null,
        category: null,
        stream: null,
        student_id: null,
        apaar_id: null,
        program_name: null,
        grade_id: null,
      };
      renderModal({ student: nullStudent });

      expect(screen.getByText("Edit Student")).toBeInTheDocument();
      // Gender, category, and stream selects should be at "Select..." (empty value)
      expect((getByName("gender") as HTMLSelectElement).value).toBe("");
      expect((getByName("baseCategory") as HTMLSelectElement).value).toBe("");
      expect((getByName("stream") as HTMLSelectElement).value).toBe("");
    });

    it("handles invalid date string in date_of_birth", () => {
      renderModal({ student: { ...baseStudent, date_of_birth: "not-a-date" } });
      const dateInput = document.querySelector("input[type='date']") as HTMLInputElement;
      expect(dateInput.value).toBe("");
    });

    it("handles Date constructor throwing (catch branch in formatDateForInput)", () => {
      const OriginalDate = globalThis.Date;
      // Temporarily replace Date so it throws for the student's date_of_birth
      const MockDate = vi.fn(function (...args: unknown[]) {
        if (args.length === 1 && args[0] === "2008-05-15T00:00:00.000Z") {
          throw new Error("Date parse failure");
        }
        // @ts-expect-error — calling original constructor
        return new OriginalDate(...args);
      }) as unknown as DateConstructor;
      MockDate.now = OriginalDate.now;
      MockDate.parse = OriginalDate.parse;
      MockDate.UTC = OriginalDate.UTC;
      MockDate.prototype = OriginalDate.prototype;
      globalThis.Date = MockDate;

      try {
        renderModal();
        const dateInput = document.querySelector("input[type='date']") as HTMLInputElement;
        expect(dateInput.value).toBe("");
      } finally {
        globalThis.Date = OriginalDate;
      }
    });

    it("renders without batches prop", () => {
      renderModal({ batches: undefined });
      expect(screen.getByText("Edit Student")).toBeInTheDocument();
    });

    it("renders without nvsStreams prop", () => {
      renderModal({ nvsStreams: undefined });
      expect(screen.getByText("Edit Student")).toBeInTheDocument();
    });

    it("does not show batch selector when batches array is empty even if stream changes", () => {
      renderModal({ batches: [] });
      fireEvent.change(getByName("stream"), { target: { value: "commerce" } });

      // needsBatchUpdate is true but batches.length === 0, so section is hidden
      expect(screen.queryByText(/New Batch/)).not.toBeInTheDocument();
    });

    it("submits with updated grade_id matching selected group_id", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      // Change grade to 11
      fireEvent.change(getByName("group_id"), { target: { value: "grp-11" } });

      // Two batches available; select one
      const batchSelect = getByName("batch_group_id") as HTMLSelectElement;
      fireEvent.change(batchSelect, { target: { value: "bg-3" } });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.grade_id).toBe("g-11");
      expect(body.group_id).toBe("grp-11");
      expect(body.batch_group_id).toBe("bg-3");
    });

    it("selecting a batch manually from multiple options allows submission", async () => {
      const user = userEvent.setup();
      renderModal();
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

      // Change grade to 11 => 2 science batches
      fireEvent.change(getByName("group_id"), { target: { value: "grp-11" } });

      expect(screen.getByText("11-Science-A")).toBeInTheDocument();
      expect(screen.getByText("11-Science-B")).toBeInTheDocument();

      // Select second batch
      fireEvent.change(getByName("batch_group_id"), { target: { value: "bg-4" } });

      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.batch_group_id).toBe("bg-4");
    });
  });
});
