import { describe, expect, it } from "vitest";

import {
  CBSE_BOARD,
  canonicalizeStudentEditPayload,
  formatStudentAdditionExistingMatch,
  getStudentAdditionUploadColumns,
  generateStudentId,
  isValidRegistrationPhone,
  validateStudentAdditionInput,
} from "./student-addition-fields";
import {
  ACTIVE_REGISTRATION_MODE,
  APPROVED_REGISTRATION_MODE,
  PHONE_REGISTRATION_MODE,
  getRegistrationModeContract,
} from "./registration-mode";

describe("Registration Mode contract", () => {
  it("selects Phone as active and resolves the exact mode-specific field lists", () => {
    expect(ACTIVE_REGISTRATION_MODE).toBe(PHONE_REGISTRATION_MODE);
    expect(getRegistrationModeContract(PHONE_REGISTRATION_MODE)).toEqual({
      mode: "phone",
      version: "1",
    });
    expect(getStudentAdditionUploadColumns(PHONE_REGISTRATION_MODE).map((column) => column.label)).toEqual([
      "Grade",
      "Student Name",
      "Date of Birth",
      "Gender",
      "Category",
      "CWSN",
      "G10 board",
      "Board Stream",
      "Primary Exam preparing for",
      "Father Name",
      "Parents Phone Number",
    ]);
    expect(getStudentAdditionUploadColumns(APPROVED_REGISTRATION_MODE).map((column) => column.label)).toEqual([
      "Grade",
      "Student Name",
      "Date of Birth",
      "Gender",
      "Category",
      "CWSN",
      "PEN Number",
      "G10 board",
      "Grade 10 Roll no",
      "Board Stream",
      "Primary Exam preparing for",
      "Father Name",
      "Parents Phone Number",
      "Yearly / Annual Family Income",
    ]);
  });
});

describe("canonicalizeStudentEditPayload", () => {
  it("uses the Phone-mode 6–9 predicate when explicitly requested", () => {
    expect(isValidRegistrationPhone("6876543210", PHONE_REGISTRATION_MODE)).toBe(true);
    expect(isValidRegistrationPhone("9876543210", PHONE_REGISTRATION_MODE)).toBe(true);
    expect(isValidRegistrationPhone("5876543210", PHONE_REGISTRATION_MODE)).toBe(false);
    expect(isValidRegistrationPhone("687654321", PHONE_REGISTRATION_MODE)).toBe(false);
    expect(isValidRegistrationPhone("68765432101", PHONE_REGISTRATION_MODE)).toBe(false);
    expect(isValidRegistrationPhone("5876543210", APPROVED_REGISTRATION_MODE)).toBe(true);
    expect(canonicalizeStudentEditPayload(
      { phone: "5876543210" },
      { mode: PHONE_REGISTRATION_MODE },
    )).toEqual({
      ok: false,
      error: "Parents Phone Number must be exactly 10 digits and start with 6-9",
      field_errors: {
        phone: "Parents Phone Number must be exactly 10 digits and start with 6-9",
      },
    });
  });

  it("normalizes partial edit fields with the canonical student contract", () => {
    expect(canonicalizeStudentEditPayload({
      first_name: "  ravi  KUMAR ",
      father_name: " suresh. KUMAR ",
      gender: "Others",
      category: "Gen-EWS",
      physically_handicapped: true,
      g10_board: "Others",
    })).toEqual({
      ok: true,
      fields: {
        first_name: "Ravi Kumar",
        father_name: "Suresh Kumar",
        gender: "Other",
        category: "PWD-EWS",
        physically_handicapped: true,
        g10_board: "Others",
      },
    });
  });

  it("rejects periods in manually edited student names", () => {
    expect(canonicalizeStudentEditPayload({ first_name: "Ravi.Kumar" })).toEqual({
      ok: false,
      error: "Student Name should not contain '.'",
      field_errors: { first_name: "Student Name should not contain '.'" },
    });
  });

  it("rejects incomplete CWSN/category edits", () => {
    expect(canonicalizeStudentEditPayload({ physically_handicapped: true })).toEqual({
      ok: false,
      error: "CWSN and Category must be updated together",
      field_errors: {
        physically_handicapped: "CWSN and Category must be updated together",
        category: "CWSN and Category must be updated together",
      },
    });
  });

  it("canonicalizes option labels without changing omitted edit fields", () => {
    expect(canonicalizeStudentEditPayload(
      {
        gender: "  oThErS ",
        category: "  gen-ews ",
        physically_handicapped: true,
        g10_board: "  cbse ",
        g10_roll_no: "12345678",
        board_stream: "  commerce (without math) ",
        annual_family_income: "  rs. 1,00,000-2,00,000 ",
      },
      { allowPhoneBackfill: true },
    )).toEqual({
      ok: true,
      fields: {
        gender: "Other",
        category: "PWD-EWS",
        physically_handicapped: true,
        g10_board: "CBSE",
        g10_roll_no: "12345678",
        board_stream: "Commerce (Without Math)",
        annual_family_income: "Rs. 1,00,000-2,00,000",
      },
    });
  });

  it("keeps whitespace-only income edits invalid while allowing an explicit blank", () => {
    expect(canonicalizeStudentEditPayload({ annual_family_income: "" })).toEqual({
      ok: true,
      fields: { annual_family_income: "" },
    });
    expect(canonicalizeStudentEditPayload({ annual_family_income: "   " })).toEqual({
      ok: false,
      error: "Annual Family Income is not valid",
      field_errors: { annual_family_income: "Annual Family Income is not valid" },
    });
  });

  it.each([
    ["gender", "Femalee", "Gender must be Female, Male, or Other"],
    ["category", "Gen EWS", "Category is not valid"],
    ["g10_board", "CBSE?", "G10 board must be CBSE or Others"],
    ["board_stream", "PC-M", "Board Stream is not valid"],
    ["annual_family_income", "Less than Rs 1,00,000", "Annual Family Income is not valid"],
  ] as const)("rejects an invalid near-match for %s", (field, value, message) => {
    const result = canonicalizeStudentEditPayload({
      [field]: value,
      ...(field === "category" ? { physically_handicapped: false } : {}),
    });

    expect(result).toEqual({
      ok: false,
      error: message,
      field_errors: { [field]: message },
    });
  });
});

const validInput = {
  grade: "11",
  student_name: " asha  k kumar ",
  date_of_birth: "02/01/2010",
  gender: "Female",
  category: "Gen",
  physically_handicapped: "No",
  pen_number: "12345678901",
  g10_board: CBSE_BOARD,
  g10_roll_no: "12345678",
  board_stream: "PCM",
  stream: "Engineering",
  father_name: " ravi  kumar ",
  phone: "9876543210",
  annual_family_income: "Less than Rs. 1,00,000",
};

describe("validateStudentAdditionInput", () => {
  it("accepts the reduced Phone-mode fields and derives the phone Student ID", () => {
    const result = validateStudentAdditionInput(
      {
        grade: "12",
        student_name: " asha  k kumar ",
        date_of_birth: "02/01/2010",
        gender: "Female",
        category: "Gen",
        physically_handicapped: "No",
        g10_board: "Others",
        board_stream: "PCM",
        stream: "Engineering",
        father_name: " ravi  kumar ",
        phone: " 6876543210 ",
      },
      {
        mode: PHONE_REGISTRATION_MODE,
        today: new Date("2026-07-01T00:00:00Z"),
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid Phone-mode input");
    expect(result.row).toMatchObject({
      grade: 12,
      phone: "6876543210",
      student_id: "6876543210",
      g10_board: "Others",
      father_name: "Ravi Kumar",
    });
    expect(result.row).not.toHaveProperty("pen_number");
    expect(result.row).not.toHaveProperty("g10_roll_no");
    expect(result.row).not.toHaveProperty("annual_family_income");
    expect(result.generatedStudentId).toBe("6876543210");
  });

  it("rejects every restricted field key in Phone mode without echoing it", () => {
    const result = validateStudentAdditionInput(
      { ...validInput },
      {
        mode: PHONE_REGISTRATION_MODE,
        today: new Date("2026-07-01T00:00:00Z"),
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected restricted Phone-mode fields to be rejected");
    expect(result.fieldErrors).toMatchObject({
      pen_number: "PEN Number is not accepted in Phone Registration Mode",
      g10_roll_no: "Grade 10 Roll no is not accepted in Phone Registration Mode",
      annual_family_income: "Annual Family Income is not accepted in Phone Registration Mode",
    });
    expect(result.row).not.toHaveProperty("pen_number");
    expect(result.row).not.toHaveProperty("g10_roll_no");
    expect(result.row).not.toHaveProperty("annual_family_income");
    expect(result.generatedStudentId).toBe("9876543210");
  });

  it("rejects periods in manually entered student names", () => {
    const result = validateStudentAdditionInput({ ...validInput, student_name: "Asha.Kumar" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors.student_name).toBe("Student Name should not contain '.'");
  });

  it("rejects leading-zero phone and CBSE roll numbers", () => {
    const result = validateStudentAdditionInput({
      ...validInput,
      phone: "0876543210",
      g10_roll_no: "02345678",
    }, { mode: APPROVED_REGISTRATION_MODE });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors.phone).toBe("Enter a valid phone number");
    expect(result.fieldErrors.g10_roll_no).toContain("cannot start with zero");
    expect(canonicalizeStudentEditPayload(
      { phone: "0876543210" },
      { mode: APPROVED_REGISTRATION_MODE },
    ).ok).toBe(false);
  });

  it("uses the approved bulk DOB format message", () => {
    const result = validateStudentAdditionInput(
      { ...validInput, date_of_birth: "not-a-date" },
      { bulkUpload: true, mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors.date_of_birth).toBe(
      "Date of Birth must be DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY",
    );
  });

  it("accepts Father Name as optional text", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        father_name: "Ravi D'Souza-2",
      },
      { mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(true);
  });

  it("uses an 11-digit PEN as the canonical optional identifier", () => {
    const result = validateStudentAdditionInput(
      { ...validInput, apaar_id: undefined, pen_number: "12345678901" },
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row).toMatchObject({ pen_number: "12345678901" });
    expect(result.row).not.toHaveProperty("apaar_id");
  });

  it("keeps an 11-digit PEN starting with zero", () => {
    const result = validateStudentAdditionInput(
      { ...validInput, pen_number: "01234567890" },
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(true);
    expect(result.row.pen_number).toBe("01234567890");
  });

  it.each(["1234567890", "123456789012", "1234567890A"])(
    "rejects invalid PEN %s",
    (pen_number) => {
      const result = validateStudentAdditionInput(
        { ...validInput, pen_number },
        { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
      );

      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected invalid input");
      expect(result.fieldErrors.pen_number).toBe("PEN must be exactly 11 digits");
    },
  );

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
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row).toMatchObject({
      date_of_birth: "2010-01-02",
      gender: "Other",
      category: "PWD-EWS",
      physically_handicapped: true,
      g10_board: "Others",
      g10_roll_no: "AB12Z",
      stream: "nda",
    });
    expect(result.generatedStudentId).toBe("2028AB12Z");
  });

  it("canonicalizes all option labels and maps a case-insensitive PWD category", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        category: "  gEn-eWs ",
        physically_handicapped: "Yes",
        gender: "  fEMALE ",
        g10_board: "  oThErS ",
        board_stream: "  cOmMeRcE (wItHoUt MaTh) ",
        annual_family_income: "  lEsS tHaN rS. 1,00,000 ",
      },
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row).toMatchObject({
      gender: "Female",
      category: "PWD-EWS",
      g10_board: "Others",
      board_stream: "Commerce (Without Math)",
      annual_family_income: "Less than Rs. 1,00,000",
    });
  });

  it("uses the canonical CBSE board for lowercase CBSE roll validation", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        pen_number: "",
        g10_board: "  cbse ",
        g10_roll_no: "01234567",
      },
      { mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid CBSE roll");
    expect(result.row.g10_board).toBe(CBSE_BOARD);
    expect(result.fieldErrors.g10_roll_no).toBe(
      "CBSE Grade 10 Roll no must be exactly 8 digits and cannot start with zero",
    );
  });

  it.each([
    ["gender", "Femalee", "Gender must be Female, Male, or Other"],
    ["category", "Gen EWS", "Category is not valid"],
    ["g10_board", "CBSE?", "G10 board must be CBSE or Others"],
    ["board_stream", "PC-M", "Board Stream is not valid"],
    ["annual_family_income", "Less than Rs 1,00,000", "Annual Family Income is not valid"],
  ] as const)("rejects an invalid near-match for %s", (field, value, message) => {
    const result = validateStudentAdditionInput({
      ...validInput,
      [field]: value,
    }, { mode: APPROVED_REGISTRATION_MODE });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors[field]).toBe(message);
  });

  it("keeps Phone-mode income restricted even when its value matches case-insensitively", () => {
    const result = validateStudentAdditionInput(
      {
        grade: "12",
        student_name: "Asha Kumar",
        date_of_birth: "02/01/2010",
        gender: "female",
        category: "gen",
        physically_handicapped: "No",
        g10_board: "cbse",
        board_stream: "pcm",
        stream: "Engineering",
        father_name: "Ravi Kumar",
        phone: "6876543210",
        annual_family_income: "less than rs. 1,00,000",
      },
      { mode: PHONE_REGISTRATION_MODE, today: new Date("2026-07-01T00:00:00Z") },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected restricted Phone-mode income");
    expect(result.fieldErrors).toEqual({
      annual_family_income: "Annual Family Income is not accepted in Phone Registration Mode",
    });
    expect(result.row).not.toHaveProperty("annual_family_income");
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
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.row.date_of_birth).toBe(expected);
  });

  it("normalizes the canonical single-student fields and generates the Grade 11 Student ID", () => {
    const result = validateStudentAdditionInput(validInput, {
      today: new Date("2026-07-01T00:00:00Z"),
      mode: APPROVED_REGISTRATION_MODE,
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
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
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
        pen_number: "123",
        g10_roll_no: "ABC123",
        father_name: "Ravi123",
      },
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors).toMatchObject({
      date_of_birth: "Date of Birth must be between 2000 and 2015",
      phone: "Enter a valid phone number",
      pen_number: "PEN must be exactly 11 digits",
      g10_roll_no: "CBSE Grade 10 Roll no must be exactly 8 digits and cannot start with zero",
    });
    expect(result.fieldErrors).not.toHaveProperty("father_name");
  });

  it("accepts uppercase alphanumeric non-CBSE Grade 10 rolls", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        pen_number: "",
        g10_board: "Others",
        g10_roll_no: " 00 ab-12 z ",
      },
      { today: new Date("2026-07-01T00:00:00Z"), mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected valid input");
    expect(result.row.g10_roll_no).toBe("AB12Z");
    expect(result.generatedStudentId).toBe("2028AB12Z");
  });

  it("rejects an Others roll that becomes too short after normalization", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        g10_board: "Others",
        g10_roll_no: "0000",
      },
      { mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors.g10_roll_no).toBe(
      "Grade 10 Roll no must be 4 to 10 characters",
    );
  });

  it("rejects CBSE rolls that are not already exactly eight digits", () => {
    const result = validateStudentAdditionInput(
      {
        ...validInput,
        g10_roll_no: "1234-5678",
      },
      { mode: APPROVED_REGISTRATION_MODE },
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected invalid input");
    expect(result.fieldErrors.g10_roll_no).toBe(
      "CBSE Grade 10 Roll no must be exactly 8 digits and cannot start with zero",
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
      { academicYear: "2027-2028", mode: APPROVED_REGISTRATION_MODE },
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
        APPROVED_REGISTRATION_MODE,
      ),
    ).toContain("Student ID: 2028AB12Z | PEN: 12345678901 | APAAR: 123456789012");
  });

  it("does not claim a same-school match when school details are unavailable", () => {
    expect(
      formatStudentAdditionExistingMatch(
        { student_id: "2028AB12Z" },
        "JNV001",
        APPROVED_REGISTRATION_MODE,
      ),
    ).toBe(
      "This student identifier already exists, but its school could not be identified. Student ID: 2028AB12Z. Please contact the admin.",
    );
  });

  it("describes a same-school identifier without claiming the student identity", () => {
    expect(
      formatStudentAdditionExistingMatch(
        { student_id: "2028AB12Z", school_code: "JNV001" },
        "JNV001",
        APPROVED_REGISTRATION_MODE,
      ),
    ).toBe("This student identifier is already part of this school. Student ID: 2028AB12Z.");
  });

  it("uses the submitted phone when Phone-mode match context omits Student ID", () => {
    expect(
      formatStudentAdditionExistingMatch(
        { school_code: "JNV001" },
        "JNV001",
        PHONE_REGISTRATION_MODE,
        "6876543210",
      ),
    ).toBe(
      "This student identifier is already part of this school. Student ID / Phone Number: 6876543210.",
    );
  });
});
