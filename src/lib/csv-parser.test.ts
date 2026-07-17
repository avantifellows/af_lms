import { describe, expect, it } from "vitest";

import { parseCsvText } from "./csv-parser";

describe("parseCsvText", () => {
  it("parses CSV previews with quoted commas and missing values", () => {
    expect(
      parseCsvText(
        '\uFEFFmentor_email,student_id,notes\r\n" Mentor@AvantiFellows.Org ","","needs, support"'
      )
    ).toEqual({
      headers: ["mentor_email", "student_id", "notes"],
      rows: [
        {
          mentor_email: "Mentor@AvantiFellows.Org",
          student_id: "",
          notes: "needs, support",
        },
      ],
    });
  });
});
