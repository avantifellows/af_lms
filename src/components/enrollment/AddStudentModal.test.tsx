import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import AddStudentModal from "./AddStudentModal";
import { CBSE_BOARD } from "@/lib/student-addition-fields";

const baseProps = {
  open: true,
  schoolUdise: "12345678901",
  schoolCode: "JNV001",
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

async function fillValidForm() {
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText("Grade"), "11");
  await user.type(screen.getByLabelText("Student Name"), "asha k kumar");
  await user.type(screen.getByLabelText("Date of Birth"), "2010-01-02");
  await user.selectOptions(screen.getByLabelText("Gender"), "Female");
  await user.selectOptions(screen.getByLabelText("Category"), "Gen");
  await user.selectOptions(screen.getByLabelText("Physical Handicapped"), "No");
  await user.type(screen.getByLabelText("APAAR ID"), "123456789012");
  await user.type(screen.getByLabelText("G10 board"), CBSE_BOARD);
  await user.type(screen.getByLabelText("Grade 10 Roll no"), "1234 5678");
  await user.selectOptions(screen.getByLabelText("Board Stream"), "PCM");
  await user.selectOptions(screen.getByLabelText("Primary Exam preparing for"), "Engineering");
  await user.type(screen.getByLabelText("Father Name"), "ravi kumar");
  await user.type(screen.getByLabelText("Parents Phone Number"), "9876543210");
  await user.selectOptions(
    screen.getByLabelText("Yearly / Annual Family Income"),
    "Less than Rs. 1,00,000",
  );
  return user;
}

describe("AddStudentModal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("keeps submit disabled until required fields are valid, previews generated ID, and refreshes after create", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 1, created: 1, duplicate_in_file: 0, already_exists: 0, rejected: 0 },
          results: [{ status: "created", generated_student_id: "202812345678", normalized: {} }],
        }),
        { status: 200 },
      ),
    );
    render(<AddStudentModal {...baseProps} />);

    expect(screen.getByRole("button", { name: "Add Student" })).toBeDisabled();
    const user = await fillValidForm();

    expect(screen.getByText("Student ID will be 202812345678")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add Student" }));

    await waitFor(() => expect(baseProps.onCreated).toHaveBeenCalledWith("202812345678"));
    expect(baseProps.onClose).toHaveBeenCalled();
    expect(screen.queryByText(/Student added/)).not.toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "/api/school/12345678901/students",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows same-school existing matches", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 1, created: 0, duplicate_in_file: 0, already_exists: 1, rejected: 0 },
          results: [
            {
              status: "already_exists",
              existing_match: { student_id: "202812345678", school_code: "JNV001" },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    render(<AddStudentModal {...baseProps} />);
    const user = await fillValidForm();

    await user.click(screen.getByRole("button", { name: "Add Student" }));

    expect(
      await screen.findByText("This student is already part of this school. Student ID: 202812345678."),
    ).toBeInTheDocument();
    expect(baseProps.onCreated).not.toHaveBeenCalled();
  });

  it("shows APAAR-only rows do not generate Student ID", async () => {
    render(<AddStudentModal {...baseProps} />);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText("Grade"), "11");
    await user.type(screen.getByLabelText("APAAR ID"), "123456789012");

    expect(screen.getByText("APAAR-only: no Student ID will be generated.")).toBeInTheDocument();
  });

  it("filters restricted fields and caps fixed-length numeric inputs", async () => {
    render(<AddStudentModal {...baseProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("APAAR ID"), "abc1234567890123");
    expect(screen.getByLabelText("APAAR ID")).toHaveValue("123456789012");

    const rollInput = screen.getByLabelText("Grade 10 Roll no");
    await user.type(screen.getByLabelText("Grade 10 Roll no"), "abc12345678901");
    expect(rollInput).toHaveValue("ABC1234567");

    await user.clear(rollInput);
    await user.type(screen.getByLabelText("G10 board"), CBSE_BOARD);
    await user.type(rollInput, "abc123456789");
    expect(rollInput).toHaveValue("12345678");

    await user.type(screen.getByLabelText("Parents Phone Number"), "adasd12345678901");
    expect(screen.getByLabelText("Parents Phone Number")).toHaveValue("1234567890");

    await user.type(screen.getByLabelText("Father Name"), "Ravi123 !");
    expect(screen.getByLabelText("Father Name")).toHaveValue("Ravi ");
  });

  it("shows G10 roll length errors and allows typing in the board field", async () => {
    render(<AddStudentModal {...baseProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("G10 board"), "CENTRAL");
    expect(screen.getByLabelText("G10 board")).toHaveValue("CENTRAL");

    await user.type(screen.getByLabelText("Grade 10 Roll no"), "ABC");
    expect(screen.getByLabelText("Grade 10 Roll no")).toHaveValue("ABC");
    expect(screen.getByText("Grade 10 Roll no must be 4 to 10 characters")).toBeInTheDocument();
  });

  it("shows CBSE roll errors when switching boards makes an existing roll invalid", async () => {
    render(<AddStudentModal {...baseProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Grade 10 Roll no"), "ABC123");
    await user.type(screen.getByLabelText("G10 board"), CBSE_BOARD);

    expect(screen.getByLabelText("Grade 10 Roll no")).toHaveValue("123");
    expect(screen.getByText("CBSE Grade 10 Roll no must be exactly 8 digits")).toBeInTheDocument();
  });

  it("shows field-level validation for short numeric inputs", async () => {
    render(<AddStudentModal {...baseProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("APAAR ID"), "123");
    expect(screen.getByText("APAAR ID must be exactly 12 digits")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Parents Phone Number"), "12345");
    expect(screen.getByText("Parents Phone Number must be exactly 10 digits")).toBeInTheDocument();
  });

  it("marks required fields without showing Optional for annual family income", () => {
    render(<AddStudentModal {...baseProps} />);

    expect(screen.queryByText("Optional")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Yearly / Annual Family Income")).toBeInTheDocument();
    expect(screen.getByText(/Either APAAR ID or Grade 10 Roll no is compulsory/)).toBeInTheDocument();
  });

  it("resets the form when reopened", async () => {
    const { rerender } = render(<AddStudentModal {...baseProps} />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText("Student Name"), "old value");
    expect(screen.getByLabelText("Student Name")).toHaveValue("old value");

    rerender(<AddStudentModal {...baseProps} open={false} />);
    rerender(<AddStudentModal {...baseProps} open />);

    expect(screen.getByLabelText("Student Name")).toHaveValue("");
  });

  it("shows different-school existing match details", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: { total: 1, created: 0, duplicate_in_file: 0, already_exists: 1, rejected: 0 },
          results: [
            {
              status: "already_exists",
              existing_match: {
                student_id: "202812345678",
                apaar_id: "123456789012",
                student_name: "Asha Kumar",
                school_name: "JNV Other",
                school_code: "JNV999",
                udise_code: "99999999999",
                district: "Jaipur",
                state: "Rajasthan",
                grade: 11,
                program: "JNV NVS",
                stream: "engineering",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    render(<AddStudentModal {...baseProps} />);
    const user = await fillValidForm();

    await user.click(screen.getByRole("button", { name: "Add Student" }));

    expect(
      await screen.findByText(
        /This identifier already belongs to Asha Kumar at JNV Other \(JNV999, UDISE 99999999999\), Jaipur, Rajasthan/,
      ),
    ).toBeInTheDocument();
  });
});
