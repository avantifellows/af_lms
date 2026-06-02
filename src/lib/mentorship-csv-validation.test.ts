import { describe, expect, it } from "vitest";

import { validateUploadRows } from "./mentorship-csv-validation";

describe("validateUploadRows", () => {
  it("returns validated rows for valid upload rows", () => {
    const result = validateUploadRows(
      [{ mentor_email: "MENTOR@AVANTIFELLOWS.ORG", student_id: "STU-001" }],
      new Map([["mentor@avantifellows.org", { id: 21, email: "mentor@avantifellows.org" }]]),
      new Map([
        [
          "STU-001",
          [
            {
              user_id: 1001,
              student_id: "STU-001",
              status: null,
              selected_school_match_count: 1,
              school_membership_count: 1,
            },
          ],
        ],
      ]),
      new Set()
    );

    expect(result).toEqual({
      valid: true,
      errors: [],
      validatedRows: [
        {
          row: 2,
          mentor_id: 21,
          mentee_id: 1001,
          mentor_email: "mentor@avantifellows.org",
          student_id: "STU-001",
        },
      ],
    });
  });

  it("accepts an empty rows array", () => {
    expect(validateUploadRows([], new Map(), new Map(), new Set())).toEqual({
      valid: true,
      errors: [],
      validatedRows: [],
    });
  });

  it("trims fields, validates all rows, and aggregates errors including duplicate student IDs", () => {
    const result = validateUploadRows(
      [
        { mentor_email: " mentor@avantifellows.org ", student_id: " STU-001 " },
        { mentor_email: "missing@avantifellows.org", student_id: "STU-002" },
        { mentor_email: "mentor@avantifellows.org", student_id: "STU-001" },
        { mentor_email: "", student_id: "" },
      ],
      new Map([["mentor@avantifellows.org", { id: 21, email: "mentor@avantifellows.org" }]]),
      new Map([
        [
          "STU-001",
          [
            {
              user_id: 1001,
              student_id: "STU-001",
              status: null,
              selected_school_match_count: 1,
              school_membership_count: 1,
            },
          ],
        ],
      ]),
      new Set([1001])
    );

    expect(result.valid).toBe(false);
    expect(result.validatedRows).toEqual([
      {
        row: 2,
        mentor_id: 21,
        mentee_id: 1001,
        mentor_email: "mentor@avantifellows.org",
        student_id: "STU-001",
      },
    ]);
    expect(result.errors).toEqual([
      { row: 2, field: "student_id", message: "Student already has an active mentor" },
      { row: 3, field: "mentor_email", message: "Mentor is not eligible at this school" },
      { row: 3, field: "student_id", message: "Student not found" },
      { row: 4, field: "student_id", message: "Duplicate student_id in upload" },
      { row: 5, field: "mentor_email", message: "mentor_email is required" },
      { row: 5, field: "student_id", message: "student_id is required" },
    ]);
  });

  it("reports dropout, duplicate database records, and school membership anomalies", () => {
    const result = validateUploadRows(
      [
        { mentor_email: "mentor@avantifellows.org", student_id: "DROP" },
        { mentor_email: "mentor@avantifellows.org", student_id: "MULTI" },
        { mentor_email: "mentor@avantifellows.org", student_id: "OTHER" },
        { mentor_email: "mentor@avantifellows.org", student_id: "DUPDB" },
      ],
      new Map([["mentor@avantifellows.org", { id: 21, email: "mentor@avantifellows.org" }]]),
      new Map([
        [
          "DROP",
          [
            {
              user_id: 1001,
              student_id: "DROP",
              status: "dropout",
              selected_school_match_count: 1,
              school_membership_count: 1,
            },
          ],
        ],
        [
          "MULTI",
          [
            {
              user_id: 1002,
              student_id: "MULTI",
              status: null,
              selected_school_match_count: 1,
              school_membership_count: 2,
            },
          ],
        ],
        [
          "OTHER",
          [
            {
              user_id: 1003,
              student_id: "OTHER",
              status: null,
              selected_school_match_count: 0,
              school_membership_count: 1,
            },
          ],
        ],
        [
          "DUPDB",
          [
            {
              user_id: 1004,
              student_id: "DUPDB",
              status: null,
              selected_school_match_count: 1,
              school_membership_count: 1,
            },
            {
              user_id: 1005,
              student_id: "DUPDB",
              status: null,
              selected_school_match_count: 1,
              school_membership_count: 1,
            },
          ],
        ],
      ]),
      new Set()
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      { row: 2, field: "student_id", message: "Student is a dropout" },
      { row: 3, field: "student_id", message: "Student has multiple school memberships" },
      { row: 4, field: "student_id", message: "Student is not enrolled at selected school" },
      { row: 5, field: "student_id", message: "Multiple students found for student_id" },
    ]);
  });
});
