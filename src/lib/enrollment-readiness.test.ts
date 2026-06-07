import { describe, it, expect } from "vitest";
import type { Student } from "@/components/StudentTable";
import {
  ADMISSION_GRADE,
  CONSENT_REQUIRED_DOC_TYPES,
  INFO_REQUIRED_FIELDS,
  isInfoComplete,
  isReported,
  missingConsentDocs,
  buildAdmissionSummary,
} from "./enrollment-readiness";

// Build a Student with every INFO_REQUIRED_FIELDS value filled; override to
// blank out specific fields per test.
function completeStudent(overrides: Partial<Student> = {}): Student {
  const base: Partial<Student> = {
    group_user_id: "gu-1",
    user_id: "u-1",
    student_pk_id: "1",
    program_name: "NVS",
    program_id: 64,
    grade: ADMISSION_GRADE,
    grade_id: "g-11",
    status: null,
    updated_at: null,
  };
  for (const field of INFO_REQUIRED_FIELDS) {
    (base as Record<string, unknown>)[field] = `${field}-value`;
  }
  return { ...base, ...overrides } as Student;
}

describe("config integrity", () => {
  it("admission grade is 11", () => {
    expect(ADMISSION_GRADE).toBe(11);
  });

  it("requires parent + WISE consent", () => {
    expect([...CONSENT_REQUIRED_DOC_TYPES]).toEqual([
      "parent_undertaking",
      "wise_research_consent",
    ]);
  });
});

describe("isInfoComplete", () => {
  it("true when every required field is filled", () => {
    expect(isInfoComplete(completeStudent())).toBe(true);
  });

  it("false when a required field is null", () => {
    expect(isInfoComplete(completeStudent({ phone: null }))).toBe(false);
  });

  it("false when a required field is blank/whitespace", () => {
    expect(isInfoComplete(completeStudent({ address: "   " }))).toBe(false);
  });

  it("ignores fields outside the required set", () => {
    // monthly_family_income is not required → still complete when blank.
    expect(isInfoComplete(completeStudent({ monthly_family_income: "" }))).toBe(
      true,
    );
  });
});

describe("isReported", () => {
  it("true only when all required consent docs present", () => {
    expect(isReported(["parent_undertaking", "wise_research_consent"])).toBe(
      true,
    );
  });

  it("false when missing one consent doc", () => {
    expect(isReported(["parent_undertaking"])).toBe(false);
  });

  it("false for undefined / empty", () => {
    expect(isReported(undefined)).toBe(false);
    expect(isReported([])).toBe(false);
  });

  it("extra non-required docs don't satisfy the requirement", () => {
    expect(isReported(["income_certificate"])).toBe(false);
  });
});

describe("missingConsentDocs", () => {
  it("lists the required docs that are absent", () => {
    expect(missingConsentDocs(["parent_undertaking"])).toEqual([
      "wise_research_consent",
    ]);
  });

  it("returns empty when all present", () => {
    expect(
      missingConsentDocs(["parent_undertaking", "wise_research_consent"]),
    ).toEqual([]);
  });

  it("returns all when none present", () => {
    expect(missingConsentDocs(undefined)).toEqual([
      "parent_undertaking",
      "wise_research_consent",
    ]);
  });
});

describe("buildAdmissionSummary", () => {
  it("returns zeros for an empty roster", () => {
    expect(buildAdmissionSummary([], {})).toEqual({
      total: 0,
      reported: 0,
      infoAvailable: 0,
      infoAvailablePct: 0,
      docsAvailablePct: 0,
    });
  });

  it("counts reported, info, and doc-slot percentages", () => {
    const students = [
      completeStudent({ student_pk_id: "1" }), // info complete
      completeStudent({ student_pk_id: "2", phone: null }), // info incomplete
      completeStudent({ student_pk_id: "3" }), // info complete
      completeStudent({ student_pk_id: "4" }), // info complete
    ];
    const consent = {
      "1": ["parent_undertaking", "wise_research_consent"], // reported, 2 slots
      "2": ["parent_undertaking"], // not reported, 1 slot
      "3": [], // not reported, 0 slots
      // "4" absent → 0 slots
    };

    const summary = buildAdmissionSummary(students, consent);
    expect(summary.total).toBe(4);
    expect(summary.reported).toBe(1); // only student 1 has both
    expect(summary.infoAvailable).toBe(3); // 1, 3, 4
    expect(summary.infoAvailablePct).toBe(75); // 3/4
    // doc slots: (2 + 1 + 0 + 0) / (4 students * 2 required) = 3/8 = 37.5 → 38
    expect(summary.docsAvailablePct).toBe(38);
  });

  it("ignores non-required doc types in the slot count", () => {
    const students = [completeStudent({ student_pk_id: "1" })];
    const consent = { "1": ["income_certificate", "parent_undertaking"] };
    const summary = buildAdmissionSummary(students, consent);
    // only parent_undertaking counts → 1 / (1*2) = 50%
    expect(summary.docsAvailablePct).toBe(50);
    expect(summary.reported).toBe(0);
  });

  it("treats students with no pk id as unreported", () => {
    const students = [completeStudent({ student_pk_id: null })];
    const summary = buildAdmissionSummary(students, {});
    expect(summary.reported).toBe(0);
    expect(summary.total).toBe(1);
  });
});
