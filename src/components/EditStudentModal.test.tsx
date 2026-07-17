import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditStudentModal from "./EditStudentModal";
import { type Grade } from "./StudentTable";

const baseStudent = {
  group_user_id: "gu-1",
  user_id: "u-1",
  student_pk_id: "123",
  first_name: "Ravi Kumar",
  last_name: null,
  phone: "9876543210",
  email: "ravi@example.com",
  date_of_birth: "2008-05-15T00:00:00.000Z",
  gender: "Male",
  student_id: "202812345678",
  pen_number: "12345678901",
  apaar_id: "123456789012",
  category: "OBC",
  physically_handicapped: false,
  stream: "engineering",
  board_stream: "PCM",
  g10_board: "RAJASTHAN BOARD OF SECONDARY EDUCATION",
  g10_roll_no: "ABC123",
  father_name: "Suresh Kumar",
  annual_family_income: "Less than Rs. 1,00,000",
  program_name: "JNV NVS",
  program_id: 64,
  grade: 11,
  grade_id: "g-11",
  status: "active",
  updated_at: "2025-12-01T10:30:00.000Z",
};

const grades: Grade[] = [
  { id: "g-10", number: 10, group_id: "grp-10" },
  { id: "g-11", number: 11, group_id: "grp-11" },
  { id: "g-12", number: 12, group_id: "grp-12" },
];

const defaultProps = {
  student: baseStudent,
  isOpen: true,
  onClose: vi.fn(),
  onSave: vi.fn(),
  grades,
};

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("EditStudentModal", () => {
  it("does not render when closed", () => {
    const { container } = renderModal({ isOpen: false });
    expect(container.innerHTML).toBe("");
  });

  it("renders the PRD edit contract with locked identity fields and no batch selector", () => {
    renderModal();

    expect(screen.getByText("Edit Student")).toBeInTheDocument();
    expect(getByName("first_name")).toHaveValue("Ravi Kumar");
    expect(getByName("phone")).toHaveValue("9876543210");
    expect(getByName("date_of_birth")).toHaveValue("2008-05-15");
    expect(getByName("category")).toHaveValue("OBC");
    expect(getByName("physically_handicapped")).not.toBeChecked();
    expect(getByName("g10_board")).toHaveValue("Others");
    expect(getByName("grade")).toHaveValue("11");
    expect(getByName("stream")).toHaveValue("engineering");

    const gender = getByName("gender") as HTMLSelectElement;
    expect([...gender.options].map((option) => option.value)).toEqual(
      expect.arrayContaining(["Female", "Male", "Other"]),
    );
    expect([...gender.options].map((option) => option.value)).not.toContain("Others");

    const stream = getByName("stream") as HTMLSelectElement;
    expect([...stream.options].map((option) => option.value)).toContain("nda");
    expect(screen.getByText("CWSN")).toBeInTheDocument();

    const boardStream = getByName("board_stream") as HTMLSelectElement;
    expect([...boardStream.options].map((option) => option.value)).toEqual(
      expect.arrayContaining([
        "PCM",
        "PCB",
        "PCMB",
        "Commerce (Math)",
        "Commerce (Without Math)",
        "Arts/Humanities",
      ]),
    );

    expect(screen.getByDisplayValue("202812345678")).toBeDisabled();
    expect(screen.getByDisplayValue("12345678901")).toBeDisabled();
    expect(screen.getByDisplayValue("123456789012")).toBeDisabled();
    expect(screen.getByDisplayValue("ABC123")).toBeDisabled();
    expect(screen.getByDisplayValue("JNV NVS")).toBeDisabled();

    fireEvent.change(getByName("grade"), { target: { value: "12" } });
    fireEvent.change(getByName("stream"), { target: { value: "medical" } });
    expect(screen.queryByText(/New Batch/)).not.toBeInTheDocument();
    expect(document.querySelector('[name="batch_group_id"]')).toBeNull();
  });

  it("keeps the local database date when serialization uses the prior UTC day", () => {
    renderModal({
      student: {
        ...baseStudent,
        date_of_birth: "2008-05-14T18:30:00.000Z",
      },
    });

    expect(getByName("date_of_birth")).toHaveValue("2008-05-15");
  });

  it("initializes the name field with the full existing student name", () => {
    renderModal({
      student: { ...baseStudent, first_name: "Ravi", last_name: "Kumar" },
    });

    expect(getByName("first_name")).toHaveValue("Ravi Kumar");
  });

  it("reverse-maps a stored PWD category for editing", () => {
    renderModal({
      student: { ...baseStudent, category: "PWD-EWS", physically_handicapped: true },
    });

    expect(getByName("category")).toHaveValue("Gen-EWS");
    expect(getByName("physically_handicapped")).toBeChecked();
  });

  it("keeps blank identities disabled", () => {
    renderModal({
      student: {
        ...baseStudent,
        student_id: null,
        pen_number: null,
        apaar_id: null,
        g10_roll_no: null,
      },
    });

    const lockedInputs = screen
      .getByText("Locked Identity")
      .parentElement?.querySelectorAll("input:disabled");
    expect(lockedInputs).toHaveLength(5);
    expect([...lockedInputs!].slice(0, 4).map((input) => (input as HTMLInputElement).value)).toEqual([
      "—",
      "—",
      "—",
      "—",
    ]);
  });

  it("submits only PRD-editable fields and refreshes on success", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "updated" }) });

    await user.clear(getByName("first_name"));
    await user.type(getByName("first_name"), "Ravi Updated");
    fireEvent.change(getByName("gender"), { target: { value: "Other" } });
    fireEvent.click(getByName("physically_handicapped"));
    fireEvent.change(getByName("grade"), { target: { value: "12" } });
    fireEvent.change(getByName("stream"), { target: { value: "nda" } });

    await user.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/student/123",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
      }),
    );

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({
      first_name: "Ravi Updated",
      last_name: "",
      gender: "Other",
      category: "OBC",
      physically_handicapped: true,
      stream: "nda",
      grade: 12,
    });
    expect(body).not.toHaveProperty("student_id");
    expect(body).not.toHaveProperty("apaar_id");
    expect(body).not.toHaveProperty("g10_roll_no");
    expect(body).not.toHaveProperty("group_id");
    expect(body).not.toHaveProperty("batch_group_id");
    expect(body).not.toHaveProperty("user_id");
    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("validates parents phone number before submit", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "123");
    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("Parents Phone Number must be exactly 10 digits and cannot start with zero")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects periods in the student name", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(getByName("first_name"));
    await user.type(getByName("first_name"), "Ravi.Kumar");
    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("Student Name should not contain '.'")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends only the changed profile field", async () => {
    const user = userEvent.setup();
    renderModal();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "updated" }) });

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "9999999999");
    await user.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ phone: "9999999999" });
  });

  it("does not submit when nothing changed", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("No changes to save")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("enforces the student DOB range", async () => {
    const user = userEvent.setup();
    renderModal();

    fireEvent.change(getByName("date_of_birth"), { target: { value: "2016-01-01" } });
    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("Date of Birth must be between 2000 and 2015")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("filters restricted edit fields while typing", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "abc12345678901");
    expect(getByName("phone")).toHaveValue("1234567890");

    await user.clear(getByName("father_name"));
    await user.type(getByName("father_name"), "Suresh123 !");
    expect(getByName("father_name")).toHaveValue("Suresh ");
  });

  it("shows field-level G10 board errors returned by the route", async () => {
    const user = userEvent.setup();
    renderModal();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "CBSE Grade 10 Roll no must be exactly 8 digits",
        field_errors: {
          g10_board: "CBSE Grade 10 Roll no must be exactly 8 digits",
        },
      }),
    });

    fireEvent.change(getByName("g10_board"), {
      target: { value: "CBSE" },
    });
    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findAllByText("CBSE Grade 10 Roll no must be exactly 8 digits")).toHaveLength(2);
  });

  it("does not call onSave or onClose on failed submit", async () => {
    const user = userEvent.setup();
    const { props } = renderModal();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Student not found" }),
    });

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "9999999999");
    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("Student not found")).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("blocks submit when the student primary key is missing", async () => {
    const user = userEvent.setup();
    renderModal({ student: { ...baseStudent, student_pk_id: null } });

    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("Cannot update student: missing student record ID")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
