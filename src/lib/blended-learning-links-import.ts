import type ExcelJS from "exceljs";

import { activeBlendedMappingSql } from "./blended-learning-access";
import { latestProfileDocConversationOn, type DateWindow } from "./blended-learning-profile-doc-dates";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { query } from "./db";

// Operator-run load of Blended Learning Student Links (Profile Doc, Screener
// Link) from the Profile Dashboard workbook, and optionally the legacy
// last-contact date from the Profile Docs' HTML exports. Run by
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

// How each Student's Profile Doc fed legacy_last_contact_on. Only "dated" and
// "no_dates" (the doc was read) write the column; "unreadable" (no export
// for the doc) and "no_doc_link" keep the stored value, NULL until a re-run
// has the doc.
type LegacyDocOutcome = "dated" | "no_dates" | "unreadable" | "no_doc_link";

type LegacyDocCounts = Record<LegacyDocOutcome, number>;

export interface BlendedLinksImportReport {
  mode: BlendedLinksImportMode;
  // Only when legacy last-contact dates were loaded.
  legacy: LegacyDocCounts | null;
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

interface TabColumns {
  headerRow: number;
  studentId: number | null;
  name: number | null;
  link: number | null;
}

// The header row is the first of the top ten rows naming a Student ID or name column.
function findColumns(sheet: ExcelJS.Worksheet, isLinkHeader: (key: string) => boolean): TabColumns | null {
  for (let rowNumber = 1; rowNumber <= Math.min(10, sheet.rowCount); rowNumber++) {
    const columns: TabColumns = { headerRow: rowNumber, studentId: null, name: null, link: null };
    sheet.getRow(rowNumber).eachCell((cell, col) => {
      const key = headerKey(cell.text ?? "");
      if (key === "student id" && columns.studentId == null) columns.studentId = col;
      else if (/^(student )?(full )?name$/.test(key) && columns.name == null) columns.name = col;
      else if (isLinkHeader(key) && columns.link == null) columns.link = col;
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

const HTTPS_URL = /^https:\/\/\S+$/;

interface TabResult {
  read: boolean;
  links: Map<number, string>;
  // Every Student a row matched, with or without a usable link.
  matched: Set<number>;
  counts: BlendedLinksCounts;
  issues: BlendedLinksIssue[];
}

type RowOutcome =
  | { status: "unmatched"; studentId: string | null; reason: BlendedLinksIssueReason }
  | { status: "skipped"; student: MappedStudent; reason: BlendedLinksIssueReason }
  | { status: "accepted"; student: MappedStudent; url: string };

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

  const url = rowHyperlink(row, columns.link, rowFallback);
  if (!url) return { status: "skipped", student, reason: "no_link" };
  if (!HTTPS_URL.test(url)) return { status: "skipped", student, reason: "not_https" };
  return { status: "accepted", student, url };
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
    const { student } = outcome;
    this.result.matched.add(student.id);
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
  students: StudentIndex
): TabResult {
  const result: TabResult = {
    read: false,
    links: new Map(),
    matched: new Set(),
    counts: { matched: 0, unmatched: 0, skipped: 0 },
    issues: [],
  };
  const columns = findColumns(sheet, isLinkHeader);
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
  legacyOn: string | null;
}

// What the workbook gave for one Student.
type FoundLinks = { profileDocUrl?: string; screenerUrl?: string };

interface ExistingLinkRow {
  student_id: number | string;
  profile_doc_url: string | null;
  screener_url: string | null;
  legacy_last_contact_on: string | null;
}

async function loadExistingLinks(studentIds: number[]): Promise<Map<number, StudentLinks>> {
  const rows = await query<ExistingLinkRow>(
    `SELECT links.student_id, links.profile_doc_url, links.screener_url,
            links.legacy_last_contact_on::text AS legacy_last_contact_on
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
        legacyOn: row.legacy_last_contact_on,
      },
    ])
  );
}

// A value missing from the workbook keeps the stored one; nothing is cleared.
function mergeLinks(links: FoundLinks, stored: StudentLinks | undefined): StudentLinks {
  return {
    profileDocUrl: links.profileDocUrl ?? stored?.profileDocUrl ?? null,
    screenerUrl: links.screenerUrl ?? stored?.screenerUrl ?? null,
    legacyOn: stored?.legacyOn ?? null,
  };
}

function sameLinks(stored: StudentLinks, next: StudentLinks, withLegacy: boolean): boolean {
  return (
    stored.profileDocUrl === next.profileDocUrl &&
    stored.screenerUrl === next.screenerUrl &&
    (!withLegacy || stored.legacyOn === next.legacyOn)
  );
}

async function writeLinks(studentId: number, next: StudentLinks, withLegacy: boolean): Promise<void> {
  if (withLegacy) {
    await query(
      `INSERT INTO blended_learning_student_links
         (student_id, profile_doc_url, screener_url, legacy_last_contact_on)
       VALUES ($1, $2, $3, $4::date)
       ON CONFLICT (student_id) DO UPDATE
       SET profile_doc_url = EXCLUDED.profile_doc_url,
           screener_url = EXCLUDED.screener_url,
           legacy_last_contact_on = EXCLUDED.legacy_last_contact_on,
           updated_at = now()`,
      [studentId, next.profileDocUrl, next.screenerUrl, next.legacyOn]
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

// Where the legacy last-contact dates come from: each Profile Doc's HTML
// export, by Drive file id (null when there is no export for it).
export interface LegacyProfileDocs {
  readProfileDocHtml: (docId: string) => string | null;
  // Conversation dates outside this window are ignored.
  window: DateWindow;
}

// The academic year's first day to asOf (an IST YYYY-MM-DD).
export function legacyDateWindow(asOf: string): DateWindow {
  return { from: `${CURRENT_ACADEMIC_YEAR.slice(0, 4)}-04-01`, to: asOf };
}

// The Drive file id in a Profile Doc link: /document/d/<id>/… or ?id=<id>.
export function profileDocId(url: string | null): string | null {
  const match = url?.match(/\/d\/([A-Za-z0-9_-]+)/) ?? url?.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

type LegacyResolution = { outcome: LegacyDocOutcome; legacyOn?: string | null };

// The rule (product owner, 2026-10-23): the latest dated conversation in the
// Profile Doc only; a readable doc with no dated conversation gives NULL.
function resolveLegacy(next: StudentLinks, docs: LegacyProfileDocs): LegacyResolution {
  const docId = profileDocId(next.profileDocUrl);
  if (!docId) return { outcome: "no_doc_link" };
  const html = docs.readProfileDocHtml(docId);
  if (html === null) return { outcome: "unreadable" };
  const legacyOn = latestProfileDocConversationOn(html, docs.window);
  return { outcome: legacyOn === null ? "no_dates" : "dated", legacyOn };
}

// Sets next.legacyOn when the Student's doc was read, and counts the outcome.
function applyLegacy(next: StudentLinks, docs: LegacyProfileDocs, counts: LegacyDocCounts): void {
  const resolution = resolveLegacy(next, docs);
  counts[resolution.outcome]++;
  if (resolution.legacyOn !== undefined) next.legacyOn = resolution.legacyOn;
}

// What the upsert does for one Student: null for one with no stored row and
// no link, who gets no row.
function writeKind(stored: StudentLinks | undefined, next: StudentLinks, withLegacy: boolean): keyof BlendedLinksWrites | null {
  if (!stored) return next.profileDocUrl || next.screenerUrl ? "inserted" : null;
  return sameLinks(stored, next, withLegacy) ? "unchanged" : "updated";
}

function emptyLegacyCounts(): LegacyDocCounts {
  return { dated: 0, no_dates: 0, unreadable: 0, no_doc_link: 0 };
}

// legacy_last_contact_on is read and written only with legacy Profile Docs.
// Re-runnable: a doc read again rewrites its date; a doc with no export
// keeps whatever is stored.
async function upsertLinks(
  found: Map<number, FoundLinks>,
  mode: BlendedLinksImportMode,
  docs: LegacyProfileDocs | null
): Promise<Pick<BlendedLinksImportReport, "writes" | "legacy">> {
  const writes: BlendedLinksWrites = { inserted: 0, updated: 0, unchanged: 0 };
  const legacy = docs ? emptyLegacyCounts() : null;
  if (found.size === 0) return { writes, legacy };
  const existing = await loadExistingLinks([...found.keys()]);

  for (const [studentId, links] of found) {
    const stored = existing.get(studentId);
    const next = mergeLinks(links, stored);
    if (docs && legacy) applyLegacy(next, docs, legacy);
    const kind = writeKind(stored, next, docs !== null);
    if (!kind) continue;
    writes[kind]++;
    if (kind !== "unchanged" && mode === "apply") await writeLinks(studentId, next, docs !== null);
  }
  return { writes, legacy };
}

// Adds one tab's links to `found`. With Profile Docs every matched Student is
// kept, so one whose rows had no usable link still gets a legacy date from a
// stored Profile Doc link.
function collectLinks(
  found: Map<number, FoundLinks>,
  result: TabResult,
  field: "profileDocUrl" | "screenerUrl",
  keepMatched: boolean
): void {
  for (const [studentId, url] of result.links) found.set(studentId, { ...found.get(studentId), [field]: url });
  if (keepMatched) for (const studentId of result.matched) found.set(studentId, found.get(studentId) ?? {});
}

export async function runBlendedLinksImport(params: {
  workbook: ExcelJS.Workbook;
  mode: BlendedLinksImportMode;
  // Also load legacy_last_contact_on from these Profile Doc exports.
  legacyProfileDocs?: LegacyProfileDocs | null;
}): Promise<BlendedLinksImportReport> {
  const docs = params.legacyProfileDocs ?? null;
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
    legacy: null,
    unreadTabs: [],
    counts: { matched: 0, unmatched: 0, skipped: 0 },
    writes: { inserted: 0, updated: 0, unchanged: 0 },
    issues: [],
  };
  const found = new Map<number, FoundLinks>();
  for (const tab of tabs) {
    const sheet = params.workbook.getWorksheet(tab.name);
    const result = sheet ? readLinksTab(sheet, tab.name, tab.isLinkHeader, tab.rowFallback, students) : null;
    if (!result?.read) {
      report.unreadTabs.push(tab.name);
      continue;
    }
    report.counts.matched += result.counts.matched;
    report.counts.unmatched += result.counts.unmatched;
    report.counts.skipped += result.counts.skipped;
    report.issues.push(...result.issues);
    collectLinks(found, result, tab.name === PROFILE_DOCS_TAB ? "profileDocUrl" : "screenerUrl", docs !== null);
  }
  Object.assign(report, await upsertLinks(found, params.mode, docs));
  return report;
}

function formatLegacyCounts(legacy: LegacyDocCounts): string {
  return (
    `Legacy last contact (Profile Docs only): dated ${legacy.dated}, ` +
    `NULL with no dated conversation ${legacy.no_dates}, ` +
    `unreadable (no export; stored value kept) ${legacy.unreadable}, ` +
    `no Profile Doc link ${legacy.no_doc_link}`
  );
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
  if (report.legacy) lines.push(formatLegacyCounts(report.legacy));
  if (report.issues.length > 0) {
    lines.push("Issues");
    for (const issue of report.issues) {
      const student = issue.studentId ? ` (Student ID ${issue.studentId})` : "";
      lines.push(`- ${issue.tab} row ${issue.row}${student}: ${issue.reason}`);
    }
  }
  return lines;
}
