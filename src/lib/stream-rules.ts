// Shared, pure stream rules for the Enrollment Stream filter, StudentTable,
// and the students export. Client- and server-safe: keep server-only imports
// (`@/lib/db`, `@/lib/permissions`) out of this module.

/** Stream filter sentinel selecting students with no stream. */
export const NO_STREAM = "__none__";

/** Trim + lower-case. Empty or whitespace-only becomes "" (no stream). */
function normalizeStreamKey(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function matchesStreamFilter(
  studentStream: string | null | undefined,
  selected: string,
): boolean {
  if (selected === "all") return true;
  const key = normalizeStreamKey(studentStream);
  if (selected === NO_STREAM) return key === "";
  return key === normalizeStreamKey(selected);
}

export interface StreamFilterOption {
  /** Normalised stream key, used as the filter value. */
  value: string;
  /** First-seen trimmed raw stream. */
  label: string;
  count: number;
}

export function streamFilterOptions(
  students: { stream?: string | null }[],
): { options: StreamFilterOption[]; noStreamCount: number } {
  const byKey = new Map<string, StreamFilterOption>();
  let noStreamCount = 0;
  for (const student of students) {
    const key = normalizeStreamKey(student.stream);
    if (!key) {
      noStreamCount += 1;
      continue;
    }
    const option = byKey.get(key);
    if (option) option.count += 1;
    else byKey.set(key, { value: key, label: student.stream!.trim(), count: 1 });
  }
  const options = [...byKey.values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  return { options, noStreamCount };
}

export function formatExamPreparingFor(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? "";
  return ({ engineering: "Engineering", medical: "Medical", ca: "CA", clat: "CLAT", nda: "NDA" } as Record<string, string>)[normalized] ?? value ?? "";
}

export interface SearchableStudent {
  first_name?: string | null;
  last_name?: string | null;
  student_id?: string | null;
  pen_number?: string | null;
  apaar_id?: string | null;
  phone?: string | null;
}

/**
 * NVS roster search: trimmed, case-insensitive substring over "first last",
 * Student ID, PEN, APAAR ID, and phone. An empty query matches everyone.
 */
export function matchesStudentSearch(
  student: SearchableStudent,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    `${student.first_name ?? ""} ${student.last_name ?? ""}`,
    student.student_id,
    student.pen_number,
    student.apaar_id,
    student.phone,
  ].some((field) => field?.toLowerCase().includes(needle));
}
