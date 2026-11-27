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
    expect(
      validateJeeForm({ status: "filled", applicationNumber: " 2703 ", sessions: [1], reasons: ["other"], details: "x" })
    ).toEqual({
      ok: true,
      input: { status: "filled", applicationNumber: "2703", password: null, sessions: [1] },
    });
    expect(validateJeeForm({ status: "filled", applicationNumber: " ", sessions: [1] })).toEqual({
      ok: false,
      fieldErrors: { applicationNumber: "Enter the application number." },
    });
    expect(validateJeeForm({ status: "filled", applicationNumber: "1".repeat(256), sessions: [1] }).ok).toBe(false);
    expect(validateJeeForm({ status: "filled", applicationNumber: "1".repeat(255), sessions: [1] }).ok).toBe(true);
  });

  it("needs the exam portal password for Filled while none is saved, and keeps a saved one when left blank", () => {
    const filled = { status: "filled", applicationNumber: "2703", sessions: [1, 2] };
    expect(validateJeeForm({ ...filled, password: "  " }, { requirePassword: true })).toEqual({
      ok: false,
      fieldErrors: { password: "Enter the exam portal password." },
    });
    // Both missing fields are named at once.
    expect(validateJeeForm({ status: "filled", applicationNumber: "", sessions: [1] }, { requirePassword: true })).toEqual({
      ok: false,
      fieldErrors: { applicationNumber: "Enter the application number.", password: "Enter the exam portal password." },
    });
    expect(validateJeeForm({ ...filled, password: " fake-secret-1 " }, { requirePassword: true })).toEqual({
      ok: true,
      input: { status: "filled", applicationNumber: "2703", password: "fake-secret-1", sessions: [1, 2] },
    });
    expect(validateJeeForm({ ...filled, password: "" })).toEqual({
      ok: true,
      input: { status: "filled", applicationNumber: "2703", password: null, sessions: [1, 2] },
    });
  });

  it("needs at least one session for Filled, as numbers (the tab) or text (multipart), deduped and sorted", () => {
    const filled = { status: "filled", applicationNumber: "2703" };
    const required = "Choose the session the student applied for: Session 1, Session 2 or both.";
    for (const sessions of [undefined, null, []]) {
      expect(validateJeeForm({ ...filled, sessions })).toEqual({ ok: false, fieldErrors: { sessions: required } });
    }
    // Named with the other missing fields at once.
    expect(validateJeeForm({ status: "filled", applicationNumber: "" })).toEqual({
      ok: false,
      fieldErrors: { applicationNumber: "Enter the application number.", sessions: required },
    });
    expect(validateJeeForm({ ...filled, sessions: ["2", "1", "2"] })).toEqual({
      ok: true,
      input: { status: "filled", applicationNumber: "2703", password: null, sessions: [1, 2] },
    });
    expect(validateJeeForm({ ...filled, sessions: [2] })).toMatchObject({ ok: true, input: { sessions: [2] } });
  });

  it("refuses a session the Exams tab doesn't allow for JEE Mains", () => {
    const filled = { status: "filled", applicationNumber: "2703" };
    const allowed = "Sessions applied for JEE Mains must be Session 1 or Session 2";
    for (const sessions of [[3], ["0"], [1, "x"], ["1.5"], [true], [null]]) {
      expect(validateJeeForm({ ...filled, sessions })).toEqual({ ok: false, fieldErrors: { sessions: allowed } });
    }
    expect(validateJeeForm({ ...filled, sessions: "1" })).toEqual({
      ok: false,
      fieldErrors: { sessions: "Sessions applied for JEE Mains is not valid" },
    });
  });

  it("ignores sessions for Not filled", () => {
    expect(validateJeeForm({ status: "not_filled", reasons: ["not_aware"], sessions: [9] })).toEqual({
      ok: true,
      input: { status: "not_filled", reasons: ["not_aware"], details: null },
    });
  });

  it("refuses a password that isn't text or is over 255 characters, and ignores it for Not filled", () => {
    const filled = { status: "filled", applicationNumber: "2703", sessions: [1, 2] };
    expect(validateJeeForm({ ...filled, password: 42 })).toEqual({
      ok: false,
      fieldErrors: { password: "The password must be text." },
    });
    expect(validateJeeForm({ ...filled, password: "p".repeat(256) }).ok).toBe(false);
    expect(validateJeeForm({ ...filled, password: "p".repeat(255) }).ok).toBe(true);
    expect(
      validateJeeForm({ status: "not_filled", reasons: ["not_aware"], password: "" }, { requirePassword: true })
    ).toEqual({ ok: true, input: { status: "not_filled", reasons: ["not_aware"], details: null } });
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
