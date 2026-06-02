// Allowlist of document types accepted by the LMS document uploads feature.
// Must stay in sync with db-service's `LmsStudentDocument.@document_types`
// (manual sync — divergence is rare and crossing the Elixir/TS boundary with a
// shared source-of-truth is more work than it's worth).

export const DOCUMENT_TYPES = [
  { value: "student_undertaking", label: "Signed undertaking - Student" },
  { value: "parent_undertaking", label: "Signed undertaking - Parent" },
  { value: "income_certificate", label: "Income Certificate" },
  { value: "caste_certificate", label: "Caste Certificate" },
  { value: "media_consent_form", label: "Media Consent Form" },
  { value: "wise_research_consent", label: "WISE Research Consent" },
  { value: "student_photograph", label: "Student Photograph" },
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number]["value"];

const VALUE_SET: ReadonlySet<string> = new Set(DOCUMENT_TYPES.map((t) => t.value));

export function isValidDocumentType(s: string): s is DocumentType {
  return VALUE_SET.has(s);
}

export function labelFor(type: DocumentType): string {
  return DOCUMENT_TYPES.find((t) => t.value === type)?.label ?? type;
}
