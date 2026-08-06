// Shared Exam Track vocabulary. Imported by the curriculum libs, the curriculum/config API
// routes and the client tables and filters, so the codes a UI offers can never drift from
// the codes the server accepts. No server-only imports here — safe for client bundles.

// Order is curriculum order: summary and options listings sort by this array's index, so
// changing the order changes how tracks are listed.
export const EXAM_TRACKS = ["jee_main", "jee_advanced", "neet"] as const;
export type ExamTrack = (typeof EXAM_TRACKS)[number];

const EXAM_TRACK_LABELS: Record<ExamTrack, string> = {
  jee_main: "JEE Main",
  jee_advanced: "JEE Advanced",
  neet: "NEET",
};

// Narrow an arbitrary value to a supported exam track code.
export function isExamTrack(value: unknown): value is ExamTrack {
  return typeof value === "string" && (EXAM_TRACKS as readonly string[]).includes(value);
}

// Display label for an exam track code. Unknown codes (e.g. a legacy value still stored on
// an old row) render as-is rather than disappearing from the UI.
export function formatExamTrack(track: string): string {
  return isExamTrack(track) ? EXAM_TRACK_LABELS[track] : track;
}
