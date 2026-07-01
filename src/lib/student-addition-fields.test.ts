import { describe, expect, it } from "vitest";

import {
  CBSE_BOARD,
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
  apaar_id: "123456789012",
  g10_board: CBSE_BOARD,
  g10_roll_no: "1234 5678",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: " ravi  kumar ",
  phone: "9876543210",
  annual_family_income: "Less than Rs. 1,00,000",
};

describe("validateStudentAdditionInput", () => {
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
      apaar_id: "123456789012",
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

  it("allows APAAR-only rows and leaves Student ID blank", () => {
    const result = validateStudentAdditionInput(
      { ...validInput, grade: "12", g10_roll_no: "" },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row.g10_roll_no).toBe("");
    expect(result.generatedStudentId).toBeNull();
  });

  it("validates identifiers, future DOB, phone, and CBSE roll format", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        date_of_birth: "2099-01-01",
        phone: "12345",
        apaar_id: "123",
        g10_roll_no: "ABC123",
      },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors).toMatchObject({
      date_of_birth: "Date of Birth cannot be in the future",
      phone: "Parents Phone Number must be exactly 10 digits",
      apaar_id: "APAAR ID must be exactly 12 digits",
      g10_roll_no: "CBSE Grade 10 Roll no must be exactly 8 digits",
    });
  });

  it("accepts uppercase alphanumeric non-CBSE Grade 10 rolls", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        apaar_id: "",
        g10_board: "RAJASTHAN BOARD OF SECONDARY EDUCATION",
        g10_roll_no: " ab 12 z ",
      },
      { today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row.g10_roll_no).toBe("AB12Z");
    expect(result.generatedStudentId).toBe("2028AB12Z");
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
        apaar_id: "",
        g10_board: "RAJASTHAN BOARD OF SECONDARY EDUCATION",
        g10_roll_no: "ab12z",
      },
      { academicYear: "2027-2028" },
    );

    expect(result.ok).toBe(true);
    expect(result.generatedStudentId).toBe("2029AB12Z");
  });
});
