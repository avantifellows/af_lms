import { describe, it, expect } from "vitest";
import { CURRENT_ACADEMIC_YEAR } from "@/lib/constants";
import { parseBatchGrade, parseBatchStream } from "./batch-code";

describe("parseBatchGrade", () => {
  it("reads the grade token from legacy codes", () => {
    expect(parseBatchGrade("EnableStudents_11_Photon_Eng_24_N017")).toBe(11);
    expect(parseBatchGrade("EnableStudents_12_25_Engg_C08")).toBe(12);
    expect(parseBatchGrade("EnableStudents_11_25_Med_N06")).toBe(11);
    expect(parseBatchGrade("EnableStudents_12_25_Clat")).toBe(12);
  });

  it("does not mistake non-grade numeric tokens (years, cohort suffixes) for grades", () => {
    // "25" and "24" are year tokens, not grades; only 9–12 count.
    expect(parseBatchGrade("EnableStudents_11_25_Engg_N06")).toBe(11);
    expect(parseBatchGrade("EnableStudents_12_Photon_Eng_24_N017")).toBe(12);
  });

  it("derives the grade from the passing year for TP-style codes", () => {
    // Academic year 2026-2027: cohort passing 2027 is in grade 12, 2028 in grade 11.
    expect(parseBatchGrade("EnableStudents_TP_2027_med_C014", "2026-2027")).toBe(12);
    expect(parseBatchGrade("EnableStudents_TP_2028_eng_C029", "2026-2027")).toBe(11);
    expect(parseBatchGrade("EnableStudents_TP_2030_engg_C001", "2026-2027")).toBe(9);
  });

  it("returns null for TP cohorts that have already passed out", () => {
    expect(parseBatchGrade("EnableStudents_TP_2026_med_C014", "2026-2027")).toBeNull();
  });

  it("defaults to the current academic year for TP-style codes", () => {
    const end = Number(CURRENT_ACADEMIC_YEAR.split("-")[1]);
    const grade12Cohort = `EnableStudents_TP_${end}_med_C014`;
    expect(parseBatchGrade(grade12Cohort)).toBe(12);
  });

  it("returns null when neither a grade token nor a year is present", () => {
    expect(parseBatchGrade("EnableStudents")).toBeNull();
    expect(parseBatchGrade("EN-12-25-P01")).toBeNull();
    expect(parseBatchGrade("EnableStudents_TT_25_L002")).toBeNull();
  });
});

describe("parseBatchStream", () => {
  it("recognizes every engineering token variant seen in prod", () => {
    expect(parseBatchStream("EnableStudents_12_25_Engg_C08")).toBe("engineering");
    expect(parseBatchStream("EnableStudents_11_Photon_Eng_24_N017")).toBe("engineering");
    expect(parseBatchStream("EnableStudents_TP_2027_engg_C027")).toBe("engineering");
    expect(parseBatchStream("EnableStudents_TP_2028_eng_C029")).toBe("engineering");
  });

  it("recognizes medical token variants regardless of case", () => {
    expect(parseBatchStream("EnableStudents_12_25_Med_C08")).toBe("medical");
    expect(parseBatchStream("EnableStudents_TP_2028_med_C028")).toBe("medical");
    expect(parseBatchStream("EnableStudents_12_Photon_med_24_E001")).toBe("medical");
  });

  it("returns empty string when no stream token is present", () => {
    expect(parseBatchStream("EnableStudents_12_25_Clat")).toBe("");
    expect(parseBatchStream("EnableStudents_12_25_R08")).toBe("");
    expect(parseBatchStream("EnableStudents-TP-2027-common-Z001")).toBe("");
  });
});
