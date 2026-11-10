import { describe, expect, it } from "vitest";

import {
  JEE_FORM_REASONS,
  confirmationError,
  jeeFormFlagComment,
  validateJeeForm,
} from "./blended-learning-jee-form-input";

describe("the JEE form reasons", () => {
  it("are the program team's ten reasons, worded as their sheet, then Other", () => {
    expect(JEE_FORM_REASONS.map((reason) => reason.label)).toEqual([
      "Certificate is not available",
      "Issue In Documents",
      "Difficulty in filling the form",
      "Will fill the form after parent's get the salary",
      "Personal Issues",
      "Not interested for JEE exam",
      "Not prepared for the exam",
      "Will attempt Phase -2 test",
      "Not sharing registration details",
      "Not aware about the exam",
      "Other",
    ]);
  });
});

describe("validateJeeForm", () => {
  it("needs a status", () => {
    expect(validateJeeForm({})).toEqual({ ok: false, fieldErrors: { status: "Choose Filled or Not filled." } });
    expect(validateJeeForm({ status: "maybe" }).ok).toBe(false);
  });

  it("takes a trimmed application number for Filled and ignores the Not filled fields", () => {
    expect(validateJeeForm({ status: "filled", applicationNumber: " 2703 ", reasons: ["other"], details: "x" })).toEqual({
      ok: true,
      input: { status: "filled", applicationNumber: "2703" },
    });
    expect(validateJeeForm({ status: "filled", applicationNumber: " " })).toEqual({
      ok: false,
      fieldErrors: { applicationNumber: "Enter the application number." },
    });
    expect(validateJeeForm({ status: "filled", applicationNumber: "1".repeat(256) }).ok).toBe(false);
    expect(validateJeeForm({ status: "filled", applicationNumber: "1".repeat(255) }).ok).toBe(true);
  });

  it("takes Not filled reasons in the list's order without repeats, with optional details", () => {
    expect(
      validateJeeForm({ status: "not_filled", reasons: ["not_aware", "personal_issues", "not_aware"], details: "  " })
    ).toEqual({ ok: true, input: { status: "not_filled", reasons: ["personal_issues", "not_aware"], details: null } });
  });

  it("needs at least one known reason", () => {
    expect(validateJeeForm({ status: "not_filled", reasons: [] })).toEqual({
      ok: false,
      fieldErrors: { reasons: "Choose at least one reason." },
    });
    expect(validateJeeForm({ status: "not_filled" }).ok).toBe(false);
    expect(validateJeeForm({ status: "not_filled", reasons: ["not_aware", "Not aware about the exam"] })).toEqual({
      ok: false,
      fieldErrors: { reasons: "Choose reasons from the list." },
    });
  });

  it("needs details when Other is chosen, and caps them at 2000 characters", () => {
    expect(validateJeeForm({ status: "not_filled", reasons: ["other"], details: " " })).toEqual({
      ok: false,
      fieldErrors: { details: "Describe the other reason." },
    });
    expect(validateJeeForm({ status: "not_filled", reasons: ["other"], details: " Moved house " })).toEqual({
      ok: true,
      input: { status: "not_filled", reasons: ["other"], details: "Moved house" },
    });
    expect(validateJeeForm({ status: "not_filled", reasons: ["not_aware"], details: "a".repeat(2001) }).ok).toBe(false);
    expect(validateJeeForm({ status: "not_filled", reasons: ["not_aware"], details: 5 }).ok).toBe(false);
  });
});

describe("confirmationError", () => {
  it("accepts a PDF up to 5 MB, including a .pdf a phone sends without a type", () => {
    expect(confirmationError({ name: "c.pdf", type: "application/pdf", size: 5 * 1024 * 1024 })).toBeNull();
    expect(confirmationError({ name: "C.PDF", type: "", size: 10 })).toBeNull();
  });

  it("refuses anything else, an empty file and one over 5 MB", () => {
    expect(confirmationError({ name: "c.jpg", type: "image/jpeg", size: 10 })).toBe("Choose a PDF file.");
    expect(confirmationError({ name: "c", type: "", size: 10 })).toBe("Choose a PDF file.");
    expect(confirmationError({ name: "c.pdf", type: "application/pdf", size: 0 })).toBe("This PDF is empty.");
    expect(confirmationError({ name: "c.pdf", type: "application/pdf", size: 5 * 1024 * 1024 + 1 })).toBe(
      "The PDF must be 5 MB or smaller."
    );
  });
});

describe("jeeFormFlagComment", () => {
  it("names the exam and the reasons, then the details when given", () => {
    expect(jeeFormFlagComment({ reasons: ["phase_two"], details: null })).toBe(
      "JEE Main 2027 form not filled: Will attempt Phase -2 test"
    );
    expect(jeeFormFlagComment({ reasons: ["form_difficulty", "other"], details: "Portal was down" })).toBe(
      "JEE Main 2027 form not filled: Difficulty in filling the form; Other\nDetails: Portal was down"
    );
  });
});
