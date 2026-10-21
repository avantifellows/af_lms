// Cross-field checks: answers that don't fit together. Shared by the form
// (browser) and the save route (server).
//
// Each issue is either an "error" (impossible — the save is blocked) or a
// "warning" (unusual — the person is asked to confirm before saving). If none
// of an issue's fields were changed from what's already on record, it's only
// noted (onRecord) and never blocks or asks, so old records can still be saved.

import { describeTypical, durationRule } from "./durations";
import { isEmployed, type Values } from "./fields";

export interface Issue {
  /** Stable id, used to confirm warnings. */
  id: string;
  level: "error" | "warning";
  /** Field the message is shown under. */
  field: string;
  /** Every field the issue depends on. */
  fields: string[];
  message: string;
  /** Nothing in `fields` changed from the record — informational only. */
  onRecord?: boolean;
}

export interface CheckContext {
  /** This calendar year (graduating / starting in the future is impossible). */
  currentYear: number;
  /** The year they finished Class 12, if known. */
  g12Year?: number;
}

const ENGINEERING_DEGREES = ["BTech/BE", "BTech/MTech", "Diploma - Engg"];
const MEDICAL_DEGREES = ["MBBS", "BDS", "BAMS", "BHMS", "BNYS", "BVSc"];

const yearOf = (v: Values, col: string) => {
  const n = Number(v[col]);
  return v[col] && Number.isInteger(n) ? n : undefined;
};
const plural = (n: number) => `${n} year${n === 1 ? "" : "s"}`;

type Add = (level: Issue["level"], id: string, field: string, fields: string[], message: string) => void;
type Check = (v: Values, ctx: CheckContext, add: Add) => void;

/** One study level's columns and degree rule. */
function studyLevel(v: Values, level: "ug" | "pg") {
  const degree = v[`degree_${level}`];
  const startCol = `start_year_${level}`;
  const endCol = `year_of_graduation_${level}`;
  return {
    level,
    L: level.toUpperCase(),
    status: v[`${level}_status`],
    degree,
    startCol,
    endCol,
    start: yearOf(v, startCol),
    end: yearOf(v, endCol),
    rule: degree ? durationRule(level, degree) : undefined,
  };
}
type StudyLevel = ReturnType<typeof studyLevel>;

/** Can't start or graduate in the future. */
function checkFutureYears(s: StudyLevel, ctx: CheckContext, add: Add) {
  if (s.start && s.start > ctx.currentYear) {
    add("error", `${s.level}-start-future`, s.startCol, [s.startCol], `${s.L} can't have started in ${s.start} — that's in the future.`);
  }
  if (s.status === "Graduated" && s.end && s.end > ctx.currentYear) {
    add("error", `${s.level}-grad-future`, s.endCol, [s.endCol, `${s.level}_status`],
      `Marked Graduated, but ${s.end} is in the future. If they're still studying, set ${s.L} status to Studying.`);
  }
}

/** Course length (graduation year − start year) against the degree. */
function checkDuration(s: StudyLevel, add: Add) {
  const r = s.rule;
  if (!r || !s.start || !s.end || s.end < s.start) return;
  const years = s.end - s.start;
  const fields = [s.startCol, s.endCol, `degree_${s.level}`];
  if (years < r.min || years > r.max) {
    add("error", `${s.level}-duration`, s.endCol, fields,
      `${s.degree} takes ${describeTypical(r)} (${r.min}–${r.max} at most). ${s.start} → ${s.end} is ${plural(years)} — check both years.`);
  } else if (!r.typical.includes(years)) {
    add("warning", `${s.level}-duration`, s.endCol, fields,
      `${s.degree} usually takes ${describeTypical(r)}; this is ${plural(years)} (${s.start} → ${s.end}).${r.note ? ` ${r.note}` : ""}`);
  }
}

/** Still studying long after the course should have ended. */
function checkStudyingTooLong(s: StudyLevel, ctx: CheckContext, add: Add) {
  const r = s.rule;
  if (!r || s.status !== "Studying" || !s.start) return;
  const years = ctx.currentYear - s.start;
  const fields = [s.startCol, `degree_${s.level}`, `${s.level}_status`];
  if (years > r.max) {
    add("error", `${s.level}-studying-long`, s.startCol, fields,
      `Started ${s.degree} in ${s.start} (${plural(years)} ago) — longer than it can take (${r.max} years at most). Check the start year or ${s.L} status.`);
  } else if (years > Math.max(...r.typical)) {
    add("warning", `${s.level}-studying-long`, s.startCol, fields,
      `Started ${s.degree} in ${s.start} and still studying — ${plural(years)} on, longer than the usual ${describeTypical(r)}.`);
  }
}

const checkStudyLevels: Check = (v, ctx, add) => {
  for (const level of ["ug", "pg"] as const) {
    const s = studyLevel(v, level);
    checkFutureYears(s, ctx, add);
    checkDuration(s, add);
    checkStudyingTooLong(s, ctx, add);
  }
};

/** UG starts after Class 12; PG starts after UG ends. */
const checkOrder: Check = (v, ctx, add) => {
  const ugStart = yearOf(v, "start_year_ug");
  if (ugStart && ctx.g12Year && ugStart < ctx.g12Year) {
    add("warning", "ug-before-g12", "start_year_ug", ["start_year_ug"],
      `UG start (${ugStart}) is before they finished Class 12 (${ctx.g12Year}).`);
  }
  const ugEnd = yearOf(v, "year_of_graduation_ug");
  const pgStart = yearOf(v, "start_year_pg");
  if (ugEnd && pgStart && pgStart < ugEnd) {
    add("error", "pg-before-ug", "start_year_pg", ["start_year_pg", "year_of_graduation_ug"],
      `PG start (${pgStart}) is before UG graduation (${ugEnd}).`);
  }
};

/** Case-insensitive, so old records' spellings ("NO", "Gap year") are checked too. */
const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/** Gap year answers agree with each other. */
const checkGapYear: Check = (v, ctx, add) => {
  const gap = lower(v.did_you_take_a_gap_year);
  const ugStart = yearOf(v, "start_year_ug");
  const gapStatus = lower(v.ug_status) === "gap year" || lower(v.current_status) === "gap year";
  if (gap === "no" && gapStatus) {
    add("error", "gap-conflict", "did_you_take_a_gap_year", ["did_you_take_a_gap_year", "ug_status", "current_status"],
      `Says no gap year, but the status is Gap Year.`);
  }
  if (gap === "no" && ugStart && ctx.g12Year && ugStart > ctx.g12Year) {
    add("warning", "gap-implied", "did_you_take_a_gap_year", ["did_you_take_a_gap_year", "start_year_ug"],
      `Started UG in ${ugStart}, ${plural(ugStart - ctx.g12Year)} after Class 12 (${ctx.g12Year}) — that looks like a gap year.`);
  }
  if (gap === "yes" && !v.why_did_you_take_a_gap_year) {
    add("warning", "gap-reason", "why_did_you_take_a_gap_year", ["did_you_take_a_gap_year", "why_did_you_take_a_gap_year"],
      `Took a gap year, but no reason is filled in.`);
  }
};

/** Current status agrees with employment. */
const checkEmploymentStatus: Check = (v, _ctx, add) => {
  const current = v.current_status;
  const employment = v.employment_status ?? "";
  if (current === "Employed" && employment.startsWith("Not Employed")) {
    add("error", "employed-conflict", "employment_status", ["current_status", "employment_status"],
      `Current status is Employed, but employment says ${employment}.`);
  }
  if (employment === "Employed - Full-time" && ["Seeking Work", "Gap Year", "Preparing For PG/Govt Job"].includes(current)) {
    add("warning", "fulltime-vs-status", "current_status", ["current_status", "employment_status"],
      `Employed full-time, but current status is ${current}.`);
  }
  if (current === "Employed" && !employment) {
    add("warning", "employed-no-detail", "employment_status", ["current_status", "employment_status"],
      `Current status is Employed — also fill in Employment.`);
  }
};

/** Current status agrees with UG / PG. */
const checkStudyStatus: Check = (v, _ctx, add) => {
  const current = v.current_status;
  if (current === "Studying" && v.ug_status && v.ug_status !== "Studying" && v.pg_status !== "Studying") {
    add("warning", "studying-vs-ug", "current_status", ["current_status", "ug_status", "pg_status"],
      `Current status is Studying, but UG is ${v.ug_status}${v.pg_status ? ` and PG is ${v.pg_status}` : ""}.`);
  }
  if (v.ug_status === "Studying" && ["Gap Year", "Discontinued Studies"].includes(current)) {
    add("warning", "ug-studying-vs-status", "current_status", ["current_status", "ug_status"],
      `UG is Studying, but current status is ${current}.`);
  }
};

/** Entrance exam fits the degree. */
const checkExam: Check = (v, _ctx, add) => {
  const exam = v.which_competitive_exam_did_you_appear_for;
  const ugDegree = v.degree_ug;
  const fields = ["which_competitive_exam_did_you_appear_for", "degree_ug"];
  if (exam === "NEET" && ENGINEERING_DEGREES.includes(ugDegree)) {
    add("warning", "exam-vs-degree", fields[0], fields, `Admission through NEET, but the UG degree is ${ugDegree}.`);
  }
  if ((exam === "JEE" || exam === "JOSAA") && MEDICAL_DEGREES.includes(ugDegree)) {
    add("warning", "exam-vs-degree", fields[0], fields, `Admission through ${exam}, but the UG degree is ${ugDegree}.`);
  }
};

/** Salary looks like a yearly CTC in rupees and matches its range. */
const checkCtc: Check = (v, _ctx, add) => {
  const ctc = Number(v.current_ctc);
  if (!isEmployed(v) || !v.current_ctc || !Number.isFinite(ctc) || ctc <= 0) return;
  const shown = ctc.toLocaleString("en-IN");
  if (ctc < 1000) {
    add("warning", "ctc-lakhs", "current_ctc", ["current_ctc"],
      `₹${ctc} a year is very low — if you meant ${ctc} lakh, enter ${(ctc * 100000).toLocaleString("en-IN")}.`);
  } else if (ctc < 100000) {
    add("warning", "ctc-monthly", "current_ctc", ["current_ctc"],
      `₹${shown} looks like a monthly salary — this field is per year (×12 = ₹${(ctc * 12).toLocaleString("en-IN")}).`);
  } else if (ctc > 10000000) {
    add("warning", "ctc-high", "current_ctc", ["current_ctc"], `₹${shown} a year is over ₹1 crore — please double-check.`);
  } else if (v.current_ctc_range && !ctcRanges(ctc).includes(v.current_ctc_range)) {
    add("warning", "ctc-range", "current_ctc_range", ["current_ctc", "current_ctc_range"],
      `CTC ₹${shown} falls in "${ctcRanges(ctc)[0]}", not "${v.current_ctc_range}".`);
  }
};

/** Work start year and years of experience are possible. */
const checkExperience: Check = (v, ctx, add) => {
  if (!isEmployed(v)) return;
  const startedWork = yearOf(v, "which_year_did_you_start_working");
  const exp = Number(v.years_of_experience);
  if (startedWork && startedWork > ctx.currentYear) {
    add("error", "work-start-future", "which_year_did_you_start_working", ["which_year_did_you_start_working"],
      `Can't have started working in ${startedWork} — that's in the future.`);
  }
  if (!v.years_of_experience || !Number.isFinite(exp)) return;
  if (exp > 45) {
    add("error", "exp-high", "years_of_experience", ["years_of_experience"], `${exp} years of experience isn't possible for our alumni.`);
  } else if (startedWork && startedWork <= ctx.currentYear && exp > ctx.currentYear - startedWork + 1) {
    add("warning", "exp-vs-start", "years_of_experience", ["years_of_experience", "which_year_did_you_start_working"],
      `${plural(exp)} of experience, but they started working in ${startedWork} (at most ${plural(ctx.currentYear - startedWork + 1)}).`);
  }
};

const CHECKS: Check[] = [
  checkStudyLevels, checkOrder, checkGapYear, checkEmploymentStatus, checkStudyStatus, checkExam, checkCtc, checkExperience,
];

/** Old records: issues whose fields were all left as they were don't block or ask. */
function markOnRecord(issues: Issue[], v: Values, previous: Values) {
  for (const issue of issues) {
    const unchanged = issue.fields.every((f) => (v[f] ?? "") === (previous[f] ?? ""));
    const hadValue = issue.fields.some((f) => previous[f]);
    if (unchanged && hadValue) {
      issue.onRecord = true;
      issue.level = "warning";
    }
  }
}

export function findIssues(v: Values, previous: Values, ctx: CheckContext): Issue[] {
  const issues: Issue[] = [];
  const add: Add = (level, id, field, fields, message) => issues.push({ id, level, field, fields, message });
  for (const check of CHECKS) check(v, ctx, add);
  markOnRecord(issues, v, previous);
  return issues;
}

/** The ENUMS.current_ctc_range bucket(s) a yearly CTC fits — both, exactly on a boundary (e.g. 9 LPA). */
function ctcRanges(ctc: number): string[] {
  const lpa = ctc / 100000;
  const buckets: [number, number, string][] = [
    [0, 1, "< INR 1 LPA"], [1, 3, "INR 1 to 3 LPA"], [3, 6, "INR 3 to 6 LPA"],
    [6, 9, "INR 6 to 9 LPA"], [9, 12, "INR 9 to 12 LPA"], [12, Infinity, "> INR 12 LPA"],
  ];
  return buckets.filter(([lo, hi]) => lpa >= lo && lpa <= hi).map(([, , label]) => label);
}

/** Warnings that need a "yes, save anyway" (not ones only noted on an old record). */
export const needsConfirm = (issues: Issue[]) => issues.filter((i) => i.level === "warning" && !i.onRecord);
