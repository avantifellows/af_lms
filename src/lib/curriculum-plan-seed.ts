// One-time seed of the 2026-27 Curriculum Plans (issue #417, slice #425) from the
// "JNV Academic and Testing Calendar AY 2026-27" workbook. Pure workbook → plan-draft logic:
// the operator script (`scripts/seed-curriculum-plans.ts`) supplies each Grade's effective
// Chapter list and writes the drafts through the Curriculum Plans module.

import type ExcelJS from "exceljs";

import { CONTENT_EXAM_TRACKS } from "./curriculum-plan-rules";
import type { ExamTrack } from "./exam-tracks";

const SEED_ACADEMIC_YEAR = "2026-2027";

const SEED_TABS = [
  { tab: "G12", title: "G12 2026-27", grade: 12 },
  { tab: "G11 (Others)", title: "G11 2026-27 (Others)", grade: 11 },
  { tab: "G11 (HYD)", title: "G11 2026-27 (HYD)", grade: 11 },
] as const;

export interface SeedChapter {
  chapterId: number;
  chapterCode: string;
  chapterName: string;
  subjectName: string;
}

export interface PlanDraftChapter {
  chapterId: number;
  dueDate: string;
  testDate: string | null;
}

export interface PlanDraft {
  tab: string;
  title: string;
  academicYear: string;
  grade: number;
  examTracks: ExamTrack[];
  closureDate: string;
  chapters: PlanDraftChapter[];
}

interface DayEntry {
  date: string;
  subject: string;
  label: string;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return "";
  if ("richText" in value) return value.richText.map((part) => part.text).join("");
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("result" in value && value.result !== undefined) return cellText(value.result as ExcelJS.CellValue);
  return "";
}

// Excel dates load as UTC midnight; formula cells carry the date as their result.
function cellDate(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object" && "result" in value && value.result instanceof Date) {
    return value.result.toISOString().slice(0, 10);
  }
  return null;
}

function cleanLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

const ROMAN_NUMERALS: Record<string, string> = {
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10",
};

// Case, punctuation and whitespace fold away; Roman numerals become Arabic; "1 D" → "1d".
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((token) => ROMAN_NUMERALS[token] ?? token)
    .join(" ")
    .replace(/\b(\d+) ([a-z])\b/g, "$1$2");
}

// Sheet spellings (normalised) → LMS Chapter names (normalised), from the 2026-27 workbook.
// Matching still happens within the Grade + subject, so an alias only resolves when the
// target Chapter is in that subject's effective list.
const CHAPTER_ALIASES: Record<string, string> = {
  emi: "electromagnetic induction",
  ac: "alternating current",
  emw: "electromagnetic waves",
  "nuclear physcs": "nuclear physics",
  semiconductors: "semiconductor",
  "motion in 1d": "motion in one dimension",
  "motion in 2d": "motion in two dimension",
  "center of mass": "centre of mass",
  "work power energy": "work power and energy",
  "cell unit of life": "cell the unit of life",
  "complex numbers": "complex number",
  "redox reaction": "redox reactions",
  "human health and disease": "human health and diseases",
  "biotechnology principle and processes": "biotechnology principles and processes",
  "biodiversity and conservation": "biodiversity and its conservation",
  "aldehydes ketones carboxylic acids": "aldehydes ketones and carboxylic acids",
  "application of derivative": "application of derivatives",
  "indefinite integeration": "indefinite integration",
};

interface ReadTab {
  dates: string[];
  entries: DayEntry[];
}

// Holidays, AIAT, Unit Test, Mid Term and Bootcamp days are written once and merged across
// every subject column (sometimes down several days), so they are no subject's teaching day.
function isWholeDayRow(row: ExcelJS.Row, columns: number[]): boolean {
  const masters = columns.map((column) => row.getCell(column).master.address);
  return masters.length > 1 && new Set(masters).size === 1;
}

// Non-teaching entries written in a single subject column.
const NON_TEACHING_PATTERN =
  /\b(practice|revision|buffer|weekly off|holidays?|aiat|unit test|mid term|bootcamp|baseline|pre board)\b/;

function readTab(sheet: ExcelJS.Worksheet): ReadTab {
  let headerRow: ExcelJS.Row | null = null;
  sheet.eachRow((row) => {
    if (headerRow) return;
    const texts = (row.values as ExcelJS.CellValue[]).map((value) => cleanLabel(cellText(value)));
    if (texts.includes("Date")) headerRow = row;
  });
  if (!headerRow) throw new Error(`Tab "${sheet.name}" has no Date header row`);
  const header = headerRow as ExcelJS.Row;

  let dateColumn = 0;
  const subjectColumns: Array<{ column: number; subject: string }> = [];
  header.eachCell((cell, column) => {
    const text = cleanLabel(cellText(cell.value));
    if (text === "Date") dateColumn = column;
    else if (column > 1 && text && !["Week", "Day"].includes(text)) {
      subjectColumns.push({ column, subject: text });
    }
  });

  const dates: string[] = [];
  const entries: DayEntry[] = [];
  for (let rowNumber = header.number + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const date = cellDate(row.getCell(dateColumn).value);
    if (!date) continue;
    dates.push(date);
    if (isWholeDayRow(row, subjectColumns.map(({ column }) => column))) continue;
    for (const { column, subject } of subjectColumns) {
      const label = cleanLabel(cellText(row.getCell(column).value));
      if (label) entries.push({ date, subject, label });
    }
  }
  return { dates, entries };
}

type EntryKind = "teaching" | "test";

// Teaching days read `Chapter - N`; test days read `Chapter Test - X` / `Chapter Test: X` or
// `X Test` / `X - Test`. `sheetName` is the label as shown in the report.
function classifyEntry(label: string): { kind: EntryKind; sheetName: string; name: string } {
  const normalized = normalizeName(label);
  if (/\btest\b/.test(normalized)) {
    const name = normalized
      .replace(/^chapter test\b/, "")
      .replace(/\b(chapter )?test$/, "")
      .trim();
    return { kind: "test", sheetName: label, name };
  }
  const sheetName = label.replace(/\s*-\s*\d+\s*$/, "");
  return { kind: "teaching", sheetName, name: normalizeName(sheetName) };
}

const SUBJECT_ALIASES: Record<string, string> = { mathematics: "maths" };

function subjectKey(subject: string): string {
  const normalized = normalizeName(subject);
  return SUBJECT_ALIASES[normalized] ?? normalized;
}

type Resolution =
  | { ok: true; chapter: SeedChapter }
  | { ok: false; reason: "no_match" | "ambiguous"; candidates: SeedChapter[] };

// Exact match on the normalised (or aliased) name within the Grade + subject. Never guesses:
// zero or several candidates leave the Sheet name unresolved.
function resolveChapter(subject: string, name: string, chapters: SeedChapter[]): Resolution {
  const target = CHAPTER_ALIASES[name] ?? name;
  const candidates = chapters.filter(
    (chapter) =>
      subjectKey(chapter.subjectName) === subjectKey(subject) &&
      normalizeName(chapter.chapterName) === target
  );
  if (candidates.length === 1) return { ok: true, chapter: candidates[0] };
  return { ok: false, reason: candidates.length === 0 ? "no_match" : "ambiguous", candidates };
}

export interface UnmatchedSheetRow {
  subject: string;
  sheetName: string;
  kind: EntryKind;
  dates: string[];
  // A test day whose Chapter has no teaching day in the tab stays undated: a Chapter Test
  // Date needs a Chapter Due Date.
  reason: "no_match" | "ambiguous" | "test_without_teaching";
  candidates: string[];
}

export interface MatchedChapter {
  subject: string;
  chapter: string;
  sheetNames: string[];
  dueDate: string;
  testDate: string | null;
}

export interface UncoveredChapter {
  subject: string;
  chapter: string;
}

// A Chapter taught in separate runs (another Chapter taught in between) or with several test
// days. The plan takes the last teaching day and the last test day.
export interface DuplicateChapter {
  subject: string;
  chapter: string;
  kind: EntryKind;
  dates: string[];
}

export interface SeedTabReport {
  tab: string;
  title: string;
  grade: number;
  closureDate: string;
  matched: MatchedChapter[];
  unmatchedRows: UnmatchedSheetRow[];
  uncoveredChapters: UncoveredChapter[];
  duplicates: DuplicateChapter[];
}

function chapterLabel(chapter: SeedChapter): string {
  return `${chapter.chapterCode} ${chapter.chapterName}`;
}

interface ChapterDays {
  sheetNames: string[];
  runs: Array<{ from: string; to: string }>;
  tests: string[];
}

function addDistinct(values: string[], value: string): void {
  if (!values.includes(value)) values.push(value);
}

export function buildCurriculumPlanSeed(
  workbook: ExcelJS.Workbook,
  chaptersByGrade: Record<number, SeedChapter[]>
): { drafts: PlanDraft[]; report: SeedTabReport[] } {
  const drafts: PlanDraft[] = [];
  const report: SeedTabReport[] = [];
  for (const { tab, title, grade } of SEED_TABS) {
    const sheet = workbook.getWorksheet(tab);
    if (!sheet) throw new Error(`Workbook has no "${tab}" tab`);
    const { dates, entries } = readTab(sheet);
    const chapters = chaptersByGrade[grade] ?? [];
    const closureDate = dates.reduce((last, date) => (date > last ? date : last), "");

    const days = new Map<number, ChapterDays>();
    const lastTaught = new Map<string, string>();
    const unmatched = new Map<string, UnmatchedSheetRow>();
    for (const entry of entries) {
      if (NON_TEACHING_PATTERN.test(normalizeName(entry.label))) continue;
      const { kind, sheetName, name } = classifyEntry(entry.label);
      const resolution = resolveChapter(entry.subject, name, chapters);
      if (!resolution.ok) {
        if (kind === "teaching") lastTaught.set(entry.subject, `name:${name}`);
        const key = `${kind}|${entry.subject}|${name}`;
        const row = unmatched.get(key) ?? {
          subject: entry.subject,
          sheetName,
          kind,
          dates: [],
          reason: resolution.reason,
          candidates: resolution.candidates.map(chapterLabel),
        };
        row.dates.push(entry.date);
        unmatched.set(key, row);
        continue;
      }

      const { chapterId } = resolution.chapter;
      const chapterDays = days.get(chapterId) ?? { sheetNames: [], runs: [], tests: [] };
      days.set(chapterId, chapterDays);
      addDistinct(chapterDays.sheetNames, sheetName);
      if (kind === "test") {
        addDistinct(chapterDays.tests, entry.date);
        continue;
      }
      const runKey = `id:${chapterId}`;
      const currentRun = chapterDays.runs[chapterDays.runs.length - 1];
      if (currentRun && lastTaught.get(entry.subject) === runKey) currentRun.to = entry.date;
      else chapterDays.runs.push({ from: entry.date, to: entry.date });
      lastTaught.set(entry.subject, runKey);
    }

    const matched: MatchedChapter[] = [];
    const uncoveredChapters: UncoveredChapter[] = [];
    const duplicates: DuplicateChapter[] = [];
    const draftChapters: PlanDraftChapter[] = [];
    for (const chapter of chapters) {
      const chapterDays = days.get(chapter.chapterId);
      const subject = chapter.subjectName;
      const label = chapterLabel(chapter);
      if (!chapterDays || chapterDays.runs.length === 0) {
        uncoveredChapters.push({ subject, chapter: label });
        if (chapterDays) {
          unmatched.set(`untaught|${chapter.chapterId}`, {
            subject,
            sheetName: chapterDays.sheetNames[0],
            kind: "test",
            dates: chapterDays.tests,
            reason: "test_without_teaching",
            candidates: [label],
          });
        }
        continue;
      }
      const dueDate = chapterDays.runs.reduce((last, run) => (run.to > last ? run.to : last), "");
      const testDate = chapterDays.tests.length > 0
        ? chapterDays.tests.reduce((last, date) => (date > last ? date : last))
        : null;
      matched.push({ subject, chapter: label, sheetNames: chapterDays.sheetNames, dueDate, testDate });
      draftChapters.push({ chapterId: chapter.chapterId, dueDate, testDate });
      if (chapterDays.runs.length > 1) {
        duplicates.push({
          subject,
          chapter: label,
          kind: "teaching",
          dates: chapterDays.runs.map((run) => `${run.from} to ${run.to}`),
        });
      }
      if (chapterDays.tests.length > 1) {
        duplicates.push({ subject, chapter: label, kind: "test", dates: chapterDays.tests });
      }
    }

    drafts.push({
      tab,
      title,
      academicYear: SEED_ACADEMIC_YEAR,
      grade,
      examTracks: [...CONTENT_EXAM_TRACKS],
      closureDate,
      chapters: draftChapters,
    });
    report.push({
      tab,
      title,
      grade,
      closureDate,
      matched,
      unmatchedRows: [...unmatched.values()],
      uncoveredChapters,
      duplicates,
    });
  }
  return { drafts, report };
}

export type CurriculumPlanSeedMode = "dry-run" | "apply";

// The Curriculum Plans tables, behind the module's create + Chapter date paths.
export interface CurriculumPlanSeedStore {
  loadChapters(grade: number): Promise<SeedChapter[]>;
  existingPlanTitles(academicYear: string, grade: number): Promise<string[]>;
  // Creates every draft, in order, in one transaction: all of them or none. Returns their ids
  // in the same order; throws when any draft is rejected.
  createDraftPlans(drafts: PlanDraft[]): Promise<Array<{ id: number }>>;
}

export interface CurriculumPlanSeedResult {
  ok: boolean;
  mode: CurriculumPlanSeedMode;
  error?: string;
  report: SeedTabReport[];
  reportText: string;
  created: Array<{ title: string; id: number }>;
}

function section<T>(lines: string[], heading: string, items: T[], format: (item: T) => string): void {
  lines.push(`${heading} (${items.length})`);
  for (const item of items) lines.push(`- ${format(item)}`);
}

function formatCurriculumPlanSeedReport(report: SeedTabReport[]): string {
  const lines: string[] = [];
  for (const tab of report) {
    lines.push(`== ${tab.tab} → "${tab.title}" (Grade ${tab.grade}, closes ${tab.closureDate}) ==`);
    section(lines, "Matched Chapters", tab.matched, (item) =>
      `${item.subject}: ${item.chapter} — due ${item.dueDate}, test ${item.testDate ?? "none"} [${item.sheetNames.join(" | ")}]`
    );
    section(lines, "Unmatched Sheet rows", tab.unmatchedRows, (item) => {
      const reason = item.reason.replace(/_/g, " ");
      const candidates = item.candidates.length > 0 ? ` (${item.candidates.join("; ")})` : "";
      return `${item.subject}: "${item.sheetName}" (${item.kind}; ${item.dates.join(", ")}) — ${reason}${candidates}`;
    });
    section(lines, "Uncovered LMS Chapters", tab.uncoveredChapters, (item) => `${item.subject}: ${item.chapter}`);
    section(lines, "Duplicates", tab.duplicates, (item) =>
      `${item.subject}: ${item.chapter} — ${item.kind}: ${item.dates.join(", ")}`
    );
    lines.push("");
  }
  return lines.join("\n");
}

export async function runCurriculumPlanSeed(params: {
  workbook: ExcelJS.Workbook;
  mode: CurriculumPlanSeedMode;
  store: CurriculumPlanSeedStore;
}): Promise<CurriculumPlanSeedResult> {
  const grades = [...new Set(SEED_TABS.map(({ grade }) => grade))];
  const chaptersByGrade: Record<number, SeedChapter[]> = {};
  for (const grade of grades) chaptersByGrade[grade] = await params.store.loadChapters(grade);

  const { drafts, report } = buildCurriculumPlanSeed(params.workbook, chaptersByGrade);
  const result: CurriculumPlanSeedResult = {
    ok: true,
    mode: params.mode,
    report,
    reportText: formatCurriculumPlanSeedReport(report),
    created: [],
  };
  if (params.mode === "dry-run") return result;

  // Checked for all three plans before writing any, so a re-run never half-applies.
  const existing: string[] = [];
  for (const draft of drafts) {
    const titles = await params.store.existingPlanTitles(draft.academicYear, draft.grade);
    if (titles.includes(draft.title)) existing.push(`${draft.title} (Grade ${draft.grade})`);
  }
  if (existing.length > 0) {
    return {
      ...result,
      ok: false,
      error: `Refusing to apply: plans already exist for ${SEED_ACADEMIC_YEAR}: ${existing.join(", ")}`,
    };
  }

  const created = await params.store.createDraftPlans(drafts);
  result.created = drafts.map((draft, index) => ({ title: draft.title, id: created[index].id }));
  return result;
}
