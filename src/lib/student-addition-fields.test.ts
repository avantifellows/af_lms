import { describe, expect, it } from "vitest";

import {
  CBSE_BOARD,
  formatStudentAdditionExistingMatch,
  generateStudentId,
  validateStudentAdditionInput,
} from "./student-addition-fields";

const validInput = {
  grade: "11",
  student_name: " asha  k. kumar ",
  date_of_birth: "02/01/2010",
  gender: "Female",
  category: "Gen",
  physically_handicapped: "No",
  pen_number: "12345678901",
  g10_board: CBSE_BOARD,
  g10_roll_no: "1234 5678",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: " ravi  kumar ",
  phone: "9876543210",
  annual_family_income: "Less than Rs. 1,00,000",
};

describe("validateStudentAdditionInput", () => {
  it("uses an 11-digit PEN as the canonical optional identifier", () => {
    const result = validateStudentAdditionInput(
      { ...validInput, apaar_id: undefined, pen_number: "12345678901" },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row).toMatchObject({ pen_number: "12345678901" });
    expect(result.row).not.toHaveProperty("apaar_id");
  });

  it("normalizes revised NVS board, roll, CWSN, gender, DOB, and NDA values", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        pen_number: "12345678901",
        apaar_id: undefined,
        date_of_birth: "2-1-2010",
        gender: "Others",
        category: "Gen-EWS",
        physically_handicapped: "Yes",
        g10_board: "Others",
        g10_roll_no: "00 ab-12 z",
        stream: "NDA",
      },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row).toMatchObject({
      date_of_birth: "2010-01-02",
      gender: "Other",
      category: "PWD-EWS",
      physically_handicapped: true,
      g10_board: null,
      g10_roll_no: "AB12Z",
      stream: "nda",
    });
    expect(result.generatedStudentId).toBe("2028AB12Z");
  });

  it.each([
    ["2/1/2010", "2010-01-02"],
    ["02/01/2010", "2010-01-02"],
    ["2-1-2010", "2010-01-02"],
    ["02-01-2010", "2010-01-02"],
    ["2010-01-02", "2010-01-02"],
    [new Date("2010-01-02T00:00:00Z"), "2010-01-02"],
  ])("accepts the supported DOB value %s", (date_of_birth, expected) => {
    const result = validateStudentAdditionInput(
      { ...validInput, date_of_birth },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.row.date_of_birth).toBe(expected);
  });

  it("normalizes the canonical single-student fields and generates the Grade 11 Student ID", () => {
    const result = validateStudentAdditionInput(validInput, {
      today: new Date("2026-07-01T00:00:00Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row).toMatchObject({
      grade: 11,
      student_name: "Asha K Kumar",
      date_of_birth: "2010-01-02",
      gender: "Female",
      category: "Gen",
      physically_handicapped: false,
      pen_number: "12345678901",
      g10_board: CBSE_BOARD,
      g10_roll_no: "12345678",
      board_stream: "PCM",
      stream: "engineering",
      father_name: "Ravi Kumar",
      phone: "9876543210",
      annual_family_income: "Less than Rs. 1,00,000",
    });
    expect(result.generatedStudentId).toBe("202812345678");
  });

  it("allows PEN-only rows and leaves Student ID blank", () => {
    const result = validateStudentAdditionInput(
      { ...validInput, grade: "12", g10_roll_no: "" },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row.g10_roll_no).toBe("");
    expect(result.generatedStudentId).toBeNull();
  });

  it("validates identifiers, DOB range, phone, and roll format", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        date_of_birth: "2099-01-01",
        phone: "12345",
        pen_number: "01234567890",
        g10_roll_no: "ABC123",
        father_name: "Ravi123",
      },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors).toMatchObject({
      date_of_birth: "Date of Birth must be between 2000 and 2015",
      phone: "Parents Phone Number must be exactly 10 digits",
      pen_number: "PEN must be exactly 11 digits and cannot start with zero",
      g10_roll_no: "CBSE Grade 10 Roll no must be exactly 8 digits",
      father_name: "Father Name must contain only letters",
    });
  });

  it("accepts uppercase alphanumeric non-CBSE Grade 10 rolls", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        pen_number: "",
        g10_board: "Others",
        g10_roll_no: " 00 ab-12 z ",
      },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row.g10_roll_no).toBe("AB12Z");
    expect(result.generatedStudentId).toBe("2028AB12Z");
  });

  it("rejects an Others roll that becomes too short after normalization", () => {
    const result = validateStudentAdditionInput({
      ...validInput,
      g10_board: "Others",
      g10_roll_no: "0000",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors.g10_roll_no).toBe(
      "Grade 10 Roll no must be 4 to 10 characters",
    );
  });

  it("derives Student ID passing year from the configured academic year", () => {
    expect(generateStudentId(11, "AB12Z")).toBe("2028AB12Z");
    expect(generateStudentId(12, "AB12Z")).toBe("2027AB12Z");
    expect(generateStudentId(11, "AB12Z", "2027-2028")).toBe("2029AB12Z");
    expect(generateStudentId(12, "AB12Z", "2027-2028")).toBe("2028AB12Z");
  });

  it("uses the request academic year for validation previews", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        pen_number: "",
        g10_board: "Others",
        g10_roll_no: "ab12z",
      },
      { academicYear: "2027-2028" },
    );

    expect(result.ok).toBe(true);
    expect(result.generatedStudentId).toBe("2029AB12Z");
  });
});

describe("formatStudentAdditionExistingMatch", () => {
  it("includes every available safe identity", () => {
    expect(
      formatStudentAdditionExistingMatch(
        {
          student_id: "2028AB12Z",
          pen_number: "12345678901",
          apaar_id: "123456789012",
          school_code: "JNV001",
        },
        "JNV001",
      ),
    ).toContain("Student ID: 2028AB12Z | PEN: 12345678901 | APAAR: 123456789012");
  });
});
