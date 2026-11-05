import { describe, expect, it } from "vitest";

import {
  isHttpsUrl,
  parseStudentIds,
  validateCommonItem,
  validateCommonItemEdit,
  validateResource,
  validateTarget,
} from "./blended-learning-manage-input";

describe("isHttpsUrl", () => {
  it.each(["https://docs.google.com/document/d/abc/edit?usp=sharing", "https://example.org"])("accepts %s", (url) => {
    expect(isHttpsUrl(url)).toBe(true);
  });

  it.each(["http://example.org", "https://", "https://exa mple.org", "example.org", "ftp://example.org", "https://[::1"])(
    "rejects %s",
    (url) => {
      expect(isHttpsUrl(url)).toBe(false);
    }
  );
});

describe("validateResource", () => {
  it("trims the title and link", () => {
    expect(validateResource({ title: "  Exam stress guide ", url: " https://example.org/guide " })).toEqual({
      ok: true,
      input: { title: "Exam stress guide", url: "https://example.org/guide" },
    });
  });

  it("asks for a title and an https link", () => {
    expect(validateResource({ title: "  ", url: "" })).toEqual({
      ok: false,
      fieldErrors: { title: "Enter a title.", url: "Enter a link." },
    });
    expect(validateResource({ title: "a".repeat(201), url: "http://example.org" })).toEqual({
      ok: false,
      fieldErrors: {
        title: "Keep the title to 200 characters.",
        url: "Enter a full link starting with https://",
      },
    });
    expect(validateResource(null)).toMatchObject({ ok: false });
    expect(validateResource({ title: "a".repeat(200), url: "https://example.org" })).toMatchObject({ ok: true });
  });
});

describe("validateCommonItemEdit", () => {
  it("takes trimmed text and a known owner", () => {
    expect(validateCommonItemEdit({ text: " Fill in the form ", owner: "parent" })).toEqual({
      ok: true,
      input: { text: "Fill in the form", owner: "parent" },
    });
  });

  it("rejects blank or long text and an unknown owner", () => {
    expect(validateCommonItemEdit({ text: " ", owner: "sibling" })).toEqual({
      ok: false,
      fieldErrors: { text: "Enter the action item.", owner: "Choose who does it." },
    });
    // 200, though the DB allows 500: a pushed item is one concise line.
    expect(validateCommonItemEdit({ text: "a".repeat(200), owner: "student" })).toMatchObject({ ok: true });
    expect(validateCommonItemEdit({ text: "a".repeat(201), owner: "student" })).toEqual({
      ok: false,
      fieldErrors: { text: "Keep it to 200 characters." },
    });
  });
});

describe("validateTarget", () => {
  it("takes all, a grade of 12 or 13, or a Mentor, from a body or a query string", () => {
    expect(validateTarget({ kind: "all", grade: "99" })).toEqual({ ok: true, input: { kind: "all" } });
    expect(validateTarget({ kind: "grade", grade: 13 })).toEqual({ ok: true, input: { kind: "grade", grade: 13 } });
    expect(validateTarget({ kind: "grade", grade: "12" })).toEqual({ ok: true, input: { kind: "grade", grade: 12 } });
    expect(validateTarget({ kind: "mentor", mentorUserId: "77" })).toEqual({
      ok: true,
      input: { kind: "mentor", mentorUserId: 77 },
    });
  });

  it.each([
    [{ kind: "grade", grade: "11" }, { grade: "Choose grade 12 or 13." }],
    [{ kind: "grade" }, { grade: "Choose grade 12 or 13." }],
    [{ kind: "mentor", mentorUserId: "" }, { mentorUserId: "Choose a mentor." }],
    [{ kind: "mentor", mentorUserId: -3 }, { mentorUserId: "Choose a mentor." }],
    [{ kind: "mentor", mentorUserId: 1.5 }, { mentorUserId: "Choose a mentor." }],
    [{ kind: "everyone" }, { target: "Choose who gets it." }],
    [undefined, { target: "Choose who gets it." }],
  ])("rejects %j", (raw, fieldErrors) => {
    expect(validateTarget(raw)).toEqual({ ok: false, fieldErrors });
  });
});

describe("parseStudentIds", () => {
  it("splits on whitespace, commas and new lines, keeps leading zeros and drops repeats", () => {
    expect(parseStudentIds(" 01234567890,12345678\n\n0098765432\t01234567890 , ")).toEqual([
      "01234567890",
      "12345678",
      "0098765432",
    ]);
    expect(parseStudentIds(["0011 0022", 7, "0011"])).toEqual(["0011", "0022"]);
    expect(parseStudentIds(undefined)).toEqual([]);
  });
});

describe("validateTarget — specific students", () => {
  it("takes pasted IDs", () => {
    expect(validateTarget({ kind: "students", studentIds: "0012345678, 12345678" })).toEqual({
      ok: true,
      input: { kind: "students", studentIds: ["0012345678", "12345678"] },
    });
  });

  it.each([
    [" ,\n ", "Paste at least one Student ID."],
    [undefined, "Paste at least one Student ID."],
    [Array.from({ length: 1001 }, (_, i) => `ID${i}`).join(" "), "Paste at most 1000 Student IDs."],
    ["x".repeat(65), "One of these isn't a Student ID."],
  ])("rejects %j", (studentIds, message) => {
    expect(validateTarget({ kind: "students", studentIds })).toEqual({ ok: false, fieldErrors: { studentIds: message } });
  });
});

describe("validateCommonItem", () => {
  it("combines the edit and the target", () => {
    expect(
      validateCommonItem({ text: "Fill in the form", owner: "student", target: { kind: "grade", grade: 12 } })
    ).toEqual({ ok: true, input: { text: "Fill in the form", owner: "student", target: { kind: "grade", grade: 12 } } });
  });

  it("reports every field's error together", () => {
    expect(validateCommonItem({ text: "", owner: "student", target: { kind: "mentor" } })).toEqual({
      ok: false,
      fieldErrors: { text: "Enter the action item.", mentorUserId: "Choose a mentor." },
    });
    expect(validateCommonItem({ text: "Fill in the form", owner: "student" })).toEqual({
      ok: false,
      fieldErrors: { target: "Choose who gets it." },
    });
  });
});
