import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EditStudentModal from "./EditStudentModal";
import { type Grade } from "./StudentTable";
import { APPROVED_REGISTRATION_MODE, PHONE_REGISTRATION_MODE } from "@/lib/registration-mode";

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
  isPhoneRegistrationStudent: false,
  // The roster's selected program — what the Edit gate authorized against.
  programId: 64 as number | null,
  registrationMode: APPROVED_REGISTRATION_MODE,
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
    expect(
      screen.getByText("Children with Special Needs (CWSN)"),
    ).toBeInTheDocument();

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

  it("explains that a Phone Registration Mode correction changes Portal login", () => {
    renderModal({ isPhoneRegistrationStudent: true });

    expect(
      screen.getByText(
        "Changing this phone also changes the Student ID. Portal login switches to the new number immediately.",
      ),
    ).toBeInTheDocument();
  });

  it("shows Approved-mode backfill inputs and fills-once messaging for the phone cohort", () => {
    renderModal({
      isPhoneRegistrationStudent: true,
      registrationMode: "approved",
      student: {
        ...baseStudent,
        pen_number: null,
        g10_roll_no: null,
      },
    });

    expect(screen.getByText("Post-approval identifier backfill")).toBeInTheDocument();
    expect(screen.getByText("PEN and Grade 10 Roll no can each be filled once; once saved, they are locked.")).toBeInTheDocument();
    expect(getByName("pen_number")).toHaveValue("");
    expect(getByName("g10_roll_no")).toHaveValue("");
    expect(getByName("pen_number")).not.toBeDisabled();
    expect(getByName("g10_roll_no")).not.toBeDisabled();
    expect(getByName("annual_family_income")).toBeInTheDocument();
  });

  it("locks identifiers that were already backfilled", () => {
    renderModal({
      isPhoneRegistrationStudent: true,
      registrationMode: "approved",
    });

    expect(getByName("pen_number")).toHaveValue("12345678901");
    expect(getByName("g10_roll_no")).toHaveValue("ABC123");
    expect(getByName("pen_number")).toBeDisabled();
    expect(getByName("g10_roll_no")).toBeDisabled();
  });

  it("submits backfill identifiers without a Student ID change", async () => {
    const user = userEvent.setup();
    const { props } = renderModal({
      isPhoneRegistrationStudent: true,
      registrationMode: "approved",
      student: {
        ...baseStudent,
        pen_number: null,
        g10_roll_no: null,
      },
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "updated" }) });

    await user.type(getByName("pen_number"), "01234567890");
    await user.type(getByName("g10_roll_no"), "12345678");
    await user.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      pen_number: "01234567890",
      g10_roll_no: "12345678",
      program_id: 64,
    });
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).not.toHaveProperty("student_id");
    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("hides all backfill inputs for the phone cohort while Phone mode is active", () => {
    renderModal({
      isPhoneRegistrationStudent: true,
      registrationMode: "phone",
    });

    expect(screen.queryByText("Post-approval identifier backfill")).not.toBeInTheDocument();
    expect(document.querySelector('[name="pen_number"]')).toBeNull();
    expect(document.querySelector('[name="g10_roll_no"]')).toBeNull();
    expect(document.querySelector('[name="annual_family_income"]')).toBeNull();
  });

  it("does not show Phone Registration Mode guidance for other Students", () => {
    renderModal();

    expect(
      screen.queryByText(
        "Changing this phone also changes the Student ID. Portal login switches to the new number immediately.",
      ),
    ).not.toBeInTheDocument();
  });

  it("uses the Phone Registration Mode 6-9 phone rule in the Edit UI", async () => {
    const user = userEvent.setup();
    renderModal({ isPhoneRegistrationStudent: true });

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "5876543210");
    await user.click(screen.getByText("Save Changes"));

    expect(
      await screen.findByText(
        "Parents Phone Number must be exactly 10 digits and start with 6-9",
      ),
    ).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [PHONE_REGISTRATION_MODE, true, "09999999999", "Parents Phone Number must be exactly 10 digits and start with 6-9"],
    [PHONE_REGISTRATION_MODE, true, "99999999999", "Parents Phone Number must be exactly 10 digits and start with 6-9"],
    [APPROVED_REGISTRATION_MODE, false, "09999999999", "Parents Phone Number must be exactly 10 digits and cannot start with zero"],
    [APPROVED_REGISTRATION_MODE, false, "99999999999", "Parents Phone Number must be exactly 10 digits and cannot start with zero"],
  ] as const)("keeps invalid phone digits for %s validation", async (registrationMode, isPhoneRegistrationStudent, phone, message) => {
    const user = userEvent.setup();
    renderModal({ registrationMode, isPhoneRegistrationStudent });

    const input = getByName("phone");
    await user.clear(input);
    await user.type(input, phone);

    expect(input).toHaveValue(phone);
    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("accepts a valid ten-digit phone unchanged in Phone Registration Mode", async () => {
    const user = userEvent.setup();
    renderModal({
      registrationMode: PHONE_REGISTRATION_MODE,
      isPhoneRegistrationStudent: true,
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "updated" }) });

    const input = getByName("phone");
    await user.clear(input);
    await user.type(input, "9999999999");
    await user.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
      phone: "9999999999",
      program_id: 64,
    });
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
      // The program the student is edited under, so the API can authorize it.
      program_id: 64,
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
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      phone: "9999999999",
      program_id: 64,
    });
  });

  it("sends the selected program, not the student's primary program", async () => {
    // Mixed-program student: the roster row's program_id is the tiebreak pick
    // (e.g. CoE) while the user acts under the roster's selected program. The
    // payload must carry the selected program — the one the Edit gate and the
    // server authorization both check.
    const user = userEvent.setup();
    renderModal({
      student: { ...baseStudent, program_id: 1, program_name: "JNV CoE" },
      programId: 64,
    });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "updated" }) });

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "9999999999");
    await user.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      phone: "9999999999",
      program_id: 64,
    });
  });

  it("omits program_id when no roster program is selected", async () => {
    const user = userEvent.setup();
    renderModal({ programId: null });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "updated" }) });

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "9999999999");
    await user.click(screen.getByText("Save Changes"));

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      phone: "9999999999",
    });
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

  it("filters non-digits while preserving extra phone digits for validation", async () => {
    const user = userEvent.setup();
    renderModal();

    await user.clear(getByName("phone"));
    await user.type(getByName("phone"), "abc12345678901");
    expect(getByName("phone")).toHaveValue("12345678901");

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

  describe("documents tab", () => {
    it("hides the Documents tab for PMU (JNV NVS) Students", () => {
      renderModal();

      // Documents and Exams are both physical-centre only (#433, #434), so NVS
      // has nothing to switch between — no tab strip at all.
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: "Documents" })).not.toBeInTheDocument();
    });

    it("keeps the Documents tab for physical-centre programs", () => {
      renderModal({ programId: 1 });

      expect(screen.getByRole("tab", { name: "Documents" })).toBeInTheDocument();
    });
  });

  describe("contact and household details (#431)", () => {
    // Centre-only: JNV NVS PMU does not collect these (#431 review).
    const CENTRE_PROGRAM_ID = 1;
    const renderCentreModal = (overrides: Partial<typeof defaultProps> = {}) =>
      renderModal({ programId: CENTRE_PROGRAM_ID, ...overrides });

    const withDetails = {
      ...baseStudent,
      whatsapp_phone: "9000000001",
      address: "12 MG Road",
      city: "Pune",
      district: "Pune City",
      state: "Maharashtra",
      pincode: "411001",
      father_phone: "9000000002",
      father_profession: "Farmer",
      father_education_level: "Grades 6-10",
      mother_name: "Sunita Kumar",
      mother_phone: "9000000003",
      guardian_name: "Ramesh Kumar",
      guardian_relation: "Uncle",
      monthly_family_income: "Rs. 10,000-20,000",
    };

    it("prefills every detail the roster card shows", () => {
      renderCentreModal({ student: withDetails });

      expect(getByName("whatsapp_phone")).toHaveValue("9000000001");
      expect(getByName("address")).toHaveValue("12 MG Road");
      expect(getByName("pincode")).toHaveValue("411001");
      expect(getByName("father_phone")).toHaveValue("9000000002");
      expect(getByName("father_education_level")).toHaveValue("Grades 6-10");
      expect(getByName("mother_name")).toHaveValue("Sunita Kumar");
      expect(getByName("guardian_relation")).toHaveValue("Uncle");
      expect(getByName("monthly_family_income")).toHaveValue("Rs. 10,000-20,000");
    });

    it("keeps a stored education level the list no longer offers", () => {
      renderCentreModal({ student: { ...baseStudent, father_education_level: "10th" } });

      const select = getByName("father_education_level") as HTMLSelectElement;
      expect(select).toHaveValue("10th");
      expect([...select.options].map((option) => option.value)).toContain("10th");
    });

    it("sends only the details that changed", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      renderCentreModal({ student: withDetails });

      await user.clear(getByName("city"));
      await user.type(getByName("city"), "Nashik");
      await user.selectOptions(getByName("monthly_family_income"), "Rs. 20,000-30,000");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toMatchObject({
        city: "Nashik",
        monthly_family_income: "Rs. 20,000-30,000",
      });
      expect(body).not.toHaveProperty("address");
      expect(body).not.toHaveProperty("father_phone");
    });

    it("sends a blank when a detail is cleared", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      renderCentreModal({ student: withDetails });

      await user.clear(getByName("guardian_relation"));
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        guardian_relation: "",
      });
    });

    it("shows the server's field error against the field", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            error: "Father Phone must be exactly 10 digits and cannot start with zero",
            field_errors: { father_phone: "Father Phone must be exactly 10 digits and cannot start with zero" },
          }),
          { status: 400 },
        ),
      );
      renderCentreModal({ student: withDetails });

      await user.clear(getByName("father_phone"));
      await user.type(getByName("father_phone"), "98765");
      await user.click(screen.getByText("Save Changes"));

      // Once in the banner, once under the field it belongs to.
      expect(
        await screen.findAllByText("Father Phone must be exactly 10 digits and cannot start with zero"),
      ).toHaveLength(2);
    });

    it("says why the locked identifiers cannot be edited", () => {
      renderModal();

      expect(screen.getByText(/can't be edited here/)).toBeInTheDocument();
    });
  });

  describe("NVS keeps the form it had before #431", () => {
    it("hides the contact and household sections for PMU (JNV NVS) Students", () => {
      renderModal();

      for (const heading of ["Contact & Address", "Mother", "Guardian", "Socio-economic"]) {
        expect(screen.queryByText(heading)).not.toBeInTheDocument();
      }
      expect(document.querySelector('[name="mother_name"]')).toBeNull();
      expect(document.querySelector('[name="monthly_family_income"]')).toBeNull();
      expect(document.querySelector('[name="whatsapp_phone"]')).toBeNull();
    });

    it("keeps the fields NVS already had", () => {
      renderModal();

      // Father Name and Annual Family Income predate #431 and stay put.
      expect(getByName("father_name")).toBeInTheDocument();
      expect(getByName("annual_family_income")).toBeInTheDocument();
      expect(
        screen.getByText("Children with Special Needs (CWSN)"),
      ).toBeInTheDocument();
    });

    it("offers the sections to a physical centre", () => {
      renderModal({ programId: 1 });

      expect(screen.getByText("Contact & Address")).toBeInTheDocument();
      expect(getByName("mother_name")).toBeInTheDocument();
      expect(getByName("father_name")).toBeInTheDocument();
    });

    it("shows a centre one Email input, in Contact & Address", () => {
      renderModal({ programId: 1 });

      expect(document.querySelectorAll('[name="email"]')).toHaveLength(1);
      expect(document.querySelectorAll("#edit-student-email")).toHaveLength(1);
      expect(screen.getByLabelText("Email")).toHaveValue("ravi@example.com");
    });
  });

  describe("typing in the new fields", () => {
    it("keeps only the digits of a contact phone, all of them", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      await user.type(getByName("father_phone"), "+91 98765 43210");

      // Not truncated to ten: that would turn a pasted country code into a
      // different number that validation would happily accept.
      expect(getByName("father_phone")).toHaveValue("919876543210");
    });

    it("keeps only the digits of a pincode", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      await user.type(getByName("pincode"), "30 2001");

      expect(getByName("pincode")).toHaveValue("302001");
    });

    it("drops digits and symbols from the parent names", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      await user.type(getByName("mother_name"), "Sita2 (Mrs)");

      expect(getByName("mother_name")).toHaveValue("Sita Mrs");
    });

    it("takes a parent name typed in Hindi", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      await user.type(getByName("mother_name"), "सीता देवी");

      expect(getByName("mother_name")).toHaveValue("सीता देवी");
    });

    it("keeps the dots, apostrophes and hyphens in a parent name", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      await user.clear(getByName("father_name"));
      await user.type(getByName("father_name"), "K. Ram-Prasad D'Souza");

      expect(getByName("father_name")).toHaveValue("K. Ram-Prasad D'Souza");
    });

    it("keeps the dots of a stored name when it is edited", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      renderModal({
        programId: 1,
        student: { ...baseStudent, mother_name: "Smt.Mamta Devi", guardian_name: "सीता" },
      });

      await user.type(getByName("mother_name"), " Rao");
      await user.type(getByName("guardian_name"), " देवी");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({
        mother_name: "Smt.Mamta Devi Rao",
        guardian_name: "सीता देवी",
      });
    });
  });

  describe("a failed save says so where it can be seen", () => {
    it("moves focus to the field the server rejected", async () => {
      const user = userEvent.setup();
      const message = "Pincode must be exactly 6 digits and cannot start with zero";
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: message, field_errors: { pincode: message } }), {
          status: 422,
        }),
      );
      renderModal({ programId: 1 });

      // Five digits passes the input filter and fails at the API, which is
      // where the error used to land thousands of pixels out of view.
      await user.type(getByName("pincode"), "12345");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(getByName("pincode")).toHaveFocus());
    });

    it("leaves focus where the user is typing after a failed save", async () => {
      const user = userEvent.setup();
      const message = "Pincode must be exactly 6 digits and cannot start with zero";
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: message, field_errors: { pincode: message } }), {
          status: 422,
        }),
      );
      renderModal({ programId: 1 });

      await user.type(getByName("pincode"), "12345");
      await user.click(screen.getByText("Save Changes"));
      await waitFor(() => expect(getByName("pincode")).toHaveFocus());

      // The first keystroke clears the banner; that must not send focus back
      // to Pincode, which still has its own error.
      await user.click(getByName("city"));
      await user.type(getByName("city"), "Jaipur");

      expect(getByName("city")).toHaveFocus();
      expect(getByName("city")).toHaveValue("Jaipur");
      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it("moves focus to a Date of Birth outside the allowed range", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      fireEvent.change(screen.getByLabelText("Date of Birth"), {
        target: { value: "2016-01-01" },
      });
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(screen.getByLabelText("Date of Birth")).toHaveFocus());
    });

    it("moves focus to the backfill PEN when an identifier is missing", async () => {
      const user = userEvent.setup();
      renderModal({
        student: { ...baseStudent, pen_number: null, g10_roll_no: null },
        isPhoneRegistrationStudent: true,
      });

      await user.selectOptions(getByName("annual_family_income"), "Rs. 1,00,000-2,00,000");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(screen.getByLabelText("PEN")).toHaveFocus());
    });

    it("falls back to the banner when the rejected field has no input here", async () => {
      const user = userEvent.setup();
      const message = "PEN can only be filled once and is already set";
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: message, field_errors: { pen_number: message } }), {
          status: 422,
        }),
      );
      renderModal({ programId: 1 });

      await user.clear(getByName("city"));
      await user.type(getByName("city"), "Jaipur");
      await user.click(screen.getByText("Save Changes"));

      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent(message);
      await waitFor(() => expect(banner).toHaveFocus());
    });

    it("announces a save error that has no field of its own", async () => {
      const user = userEvent.setup();
      renderModal({ programId: 1 });

      await user.click(screen.getByText("Save Changes"));

      const banner = await screen.findByRole("alert");
      expect(banner).toHaveTextContent("No changes to save");
      expect(banner).toHaveFocus();
    });
  });

  describe("uniform sizes", () => {
    // Sizes are collected for physical-centre programs; the default props are JNV NVS.
    const CENTRE_PROGRAM_ID = 1;

    it("hides the section for PMU (JNV NVS) Students", () => {
      renderModal({ student: { ...baseStudent, tshirt_size: "L" } });

      expect(screen.queryByText("Uniform Size")).not.toBeInTheDocument();
      expect(document.querySelector('[name="tshirt_size"]')).toBeNull();
      expect(document.querySelector('[name="track_pant_size"]')).toBeNull();
    });

    it("prefills the stored sizes and offers the chart with measurements", () => {
      renderModal({
        programId: CENTRE_PROGRAM_ID,
        student: { ...baseStudent, tshirt_size: "L", track_pant_size: "M" },
      });

      expect(getByName("tshirt_size")).toHaveValue("L");
      expect(getByName("track_pant_size")).toHaveValue("M");

      const tshirt = getByName("tshirt_size") as HTMLSelectElement;
      expect([...tshirt.options].map((option) => option.text)).toContain('M (Chest 38\u201340")');
      expect([...tshirt.options].map((option) => option.value)).not.toContain("XXS");

      const trackPant = getByName("track_pant_size") as HTMLSelectElement;
      expect([...trackPant.options].map((option) => option.text)).toContain('M (Waist 30\u201332")');
    });

    it("keeps a stored size the chart no longer offers selectable", () => {
      renderModal({ programId: CENTRE_PROGRAM_ID, student: { ...baseStudent, tshirt_size: "XXS" } });

      const tshirt = getByName("tshirt_size") as HTMLSelectElement;
      expect(tshirt).toHaveValue("XXS");
      expect([...tshirt.options].map((option) => option.value)).toContain("XXS");
    });

    it("submits the bare size code, not its measurement label", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      renderModal({ programId: CENTRE_PROGRAM_ID });

      await user.selectOptions(getByName("tshirt_size"), "XL");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toMatchObject({ tshirt_size: "XL" });
      expect(body).not.toHaveProperty("track_pant_size");
    });

    it("sends a blank when a size is cleared, so the stored value is removed", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      renderModal({ programId: CENTRE_PROGRAM_ID, student: { ...baseStudent, track_pant_size: "M" } });

      await user.selectOptions(getByName("track_pant_size"), "");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).toMatchObject({ track_pant_size: "" });
    });

    it("leaves both sizes out of the payload when neither is touched", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      renderModal({ programId: CENTRE_PROGRAM_ID, student: { ...baseStudent, tshirt_size: "L" } });

      await user.clear(getByName("father_name"));
      await user.type(getByName("father_name"), "Mahesh Kumar");
      await user.click(screen.getByText("Save Changes"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty("tshirt_size");
      expect(body).not.toHaveProperty("track_pant_size");
    });
  });

  it("blocks submit when the student primary key is missing", async () => {
    const user = userEvent.setup();
    renderModal({ student: { ...baseStudent, student_pk_id: null } });

    await user.click(screen.getByText("Save Changes"));

    expect(await screen.findByText("Cannot update student: missing student record ID")).toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  describe("exams tab", () => {
    it("sits after Documents", () => {
      renderModal({ programId: 1 });

      const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
      expect(tabs).toEqual(["Details", "Documents", "Exams"]);
    });

    it("is not offered for PMU (JNV NVS) Students", () => {
      renderModal();

      // Exam registrations are collected at physical centres only (#434).
      expect(screen.queryByRole("tab", { name: "Exams" })).not.toBeInTheDocument();
      expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    });

    it("loads the student's exam registrations when opened", async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ exams: [], records: [] }), { status: 200 }),
      );
      renderModal({ programId: 1 });

      await user.click(screen.getByRole("tab", { name: "Exams" }));

      await waitFor(() =>
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/students/123/exam-records",
          expect.objectContaining({ cache: "no-store" }),
        ),
      );
    });

    it("is unreachable for a student with no record id", () => {
      renderModal({ programId: 1, student: { ...baseStudent, student_pk_id: null } });

      expect(screen.getByRole("tab", { name: "Exams" })).toBeDisabled();
    });
  });
});
