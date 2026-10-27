import { describe, it, expect } from "vitest";
import type { Student } from "@/components/StudentTable";
import { DOCUMENT_TYPES, type DocumentType } from "./document-types";
import {
  buildDataCompleteness,
  countStudentsMatching,
  documentFilterKey,
  examFilterKey,
  filterLabelFor,
  groupFilterKey,
  infoFilterKey,
  INFO_ITEMS,
  missingKeysForStudent,
  severityFor,
  studentMatchesCompletenessFilter,
  type DocumentTypesByStudentId,
} from "./data-completeness";

const ALL_DOCUMENT_TYPES = DOCUMENT_TYPES.map((type) => type.value);

// A Student with every tracked Info field filled; override to blank one out.
function student(overrides: Partial<Student> = {}): Student {
  return {
    group_user_id: `gu-${overrides.student_pk_id ?? "1"}`,
    user_id: `u-${overrides.student_pk_id ?? "1"}`,
    student_pk_id: "1",
    first_name: "Aarav",
    last_name: "Sharma",
    phone: "9876543210",
    email: null,
    date_of_birth: "2009-05-15",
    student_id: "STU001",
    pen_number: "12345678901",
    apaar_id: "APAAR001",
    category: "Gen",
    stream: "science",
    gender: "Male",
    board_stream: "PCM",
    address: "12 Main Road",
    father_name: "Suresh",
    mother_name: "Sunita",
    annual_family_income: "1 - 3 Lakhs",
    exam_records: [],
    program_name: "JNV CoE",
    program_id: 1,
    grade: 11,
    grade_id: "g-11",
    status: null,
    updated_at: null,
    ...overrides,
  } as Student;
}

/** Every document on file for each Student id listed. */
function allDocsFor(...ids: string[]): DocumentTypesByStudentId {
  return Object.fromEntries(
    ids.map((id) => [id, [...ALL_DOCUMENT_TYPES] as DocumentType[]]),
  );
}

function groupOf(
  completeness: ReturnType<typeof buildDataCompleteness>,
  key: "info" | "documents" | "exams",
) {
  return completeness.groups.find((group) => group.key === key)!;
}

describe("the tracked Info fields", () => {
  it("is the ten the Programs team asked for, locked identifiers last", () => {
    expect(INFO_ITEMS.map((item) => item.label)).toEqual([
      "Date of Birth",
      "Gender",
      "Category",
      "Parents Phone Number",
      "Annual Family Income",
      "Father Name",
      "Mother Name",
      "Address",
      "APAAR ID",
      "PEN / Grade 10 Roll no",
    ]);
  });

  it("locks only the two Edit Student cannot change", () => {
    expect(
      INFO_ITEMS.filter((item) => item.locked).map((item) => item.label),
    ).toEqual(["APAAR ID", "PEN / Grade 10 Roll no"]);
  });

  it("counts a Grade 10 roll number as the PEN item, and whitespace as blank", () => {
    const rollOnly = student({ pen_number: null, g10_roll_no: "12345678" });
    expect(missingKeysForStudent(rollOnly, null)).not.toContain(
      infoFilterKey("pen_or_roll"),
    );

    const neither = student({ pen_number: "   ", g10_roll_no: null });
    expect([...missingKeysForStudent(neither, null)]).toContain(
      infoFilterKey("pen_or_roll"),
    );
  });
});

describe("severity", () => {
  it("reads red from half the Students, amber from a fifth", () => {
    expect(severityFor(50, 100)).toBe("high");
    expect(severityFor(49, 100)).toBe("medium");
    expect(severityFor(20, 100)).toBe("medium");
    expect(severityFor(19, 100)).toBe("low");
  });

  it("is low for an empty roster rather than dividing by zero", () => {
    expect(severityFor(0, 0)).toBe("low");
  });
});

describe("the Info row", () => {
  it("counts the Students missing each field, worst first", () => {
    const students = [
      student({ student_pk_id: "1", address: null, mother_name: null }),
      student({ student_pk_id: "2", address: null }),
      student({ student_pk_id: "3", address: "   " }),
    ];

    const info = groupOf(buildDataCompleteness(students, null), "info");

    expect(info.items.map((item) => [item.label, item.missing])).toEqual([
      ["Address", 3],
      ["Mother Name", 1],
    ]);
  });

  it("is a slot percentage, so one blank field does not sink it", () => {
    // 2 Students × 10 fields = 20 slots, 3 of them blank → 85%.
    const students = [
      student({ student_pk_id: "1", address: null, apaar_id: null }),
      student({ student_pk_id: "2", address: null }),
    ];

    expect(groupOf(buildDataCompleteness(students, null), "info").pct).toBe(85);
  });

  it("counts a field against every Student in scope", () => {
    const students = [
      student({ student_pk_id: "1", address: null }),
      student({ student_pk_id: "2" }),
      student({ student_pk_id: "3" }),
    ];

    const address = groupOf(buildDataCompleteness(students, null), "info").items[0];

    expect(address.missing).toBe(1);
    expect(address.expected).toBe(3);
  });

  it("folds the fields nobody is missing into the complete list", () => {
    const info = groupOf(
      buildDataCompleteness([student({ address: null })], null),
      "info",
    );

    expect(info.items).toHaveLength(1);
    expect(info.complete).toHaveLength(INFO_ITEMS.length - 1);
    expect(info.complete).toContain("APAAR ID");
  });
});

describe("the Documents row", () => {
  it("waits for the bulk read rather than reporting everyone as missing", () => {
    const documents = groupOf(
      buildDataCompleteness([student()], null),
      "documents",
    );

    expect(documents.pending).toBe(true);
    expect(documents.items).toEqual([]);
  });

  it("counts all seven types and marks the two required ones", () => {
    const students = [student({ student_pk_id: "1" }), student({ student_pk_id: "2" })];
    const documents = groupOf(
      buildDataCompleteness(students, { "1": ["parent_undertaking"], "2": [] }),
      "documents",
    );

    expect(documents.items).toHaveLength(DOCUMENT_TYPES.length);
    const parent = documents.items.find(
      (item) => item.key === documentFilterKey("parent_undertaking"),
    )!;
    expect(parent.missing).toBe(1);
    expect(parent.required).toBe(true);
    expect(
      documents.items.find(
        (item) => item.key === documentFilterKey("caste_certificate"),
      )!.required,
    ).toBe(false);
    // 2 × 7 = 14 slots, one filled.
    expect(documents.pct).toBe(7);
  });

  it("reads 100% and an empty row when every document is on file", () => {
    const documents = groupOf(
      buildDataCompleteness([student({ student_pk_id: "1" })], allDocsFor("1")),
      "documents",
    );

    expect(documents.items).toEqual([]);
    expect(documents.complete).toHaveLength(DOCUMENT_TYPES.length);
    expect(documents.pct).toBe(100);
  });

  it("treats a Student with no record id as having nothing on file", () => {
    const documents = groupOf(
      buildDataCompleteness([student({ student_pk_id: null })], allDocsFor("1")),
      "documents",
    );

    expect(documents.pct).toBe(0);
  });
});

describe("the Exams row", () => {
  it("counts only the Students whose Board Stream calls for the exam", () => {
    const students = [
      student({ student_pk_id: "1", board_stream: "PCM" }),
      student({ student_pk_id: "2", board_stream: "PCB" }),
      student({ student_pk_id: "3", board_stream: "Commerce" }),
    ];

    const exams = groupOf(buildDataCompleteness(students, null), "exams");

    expect(exams.items.map((item) => [item.label, item.missing])).toEqual([
      ["JEE Mains", 1],
      ["NEET", 1],
    ]);
    // Two expected registrations, neither made.
    expect(exams.pct).toBe(0);
  });

  it("counts a PCMB Student against both exams, and a registration closes one", () => {
    const students = [
      student({
        student_pk_id: "1",
        board_stream: "PCMB",
        exam_records: [
          {
            id: 1,
            exam_id: 1,
            exam_name: "JEE Mains",
            application_number: "JEE1",
            has_password: true,
            sessions_applied: [1],
          },
        ],
      }),
    ];

    const exams = groupOf(buildDataCompleteness(students, null), "exams");

    expect(exams.items.map((item) => item.label)).toEqual(["NEET"]);
    expect(exams.complete).toEqual(["JEE Mains"]);
    expect(exams.pct).toBe(50);
  });

  it("says an exam is not expected instead of leaving the row silent", () => {
    const exams = groupOf(
      buildDataCompleteness([student({ board_stream: "PCM" })], null),
      "exams",
    );

    expect(exams.notes).toEqual([
      "NEET not expected — no Student on PCB or PCMB",
    ]);
  });

  it("reads 100% when no Student is expected to sit anything", () => {
    const exams = groupOf(
      buildDataCompleteness([student({ board_stream: "Arts" })], null),
      "exams",
    );

    expect(exams.items).toEqual([]);
    expect(exams.pct).toBe(100);
  });

  // The chip's colour and its spoken count both read against this, so an exam
  // ten of eleven PCB Students have not registered for is a red chip, not the
  // pale "10 of 77" it would be against the whole roster.
  it("counts against the Students the exam applies to, not the whole roster", () => {
    const students = [
      ...Array.from({ length: 10 }, (_, i) =>
        student({ student_pk_id: String(i + 1), board_stream: "PCB" }),
      ),
      ...Array.from({ length: 67 }, (_, i) =>
        student({ student_pk_id: String(i + 11), board_stream: "PCM" }),
      ),
    ];

    const neet = groupOf(buildDataCompleteness(students, null), "exams").items.find(
      (item) => item.label === "NEET",
    )!;

    expect(neet.missing).toBe(10);
    expect(neet.expected).toBe(10);
    expect(severityFor(neet.missing, neet.expected)).toBe("high");
    // What it would have been against the roster, and why that was wrong.
    expect(severityFor(neet.missing, students.length)).toBe("low");
  });

  it("says 'Not registered for', not 'Missing', on the filter line", () => {
    const completeness = buildDataCompleteness(
      [student({ board_stream: "PCM" })],
      null,
    );

    expect(filterLabelFor(completeness, examFilterKey("JEE Mains"))).toBe(
      "Not registered for JEE Mains",
    );
  });
});

describe("the filter behind a chip", () => {
  const students = [
    student({ student_pk_id: "1", address: null }),
    student({ student_pk_id: "2", apaar_id: null }),
    student({ student_pk_id: "3" }),
  ];
  const documents = { "1": ALL_DOCUMENT_TYPES, "2": [], "3": ALL_DOCUMENT_TYPES };

  it("matches exactly the Students the chip counted", () => {
    const completeness = buildDataCompleteness(students, documents);
    const address = groupOf(completeness, "info").items.find(
      (item) => item.key === infoFilterKey("address"),
    )!;

    expect(
      countStudentsMatching(students, address.key, documents),
    ).toBe(address.missing);
    expect(
      studentMatchesCompletenessFilter(students[0], address.key, documents),
    ).toBe(true);
    expect(
      studentMatchesCompletenessFilter(students[2], address.key, documents),
    ).toBe(false);
  });

  it("opens a group to the Students missing any of its items", () => {
    expect(
      countStudentsMatching(students, groupFilterKey("info"), documents),
    ).toBe(2);
    expect(
      countStudentsMatching(students, groupFilterKey("documents"), documents),
    ).toBe(1);
    // Every Student here is PCM with no registration.
    expect(
      countStudentsMatching(students, groupFilterKey("exams"), documents),
    ).toBe(3);
  });

  it("leaves documents out of the group filter until the bulk read lands", () => {
    expect(
      countStudentsMatching(students, groupFilterKey("documents"), null),
    ).toBe(0);
  });

  it("matches nobody for a key that is not on the table", () => {
    expect(countStudentsMatching(students, "info:nonsense", documents)).toBe(0);
    expect(filterLabelFor(buildDataCompleteness(students, documents), "info:nonsense")).toBeNull();
  });

  it("words the group filters as the table's own labels", () => {
    const completeness = buildDataCompleteness(students, documents);

    expect(filterLabelFor(completeness, groupFilterKey("info"))).toBe(
      "Any info missing",
    );
    expect(filterLabelFor(completeness, groupFilterKey("documents"))).toBe(
      "Any document missing",
    );
    expect(filterLabelFor(completeness, groupFilterKey("exams"))).toBe(
      "No exam registration",
    );
    expect(filterLabelFor(completeness, null)).toBeNull();
  });
});

describe("an empty roster", () => {
  it("reads 100% everywhere rather than dividing by zero", () => {
    const completeness = buildDataCompleteness([], {});

    expect(completeness.total).toBe(0);
    expect(completeness.groups.map((group) => group.pct)).toEqual([100, 100, 100]);
  });
});
