// The competitive exams the Exams tab offers, and the rules around them. No
// server-only imports here — the picker, the card and the server validation
// all read this list, so what a teacher can pick can never drift from what the
// API accepts.

// Exact `exam.name` values in the shared database, in the order the picker
// offers them: the exams almost every Student sits first, then the national
// ones, then the state CETs, then the rest. A name not in this list is never
// offered — the `exam` table also holds internal rows (Baseline, Selection,
// Hiring Test, TET, Board Exam, Miscellaneous) that are not applications a
// Student makes.
export const COMPETITIVE_EXAM_NAMES = [
  "JEE Mains",
  "NEET",
  "JEE Advanced",
  "CUET",
  "NDA",
  "CLAT",
  "CA",
  "IPMAT",
  "IISER Aptitude Test",
  "NEST",
  "NIFTEE",
  "NCHMJEE",
  "State CET",
  "MHT CET",
  "KCET",
  "WBJEE",
  "AP EAPCET",
  "TS EAMCET",
  "GUJCET",
  "KEAM",
  "BCECE",
  "JCECE",
  "CG PET",
  "TNEA",
  "Assam CEE",
  "OJEE",
  "UPCET",
  "TJEE",
  "GCET",
] as const;

export type CompetitiveExamName = (typeof COMPETITIVE_EXAM_NAMES)[number];

// Rank in the picker, so a list built from database rows (which come back in
// id order) can be sorted without respelling the order above.
const EXAM_NAME_ORDER = new Map<string, number>(
  COMPETITIVE_EXAM_NAMES.map((name, index) => [name, index]),
);

export function compareExamNames(a: string, b: string): number {
  const rankA = EXAM_NAME_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
  const rankB = EXAM_NAME_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
  return rankA === rankB ? a.localeCompare(b) : rankA - rankB;
}

// The exams a Student on this Board Stream is expected to apply for. They open
// on the Exams tab with their fields ready, but they are only suggestions —
// nothing is stored until a teacher fills one in, and any of them can be
// removed. Streams that lead to neither exam (Commerce, Arts/Humanities) are
// absent rather than mapped to an empty list, so a missing key and "no
// required exams" are the same thing.
const REQUIRED_EXAMS_BY_BOARD_STREAM: Record<string, readonly CompetitiveExamName[]> = {
  PCM: ["JEE Mains"],
  PCB: ["NEET"],
  PCMB: ["JEE Mains", "NEET"],
};

export function requiredExamNamesForBoardStream(
  boardStream: string | null | undefined,
): readonly CompetitiveExamName[] {
  const key = typeof boardStream === "string" ? boardStream.trim().toUpperCase() : "";
  return REQUIRED_EXAMS_BY_BOARD_STREAM[key] ?? [];
}

// Exams that run the same paper more than once a year, with the sittings a
// Student can apply for. Only these exams show the "Sessions applied"
// checkboxes, and only these session numbers are accepted.
const EXAM_SESSIONS: Record<string, readonly number[]> = {
  "JEE Mains": [1, 2],
};

export function examSessionsFor(examName: string): readonly number[] {
  return EXAM_SESSIONS[examName] ?? [];
}

/** An exam a teacher can pick, as the `exam` table stores it. */
export interface ExamOption {
  id: number;
  name: string;
}

/**
 * One exam registration as the Exams tab edits it. `application_password` is
 * only ever present on this shape — the roster card gets {@link StudentExamSummary},
 * which says whether a password is stored without carrying it.
 */
export interface StudentExamRecord {
  /** `student_exam_record.id`; absent until the row has been saved once. */
  id: number;
  exam_id: number;
  exam_name: string;
  application_number: string | null;
  application_password: string | null;
  sessions_applied: number[] | null;
}

/** What the roster card shows: no password, only whether one is stored. */
export interface StudentExamSummary {
  id: number;
  exam_id: number;
  exam_name: string;
  application_number: string | null;
  has_password: boolean;
  sessions_applied: number[] | null;
}

export const APPLICATION_NUMBER_MAX_LENGTH = 255;
export const APPLICATION_PASSWORD_MAX_LENGTH = 255;

/** The mask the card shows in place of a stored password. */
export const MASKED_PASSWORD = "••••••••";

/**
 * Label for a set of sittings, e.g. [1, 2] → "Session 1, Session 2". Empty or
 * absent sittings give "", so a caller can fall back to a dash.
 */
export function formatSessionsApplied(sessions: number[] | null | undefined): string {
  if (!sessions?.length) return "";
  return [...sessions]
    .sort((a, b) => a - b)
    .map((session) => `Session ${session}`)
    .join(", ");
}
