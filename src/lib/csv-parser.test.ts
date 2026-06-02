import { describe, expect, it } from "vitest";

import { parseCsvText } from "./csv-parser";

describe("parseCsvText", () => {
  it("returns empty headers and rows for empty input", () => {
    expect(parseCsvText("")).toEqual({ headers: [], rows: [] });
  });

  it("parses RFC 4180 CSV with BOM, quoted commas, embedded newlines, CRLF, and trimmed fields", () => {
    const csv = "\uFEFFmentor_email,student_id,notes\r\n" +
      '" Mentor@AvantiFellows.Org "," STU-001 ","needs, support"\r\n' +
      '"second@avantifellows.org","STU-002","line one\r\nline two"';

    expect(parseCsvText(csv)).toEqual({
      headers: ["mentor_email", "student_id", "notes"],
      rows: [
        {
          mentor_email: "Mentor@AvantiFellows.Org",
          student_id: "STU-001",
          notes: "needs, support",
        },
        {
          mentor_email: "second@avantifellows.org",
          student_id: "STU-002",
          notes: "line one\nline two",
        },
      ],
    });
  });

  it("handles escaped quotes, empty fields, LF line endings, and missing trailing newline", () => {
    expect(parseCsvText('mentor_email,student_id,note\n"a""b@avantifellows.org",," ok "')).toEqual({
      headers: ["mentor_email", "student_id", "note"],
      rows: [
        {
          mentor_email: 'a"b@avantifellows.org',
          student_id: "",
          note: "ok",
        },
      ],
    });
  });

  it("preserves extra columns in parsed output", () => {
    expect(parseCsvText("mentor_email,student_id,extra\nm@example.org,STU-001,value")).toEqual({
      headers: ["mentor_email", "student_id", "extra"],
      rows: [{ mentor_email: "m@example.org", student_id: "STU-001", extra: "value" }],
    });
  });
});
