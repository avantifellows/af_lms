// The Student support view's metric rules, from Vishal's Teacher View v2 spec
// (af_lms #324). Pure and client-safe so every rule is unit-tested on its own.
import type { AlStatus, ChapterFlag, ToNextLevel } from "@/types/student-support";

/** JEE (engineering) or NEET (medical) from a stream label, else null. The
 *  warehouse spells streams many ways (PCM, Engg, engineering, PCB, Med …). */
export function examStream(stream: string | null | undefined): "engineering" | "medical" | null {
  const s = (stream || "").trim().toLowerCase();
  if (["engineering", "engg", "pcm"].includes(s)) return "engineering";
  if (["medical", "med", "pcb"].includes(s)) return "medical";
  return null;
}

const LEVEL_RANK: Record<string, number> = { M1: 3, B1: 3, M2: 2, B2: 2, M3: 1, B3: 1 };

/** A per-test AL as the mode reads it: "Not Qualified" counts as M3 / B3,
 *  exactly as dbt's int_student_academic_level does. */
export function levelForTest(al: string, stream: "engineering" | "medical" | null): string | null {
  if (al in LEVEL_RANK) return al;
  if (al === "Not Qualified") return stream === "medical" ? "B3" : "M3";
  return null;
}

/** Mode better than predicted → Improving, worse → Sliding, equal → Same.
 *  Null when either is missing (predictions exist for JEE Main only). */
export function alStatus(predicted: string | null, mode: string | null): AlStatus | null {
  const p = predicted ? LEVEL_RANK[predicted] : undefined;
  const m = mode ? LEVEL_RANK[mode] : undefined;
  if (p === undefined || m === undefined) return null;
  if (m > p) return "Improving";
  if (m < p) return "Sliding";
  return "Same";
}

const NEXT_LEVEL: Record<string, string> = { M3: "M2", M2: "M1", B3: "B2", B2: "B1" };

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Extra correct answers (+4 marks each) the median of the latest ≤3 levelled
 * tests needs to reach the cutoff of the level above the student's mode.
 */
export function questionsToNext(
  mode: string | null,
  recent: { marks: number; test: string }[],
  cutoffFor: (level: string) => number | null
): ToNextLevel {
  if (mode === "M1" || mode === "B1") return { kind: "top" };
  const next = mode ? NEXT_LEVEL[mode] : undefined;
  const med = median(recent.map((r) => r.marks));
  const cutoff = next ? cutoffFor(next) : null;
  if (!next || med === null || cutoff === null) return { kind: "none" };
  const questions = Math.ceil((cutoff - med) / 4);
  if (questions <= 0) return { kind: "reached" };
  return { kind: "count", questions, median: med, cutoff, nextLevel: next, tests: recent.map((r) => r.test) };
}

/** Score % a chapter must reach: JEE Main 35, JEE Advanced 30, NEET 50
 *  (Biology 75). */
export function passMark(exam: string, subject: string): number {
  if (exam === "JEE Advanced") return 30;
  if (exam === "NEET") return ["biology", "botany", "zoology"].includes(subject.toLowerCase()) ? 75 : 50;
  return 35;
}

/**
 * C (concept gap) or S (skipping), only for a chapter with at least 4 answers
 * scoring below the pass mark: nothing attempted → S; accuracy under 60 → C;
 * attempt under 70 → S; else C.
 */
export function chapterFlag(
  c: { n: number; attempt: number | null; accuracy: number | null; score: number | null },
  pass: number
): ChapterFlag | null {
  if (c.n < 4 || c.score === null || c.score >= pass) return null;
  if (!c.attempt) return "S";
  if (c.accuracy !== null && c.accuracy < 60) return "C";
  if (c.attempt < 70) return "S";
  return "C";
}

/** The exam's display name from the warehouse's test_course. */
export function examName(course: string | null): string | null {
  if (!course) return null;
  if (course === "JEE Mains") return "JEE Main";
  return course;
}
