// Shared uniform-size vocabulary for Student enrolment. Imported by the student-addition
// validation and the Add Student form, so the sizes the UI offers can never drift from the
// sizes the server accepts. No server-only imports here — safe for client bundles.

// Everything the DB Service `student` table stores: the `student_tshirt_size_check` and
// `student_track_pant_size_check` constraints accept exactly these codes, or NULL.
export const UNIFORM_SIZES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;

// The subset the Student Enrolment form offers, smallest first. The vendor's size chart
// starts at XS, so XXS stays storable but is never offered at enrolment.
export const ENROLMENT_UNIFORM_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;
export type EnrolmentUniformSize = (typeof ENROLMENT_UNIFORM_SIZES)[number];

// Measurements come from the vendor's chart; only the code is stored.
const TSHIRT_SIZE_LABELS: Record<EnrolmentUniformSize, string> = {
  XS: 'XS (Chest 34")',
  S: 'S (Chest 36")',
  M: 'M (Chest 38–40")',
  L: 'L (Chest 40–42")',
  XL: 'XL (Chest 42–44")',
  XXL: 'XXL (Chest 44–46")',
  XXXL: 'XXXL (Chest 46–48")',
};

const TRACK_PANT_SIZE_LABELS: Record<EnrolmentUniformSize, string> = {
  XS: 'XS (Waist 26")',
  S: 'S (Waist 28")',
  M: 'M (Waist 30–32")',
  L: 'L (Waist 32–34")',
  XL: 'XL (Waist 34–36")',
  XXL: 'XXL (Waist 36–38")',
  XXXL: 'XXXL (Waist 38–40")',
};

// Narrow an arbitrary value to a size the enrolment form offers.
export function isEnrolmentUniformSize(value: unknown): value is EnrolmentUniformSize {
  return typeof value === "string" &&
    (ENROLMENT_UNIFORM_SIZES as readonly string[]).includes(value);
}

// Display label for a T-shirt size code. Unknown codes (e.g. the storable-but-unoffered
// XXS on an existing row) render as-is rather than disappearing from the UI.
export function formatTshirtSize(size: string): string {
  return isEnrolmentUniformSize(size) ? TSHIRT_SIZE_LABELS[size] : size;
}

// Display label for a Track Pant size code; same unknown-code behaviour as above.
export function formatTrackPantSize(size: string): string {
  return isEnrolmentUniformSize(size) ? TRACK_PANT_SIZE_LABELS[size] : size;
}
