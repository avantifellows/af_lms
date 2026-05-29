import { describe, it, expect } from "vitest";
import {
  DOCUMENT_TYPES,
  isValidDocumentType,
  labelFor,
} from "./document-types";

describe("DOCUMENT_TYPES", () => {
  it("has unique values", () => {
    const values = DOCUMENT_TYPES.map((t) => t.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("every entry has a non-empty label", () => {
    for (const t of DOCUMENT_TYPES) {
      expect(t.label).toBeTruthy();
    }
  });
});

describe("isValidDocumentType", () => {
  it("returns true for every entry in DOCUMENT_TYPES", () => {
    for (const t of DOCUMENT_TYPES) {
      expect(isValidDocumentType(t.value)).toBe(true);
    }
  });

  it("returns false for unknown values", () => {
    expect(isValidDocumentType("random")).toBe(false);
    expect(isValidDocumentType("")).toBe(false);
    expect(isValidDocumentType("STUDENT_UNDERTAKING")).toBe(false);
    expect(isValidDocumentType("research_consent")).toBe(false); // legacy / pre-rename
  });
});

describe("labelFor", () => {
  it("returns the configured label for each known type", () => {
    expect(labelFor("student_undertaking")).toBe("Signed undertaking - Student");
    expect(labelFor("income_certificate")).toBe("Income Certificate");
    expect(labelFor("caste_certificate")).toBe("Caste Certificate");
    expect(labelFor("wise_research_consent")).toBe("WISE Research Consent");
  });
});
