// Shared new-CMS test constants. Imported by both the server routes (list/create
// validation) and the client picker (dropdown), so the UI can never offer a test type the
// create/list routes would reject. No server-only imports here — safe for client bundles.

// Test subtypes the picker supports. chapter_test is chapter-scoped; major_test is
// full-syllabus. Both flow through the same CMS list route + quiz-backend ingest, so
// widening this list is a UI-only change.
export const CMS_TEST_TYPES = ["chapter_test", "major_test"] as const;
export type CmsTestType = (typeof CMS_TEST_TYPES)[number];

export const CMS_TEST_TYPE_OPTIONS: { value: CmsTestType; label: string }[] = [
  { value: "chapter_test", label: "Chapter Test" },
  { value: "major_test", label: "Major Test" },
];

// Discriminator stored on sessions created from the new CMS (meta_data.cms_source). Used to
// tell CMS-sourced sessions apart from legacy ones (e.g. to gate legacy-only row actions).
export const CMS_SOURCE = "nex-gen-cms";

// Narrow an arbitrary string to a supported CMS test type.
export function isCmsTestType(value: string | undefined): value is CmsTestType {
  return !!value && (CMS_TEST_TYPES as readonly string[]).includes(value);
}
