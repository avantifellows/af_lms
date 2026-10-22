import type ExcelJS from "exceljs";

import { activeBlendedMappingSql } from "./blended-learning-access";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { query } from "./db";

// Operator-run load of Blended Learning Student Links (Profile Doc, Screener
// Link) from the Profile Dashboard workbook. Run by
// scripts/import-blended-learning-links.ts; dry run unless mode is "apply".

export type BlendedLinksImportMode = "dry-run" | "apply";

const PROFILE_DOCS_TAB = "Student Profile Docs";
const CONVERSATION_TAB = "Conversation";

type SourceTab = typeof PROFILE_DOCS_TAB | typeof CONVERSATION_TAB;

type BlendedLinksIssueReason =
  | "no_match"
  | "ambiguous_name"
  | "duplicate_row"
  | "no_link"
  | "not_https";

// Row numbers and Student IDs only: never names, phones or URLs.
interface BlendedLinksIssue {
  tab: SourceTab;
  row: number;
  studentId: string | null;
  reason: BlendedLinksIssueReason;
}

interface BlendedLinksCounts {
  matched: number;
  unmatched: number;
  skipped: number;
}

// In a dry run these are the writes an apply run would make.
interface BlendedLinksWrites {
  inserted: number;
  updated: number;
  unchanged: number;
}

export interface BlendedLinksImportReport {
  mode: BlendedLinksImportMode;
  // Tabs missing from the workbook or without a Student ID / Name header.
  unreadTabs: SourceTab[];
  counts: BlendedLinksCounts;
  writes: BlendedLinksWrites;
  issues: BlendedLinksIssue[];
}

interface MappedStudentRow {
  id: number | string;
  student_id: string | null;
  first_name: string | null;
  last_name: string | null;
}

interface MappedStudent {
  id: number;
  studentId: string | null;
}

interface StudentIndex {
  byStudentId: Map<string, MappedStudent>;
  byName: Map<string, MappedStudent[]>;
}

function normaliseName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function loadActiveMappedStudents(): Promise<StudentIndex> {
  const rows = await query<MappedStudentRow>(
    `SELECT DISTINCT st.id, st.student_id, account.first_name, account.last_name
     FROM blended_learning_mentor_mentee_mappings mapping
     JOIN student st ON st.id = mapping.student_id
     JOIN "user" account ON account.id = st.user_id
     WHERE ${activeBlendedMappingSql("mapping", "$1")}`,
    [CURRENT_ACADEMIC_YEAR]
  );

  const index: StudentIndex = { byStudentId: new Map(), byName: new Map() };
  for (const row of rows) {
    const student: MappedStudent = {
      id: Number(row.id),
      studentId: row.student_id?.trim() || null,
    };
    if (student.studentId) index.byStudentId.set(student.studentId, student);
    const name = normaliseName([row.first_name, row.last_name].filter(Boolean).join(" "));
    if (name) index.byName.set(name, [...(index.byName.get(name) ?? []), student]);
  }
  return index;
}

function headerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

interface MonthColumn {
  col: number;
  month: string;
}

interface TabColumns {
  headerRow: number;
  studentId: number | null;
  name: number | null;
  link: number | null;
  months: MonthColumn[];
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

// A monthly call-count header ("Sep", "Sep 2026", "Sep'26" or a date) as the
// first day of that month. A bare month takes its year from the academic
// year: April–December in the first year, January–March in the second.
function headerMonth(cell: ExcelJS.Cell): string | null {
  if (cell.value instanceof Date) {
    return monthStart(cell.value.getUTCFullYear(), cell.value.getUTCMonth() + 1);
  }
  const tokens = headerKey(cell.text ?? "").split(" ");
  const monthIndex = tokens.findIndex((token) => token in MONTHS);
  if (monthIndex < 0) return null;
  const month = MONTHS[tokens[monthIndex]];
  const yearToken = tokens.slice(monthIndex + 1).find((token) => /^(20)?\d{2}$/.test(token));
  const startYear = Number(CURRENT_ACADEMIC_YEAR.slice(0, 4));
  const year = yearToken
    ? Number(yearToken.length === 2 ? `20${yearToken}` : yearToken)
    : month >= 4 ? startYear : startYear + 1;
  return monthStart(year, month);
}

// The header row is the first of the top ten rows naming a Student ID or name column.
function findColumns(
  sheet: ExcelJS.Worksheet,
  isLinkHeader: (key: string) => boolean,
  readMonths: boolean
): TabColumns | null {
  for (let rowNumber = 1; rowNumber <= Math.min(10, sheet.rowCount); rowNumber++) {
    const columns: TabColumns = {
      headerRow: rowNumber, studentId: null, name: null, link: null, months: [],
    };
    sheet.getRow(rowNumber).eachCell((cell, col) => {
      const key = headerKey(cell.text ?? "");
      const month = readMonths ? headerMonth(cell) : null;
      if (key === "student id" && columns.studentId == null) columns.studentId = col;
      else if (/^(student )?(full )?name$/.test(key) && columns.name == null) columns.name = col;
      else if (isLinkHeader(key) && columns.link == null) columns.link = col;
      else if (month) columns.months.push({ col, month });
    });
    if (columns.studentId != null || columns.name != null) return columns;
  }
  return null;
}

// The cell's hyperlink, never its text: a hyperlinked cell or a HYPERLINK() formula.
function cellHyperlink(cell: ExcelJS.Cell): string | null {
  const value = cell.value;
  if (value && typeof value === "object") {
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink.trim() || null;
    }
    if ("formula" in value && typeof value.formula === "string") {
      const match = value.formula.match(/^\s*HYPERLINK\(\s*"([^"]*)"/i);
      if (match) return match[1].trim() || null;
    }
  }
  return null;
}

// The link column's hyperlink. Only a tab that allows it falls back to the
// row's first hyperlinked cell when it has no link column.
function rowHyperlink(row: ExcelJS.Row, column: number | null, rowFallback: boolean): string | null {
  if (column != null) return cellHyperlink(row.getCell(column));
  if (!rowFallback) return null;
  let found: string | null = null;
  row.eachCell((cell) => {
    if (found == null) found = cellHyperlink(cell);
  });
  return found;
}

// The latest month whose call count is above zero.
function lastCalledMonth(row: ExcelJS.Row, months: MonthColumn[]): string | null {
  let latest: string | null = null;
  for (const { col, month } of months) {
    const count = Number(row.getCell(col).text.trim());
    if (Number.isFinite(count) && count > 0 && (latest == null || month > latest)) latest = month;
  }
  return latest;
}

const HTTPS_URL = /^https:\/\/\S+$/;

interface TabResult {
  read: boolean;
  links: Map<number, string>;
  legacyMonths: Map<number, string>;
  counts: BlendedLinksCounts;
  issues: BlendedLinksIssue[];
}

type RowOutcome =
  | { status: "unmatched"; studentId: string | null; reason: BlendedLinksIssueReason }
  | { status: "skipped"; student: MappedStudent; called: string | null; reason: BlendedLinksIssueReason }
  | { status: "accepted"; student: MappedStudent; called: string | null; url: string };

// The Student a row names by Student ID, else by an exact normalised name
// that only one Student has; otherwise why it is unmatched.
function matchStudent(
  studentId: string | null,
  name: string,
  students: StudentIndex
): MappedStudent | BlendedLinksIssueReason {
  if (studentId) return students.byStudentId.get(studentId) ?? "no_match";
  const candidates = students.byName.get(name) ?? [];
  if (candidates.length === 1) return candidates[0];
  return candidates.length > 1 ? "ambiguous_name" : "no_match";
}

function cellText(row: ExcelJS.Row, column: number | null): string {
  return column != null ? (row.getCell(column).text ?? "") : "";
}

// One data row: null for a row with neither a Student ID nor a name.
function readLinkRow(
  row: ExcelJS.Row,
  columns: TabColumns,
  rowFallback: boolean,
  students: StudentIndex
): RowOutcome | null {
  const studentId = cellText(row, columns.studentId).trim() || null;
  const name = normaliseName(cellText(row, columns.name));
  if (!studentId && !name) return null;

  const student = matchStudent(studentId, name, students);
  if (typeof student === "string") return { status: "unmatched", studentId, reason: student };

  const called = lastCalledMonth(row, columns.months);
  const url = rowHyperlink(row, columns.link, rowFallback);
  if (!url) return { status: "skipped", student, called, reason: "no_link" };
  if (!HTTPS_URL.test(url)) return { status: "skipped", student, called, reason: "not_https" };
  return { status: "accepted", student, called, url };
}

type AcceptedRow = { row: number; studentId: string | null; url: string };

// Reads one tab's rows into `result`. Rows that resolve to a Student with a
// usable link wait in `accepted` until every row is read.
class TabReader {
  readonly accepted = new Map<number, AcceptedRow[]>();

  constructor(
    private readonly result: TabResult,
    private readonly tab: SourceTab
  ) {}

  issue(row: number, studentId: string | null, reason: BlendedLinksIssueReason): void {
    this.result.issues.push({ tab: this.tab, row, studentId, reason });
  }

  record(rowNumber: number, outcome: RowOutcome): void {
    if (outcome.status === "unmatched") {
      this.result.counts.unmatched++;
      this.issue(rowNumber, outcome.studentId, outcome.reason);
      return;
    }
    const { student, called } = outcome;
    const seen = this.result.legacyMonths.get(student.id);
    if (called && (seen == null || called > seen)) this.result.legacyMonths.set(student.id, called);
    if (outcome.status === "skipped") {
      this.result.counts.skipped++;
      this.issue(rowNumber, student.studentId, outcome.reason);
      return;
    }
    const rows = this.accepted.get(student.id) ?? [];
    this.accepted.set(student.id, [...rows, { row: rowNumber, studentId: student.studentId, url: outcome.url }]);
  }

  // Rows giving one Student different links are ambiguous and none is used.
  settle(): void {
    for (const [id, rows] of this.accepted) {
      if (new Set(rows.map((r) => r.url)).size === 1) {
        this.result.counts.matched += rows.length;
        this.result.links.set(id, rows[0].url);
        continue;
      }
      this.result.counts.unmatched += rows.length;
      for (const r of rows) this.issue(r.row, r.studentId, "duplicate_row");
    }
    this.result.issues.sort((a, b) => a.row - b.row);
  }
}

function readLinksTab(
  sheet: ExcelJS.Worksheet,
  tab: SourceTab,
  isLinkHeader: (key: string) => boolean,
  rowFallback: boolean,
  students: StudentIndex,
  readMonths = false
): TabResult {
  const result: TabResult = {
    read: false,
    links: new Map(),
    legacyMonths: new Map(),
    counts: { matched: 0, unmatched: 0, skipped: 0 },
    issues: [],
  };
  const columns = findColumns(sheet, isLinkHeader, readMonths);
  if (!columns) return result;
  result.read = true;

  const reader = new TabReader(result, tab);
  for (let rowNumber = columns.headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
    const outcome = readLinkRow(sheet.getRow(rowNumber), columns, rowFallback, students);
    if (outcome) reader.record(rowNumber, outcome);
  }
  reader.settle();
  return result;
}

interface StudentLinks {
  profileDocUrl: string | null;
  screenerUrl: string | null;
  legacyMonth: string | null;
}

interface ExistingLinkRow {
  student_id: number | string;
  profile_doc_url: string | null;
  screener_url: string | null;
  legacy_last_contact_month: string | null;
}

async function loadExistingLinks(studentIds: number[]): Promise<Map<number, StudentLinks>> {
  const rows = await query<ExistingLinkRow>(
    `SELECT links.student_id, links.profile_doc_url, links.screener_url,
            links.legacy_last_contact_month::text AS legacy_last_contact_month
     FROM blended_learning_student_links links
     WHERE links.student_id = ANY($1::bigint[])`,
    [studentIds]
  );
  return new Map(
    rows.map((row) => [
      Number(row.student_id),
      {
        profileDocUrl: row.profile_doc_url,
        screenerUrl: row.screener_url,
        legacyMonth: row.legacy_last_contact_month,
      },
    ])
  );
}

// A value missing from the workbook keeps the stored one; nothing is cleared.
function mergeLinks(links: Partial<StudentLinks>, stored: StudentLinks | undefined): StudentLinks {
  return {
    profileDocUrl: links.profileDocUrl ?? stored?.profileDocUrl ?? null,
    screenerUrl: links.screenerUrl ?? stored?.screenerUrl ?? null,
    legacyMonth: links.legacyMonth ?? stored?.legacyMonth ?? null,
  };
}

function sameLinks(stored: StudentLinks, next: StudentLinks, seedLegacy: boolean): boolean {
  return (
    stored.profileDocUrl === next.profileDocUrl &&
    stored.screenerUrl === next.screenerUrl &&
    (!seedLegacy || stored.legacyMonth === next.legacyMonth)
  );
}

async function writeLinks(studentId: number, next: StudentLinks, seedLegacy: boolean): Promise<void> {
  if (seedLegacy) {
    await query(
      `INSERT INTO blended_learning_student_links
         (student_id, profile_doc_url, screener_url, legacy_last_contact_month)
       VALUES ($1, $2, $3, $4::date)
       ON CONFLICT (student_id) DO UPDATE
       SET profile_doc_url = EXCLUDED.profile_doc_url,
           screener_url = EXCLUDED.screener_url,
           legacy_last_contact_month = EXCLUDED.legacy_last_contact_month,
           updated_at = now()`,
      [studentId, next.profileDocUrl, next.screenerUrl, next.legacyMonth]
    );
    return;
  }
  await query(
    `INSERT INTO blended_learning_student_links (student_id, profile_doc_url, screener_url)
     VALUES ($1, $2, $3)
     ON CONFLICT (student_id) DO UPDATE
     SET profile_doc_url = EXCLUDED.profile_doc_url,
         screener_url = EXCLUDED.screener_url,
         updated_at = now()`,
    [studentId, next.profileDocUrl, next.screenerUrl]
  );
}

// legacy_last_contact_month is read and written only with seedLegacy.
async function upsertLinks(
  found: Map<number, Partial<StudentLinks>>,
  mode: BlendedLinksImportMode,
  seedLegacy: boolean
): Promise<BlendedLinksWrites> {
  const writes: BlendedLinksWrites = { inserted: 0, updated: 0, unchanged: 0 };
  if (found.size === 0) return writes;
  const existing = await loadExistingLinks([...found.keys()]);

  for (const [studentId, links] of found) {
    const stored = existing.get(studentId);
    const next = mergeLinks(links, stored);
    if (stored && sameLinks(stored, next, seedLegacy)) {
      writes.unchanged++;
      continue;
    }
    writes[stored ? "updated" : "inserted"]++;
    if (mode === "apply") await writeLinks(studentId, next, seedLegacy);
  }
  return writes;
}

export async function runBlendedLinksImport(params: {
  workbook: ExcelJS.Workbook;
  mode: BlendedLinksImportMode;
  // Placeholder pending Poojita: seed legacy_last_contact_month from the
  // Conversation tab's monthly call counts.
  seedLegacy?: boolean;
}): Promise<BlendedLinksImportReport> {
  const seedLegacy = params.seedLegacy === true;
  const students = await loadActiveMappedStudents();
  // Only the Profile Docs tab may take a row's first link (e.g. a hyperlinked
  // name). The Conversation tab's link must come from its Screener Form
  // column: without one, its rows are no_link, never another cell's link.
  const tabs = [
    { name: PROFILE_DOCS_TAB, isLinkHeader: (key: string) => /profile doc/.test(key), rowFallback: true },
    { name: CONVERSATION_TAB, isLinkHeader: (key: string) => key === "screener form", rowFallback: false },
  ] as const;

  const report: BlendedLinksImportReport = {
    mode: params.mode,
    unreadTabs: [],
    counts: { matched: 0, unmatched: 0, skipped: 0 },
    writes: { inserted: 0, updated: 0, unchanged: 0 },
    issues: [],
  };
  const found = new Map<number, Partial<StudentLinks>>();
  for (const tab of tabs) {
    const sheet = params.workbook.getWorksheet(tab.name);
    const result = sheet
      ? readLinksTab(
          sheet, tab.name, tab.isLinkHeader, tab.rowFallback, students,
          seedLegacy && tab.name === CONVERSATION_TAB
        )
      : null;
    if (!result?.read) {
      report.unreadTabs.push(tab.name);
      continue;
    }
    report.counts.matched += result.counts.matched;
    report.counts.unmatched += result.counts.unmatched;
    report.counts.skipped += result.counts.skipped;
    report.issues.push(...result.issues);
    const field = tab.name === PROFILE_DOCS_TAB ? "profileDocUrl" : "screenerUrl";
    for (const [studentId, url] of result.links) {
      found.set(studentId, { ...found.get(studentId), [field]: url });
    }
    for (const [studentId, legacyMonth] of result.legacyMonths) {
      found.set(studentId, { ...found.get(studentId), legacyMonth });
    }
  }
  report.writes = await upsertLinks(found, params.mode, seedLegacy);
  return report;
}

// Operator output: counts, then issues by tab, row and Student ID only.
export function formatBlendedLinksImportReport(report: BlendedLinksImportReport): string[] {
  const { counts, writes } = report;
  const lines = [`Blended Learning links import (${report.mode})`];
  if (report.unreadTabs.length > 0) {
    lines.push(
      `Not read (missing tab or no Student ID / Name header): ${report.unreadTabs.join(", ")}`
    );
  }
  lines.push(
    `Matched: ${counts.matched}, unmatched: ${counts.unmatched}, skipped: ${counts.skipped}`,
    `Writes${report.mode === "apply" ? "" : " (would be made)"}: inserted ${writes.inserted}, ` +
      `updated ${writes.updated}, unchanged ${writes.unchanged}`
  );
  if (report.issues.length > 0) {
    lines.push("Issues");
    for (const issue of report.issues) {
      const student = issue.studentId ? ` (Student ID ${issue.studentId})` : "";
      lines.push(`- ${issue.tab} row ${issue.row}${student}: ${issue.reason}`);
    }
  }
  return lines;
}
