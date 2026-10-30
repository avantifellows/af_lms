// The Student support view's metric rules, from Vishal's Teacher View v2 spec
// (af_lms #324). Pure and client-safe so every rule is unit-tested on its own.
import type {
  AlStatus,
  ChapterFlag,
  LatestLevel,
  ScoreDirection,
  ScoreTrend,
  TestChange,
  ToNextLevel,
} from "@/types/student-support";

/** JEE (engineering) or NEET (medical) from a stream label, else null. The
 *  warehouse spells streams many ways (PCM, Engg, engineering, PCB, Med …). */
export function examStream(stream: string | null | undefined): "engineering" | "medical" | null {
  const s = (stream || "").trim().toLowerCase();
  if (["engineering", "engg", "pcm"].includes(s)) return "engineering";
  if (["medical", "med", "pcb"].includes(s)) return "medical";
  return null;
}

/** The exam stream a student is read under: their own, else engineering, as
 *  dbt defaults a NULL stream. So a student with no usable stream still gets
 *  JEE tests and chapters. */
export function studentExamStream(stream: string | null | undefined): "engineering" | "medical" {
  return examStream(stream) ?? "engineering";
}

/** Whether a test counts for a student of this exam stream: a test with no
 *  stream counts for everyone, any other only for its own stream. */
export function testInStream(testStream: string | null | undefined, stream: "engineering" | "medical"): boolean {
  return !testStream || testStream.trim().toLowerCase() === stream;
}

/** Oldest first; tests on the same day in session id order, so the order
 *  is the same on every read. */
export function byDateThenSession(
  a: { date: string; sessionId: string },
  b: { date: string; sessionId: string }
): number {
  return a.date.localeCompare(b.date) || a.sessionId.localeCompare(b.sessionId);
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

/**
 * Session ids of retests. The warehouse names a retest exactly like the
 * original, so a session is a retest when an earlier one (by date, then
 * session id) has the same test name.
 */
export function retestIds(tests: { sessionId: string; name: string; date: string }[]): Set<string> {
  const seen = new Set<string>();
  const retests = new Set<string>();
  for (const t of [...tests].sort(byDateThenSession)) {
    const name = t.name.trim();
    if (seen.has(name)) retests.add(t.sessionId);
    else seen.add(name);
  }
  return retests;
}

/** One test a student sat, oldest first; `level` as the mode reads it. */
export interface JourneySitting {
  sessionId: string;
  test: string;
  level: string | null;
  marks: number | null;
  max: number | null;
  retest: boolean;
}

/**
 * The level on the newest sitting that is not a retest and has a level. (The
 * prototype also skips one-paper "partial" sittings; the warehouse has no
 * such flag, so only retests and unlevelled sittings are skipped.)
 */
export function latestLevel(sittings: JourneySitting[]): LatestLevel | null {
  for (let i = sittings.length - 1; i >= 0; i--) {
    const s = sittings[i];
    if (s.retest || !s.level) continue;
    return { level: s.level, marks: s.marks, test: s.test };
  }
  return null;
}

/**
 * Extra correct answers (+4 marks each) the Latest AL's marks need to reach
 * the cutoff of the level above it; 0 when they already clear it.
 */
export function questionsToNext(
  latest: LatestLevel | null,
  cutoffFor: (level: string) => number | null
): ToNextLevel {
  if (!latest) return { kind: "none" };
  if (latest.level === "M1" || latest.level === "B1") return { kind: "top" };
  const next = NEXT_LEVEL[latest.level];
  const cutoff = next ? cutoffFor(next) : null;
  if (!next || cutoff === null || latest.marks === null) return { kind: "none" };
  const gap = Math.ceil(cutoff - latest.marks);
  return {
    kind: "count",
    questions: gap <= 0 ? 0 : Math.ceil(gap / 4),
    gap,
    cutoff,
    nextLevel: next,
    test: latest.test,
    marks: latest.marks,
  };
}

/** The score graph's direction is read over this many latest tests. */
const TREND_TESTS = 5;

/** Least-squares slope of the values against 0, 1, 2 … (two or more values). */
export function slope(values: number[]): number {
  const n = values.length;
  const xm = (n - 1) / 2;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((y, x) => {
    num += (x - xm) * (y - ym);
    den += (x - xm) ** 2;
  });
  return num / den;
}

/** Above +0.25 points per test → Improving, below −0.25 → Declining, else Same. */
export function scoreDirection(s: number): ScoreDirection {
  if (s > 0.25) return "Improving";
  if (s < -0.25) return "Declining";
  return "Same";
}

/**
 * Score % on every non-retest test the student sat with marks, oldest first,
 * coloured by the direction over the last TREND_TESTS. Null with fewer than two.
 */
export function scoreTrend(sittings: JourneySitting[]): ScoreTrend | null {
  const points: number[] = [];
  for (const s of sittings) {
    if (!s.retest && s.marks !== null && s.max) points.push((s.marks / s.max) * 100);
  }
  if (points.length < 2) return null;
  const recent = points.slice(-TREND_TESTS);
  const m = slope(recent);
  return {
    points: points.map((p) => Math.round(p * 10) / 10),
    direction: scoreDirection(m),
    slope: Math.round(m * 100) / 100,
    recent: recent.length,
  };
}

/** Marks change on the latest non-retest sitting vs the previous one. */
export function latestChange(sittings: JourneySitting[]): TestChange | null {
  const marked = sittings.filter((s) => !s.retest && s.marks !== null);
  if (marked.length < 2) return null;
  const [prev, last] = marked.slice(-2);
  return { sessionId: last.sessionId, change: last.marks! - prev.marks!, previous: prev.test };
}

/** ▲ above +0.5, ▼ below −0.5, else flat. */
export function changeDirection(change: number): "up" | "down" | "flat" {
  if (change > 0.5) return "up";
  if (change < -0.5) return "down";
  return "flat";
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

/**
 * A topic is flagged only inside a flagged chapter, when its own score is
 * below the pass mark; C or S by the chapter rule, with no minimum count.
 */
export function topicFlag(
  t: { attempt: number | null; accuracy: number | null; score: number | null },
  chapter: ChapterFlag | null,
  pass: number
): ChapterFlag | null {
  if (!chapter || t.score === null || t.score >= pass) return null;
  return chapterFlag({ ...t, n: Infinity }, pass);
}

/** The exam's display name from the warehouse's test_course. */
export function examName(course: string | null): string | null {
  if (!course) return null;
  if (course === "JEE Mains") return "JEE Main";
  return course;
}
