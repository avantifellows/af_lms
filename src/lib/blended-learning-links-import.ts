import type ExcelJS from "exceljs";

import { activeBlendedMappingSql } from "./blended-learning-access";
import {
  withDoneCarriedOver,
  type LegacyActionItem,
  type LegacyConversationInvalidReason,
  type LegacyConversations,
} from "./blended-learning-legacy-conversations";
import {
  latestProfileDocConversationOn,
  legacyDateWindow,
  type DateWindow,
} from "./blended-learning-profile-doc-dates";
import { CURRENT_ACADEMIC_YEAR } from "./constants";
import { query } from "./db";

// Operator-run load of Blended Learning Student Links (Profile Doc, Screener
// Link) from the Profile Dashboard workbook, and optionally the legacy
// last-contact date from the Profile Docs' HTML exports, with that latest
// conversation's summary and action items from an externally summarised file
// (--legacy-conversations). Run by
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

// How each Student with a "dated" Profile Doc got its legacy conversation:
// "loaded" from the file's entry for that doc on that date; NULL when the
// file has no entry for the doc, one for another date, or an invalid one.
// "unused" counts file entries no dated doc in this run took.
type LegacyConversationOutcome = "loaded" | "summary_missing" | "summary_stale" | "summary_invalid";
type LegacyConversationCounts = Record<LegacyConversationOutcome | "unused", number>;

// By Student ID only, never the doc or its content.
interface LegacyConversationIssue {
  studentId: string | null;
  reason: LegacyConversationInvalidReason;
}

export interface BlendedLinksImportReport {
  mode: BlendedLinksImportMode;
  // Only when legacy last-contact dates were loaded.
  legacy: LegacyDocCounts | null;
  // Only when legacy conversations were loaded too.
  legacyConversations: LegacyConversationCounts | null;
  legacyConversationIssues: LegacyConversationIssue[];
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
  legacySummary: string | null;
  legacyActionItems: LegacyActionItem[] | null;
}

// What the workbook gave for one Student.
type FoundLinks = { profileDocUrl?: string; screenerUrl?: string };

interface ExistingLinkRow {
  student_id: number | string;
  profile_doc_url: string | null;
  screener_url: string | null;
  legacy_last_contact_on: string | null;
  legacy_conversation_summary: string | null;
  legacy_action_items: LegacyActionItem[] | null;
}

async function loadExistingLinks(studentIds: number[]): Promise<Map<number, StudentLinks>> {
  const rows = await query<ExistingLinkRow>(
    `SELECT links.student_id, links.profile_doc_url, links.screener_url,
            links.legacy_last_contact_on::text AS legacy_last_contact_on,
            links.legacy_conversation_summary, links.legacy_action_items
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
        legacySummary: row.legacy_conversation_summary,
        legacyActionItems: row.legacy_action_items,
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
    legacySummary: stored?.legacySummary ?? null,
    legacyActionItems: stored?.legacyActionItems ?? null,
  };
}

// Which optional columns this run reads and writes: legacy_last_contact_on
// with Profile Docs, the legacy conversation with its file too.
type ColumnSet = { legacy: boolean; conversations: boolean };

// jsonb comes back with its keys reordered, so items compare by value.
function itemsKey(items: LegacyActionItem[] | null): string {
  return JSON.stringify(
    items?.map((item) => [item.text, item.owner, item.done_at ?? null, item.done_by_email ?? null]) ?? null
  );
}

function sameLinks(stored: StudentLinks, next: StudentLinks, columns: ColumnSet): boolean {
  return (
    stored.profileDocUrl === next.profileDocUrl &&
    stored.screenerUrl === next.screenerUrl &&
    (!columns.legacy || stored.legacyOn === next.legacyOn) &&
    (!columns.conversations ||
      (stored.legacySummary === next.legacySummary &&
        itemsKey(stored.legacyActionItems) === itemsKey(next.legacyActionItems)))
  );
}

// [column, placeholder cast, value] for each column this run writes. Column
// names are these fixed literals; every value is a bound parameter.
function writtenColumns(next: StudentLinks, columns: ColumnSet): [string, string, unknown][] {
  const written: [string, string, unknown][] = [
    ["profile_doc_url", "", next.profileDocUrl],
    ["screener_url", "", next.screenerUrl],
  ];
  if (columns.legacy) written.push(["legacy_last_contact_on", "::date", next.legacyOn]);
  if (columns.conversations) {
    written.push(
      ["legacy_conversation_summary", "", next.legacySummary],
      ["legacy_action_items", "::jsonb", next.legacyActionItems && JSON.stringify(next.legacyActionItems)]
    );
  }
  return written;
}

async function writeLinks(studentId: number, next: StudentLinks, columns: ColumnSet): Promise<void> {
  const written = writtenColumns(next, columns);
  const names = written.map(([name]) => name);
  await query(
    `INSERT INTO blended_learning_student_links (student_id, ${names.join(", ")})
     VALUES ($1, ${written.map(([, cast], index) => `$${index + 2}${cast}`).join(", ")})
     ON CONFLICT (student_id) DO UPDATE
     SET ${names.map((name) => `${name} = EXCLUDED.${name}`).join(", ")},
         updated_at = now()`,
    [studentId, ...written.map(([, , value]) => value)]
  );
}

// Where the legacy last-contact dates come from: each Profile Doc's HTML
// export, by Drive file id (null when there is no export for it).
export interface LegacyProfileDocs {
  readProfileDocHtml: (docId: string) => string | null;
  // Conversation dates outside this window are ignored.
  window: DateWindow;
  // Also load each dated doc's latest conversation from this file.
  conversations?: LegacyConversations | null;
}

export { legacyDateWindow };

// The Drive file id in a Profile Doc link: /document/d/<id>/… or ?id=<id>.
export function profileDocId(url: string | null): string | null {
  const match = url?.match(/\/d\/([A-Za-z0-9_-]+)/) ?? url?.match(/[?&]id=([A-Za-z0-9_-]+)/);
  return match ? match[1] : null;
}

type LegacyResolution = { outcome: LegacyDocOutcome; docId?: string; legacyOn?: string | null };

// The rule (product owner, 2026-10-23): the latest dated conversation in the
// Profile Doc only; a readable doc with no dated conversation gives NULL.
function resolveLegacy(next: StudentLinks, docs: LegacyProfileDocs): LegacyResolution {
  const docId = profileDocId(next.profileDocUrl);
  if (!docId) return { outcome: "no_doc_link" };
  const html = docs.readProfileDocHtml(docId);
  if (html === null) return { outcome: "unreadable" };
  const legacyOn = latestProfileDocConversationOn(html, docs.window);
  return { outcome: legacyOn === null ? "no_dates" : "dated", docId, legacyOn };
}

// The file's entry for a dated doc, only when it is for that same date. Its
// items keep the done state of the stored ones they match.
function resolveConversation(
  conversations: LegacyConversations,
  docId: string,
  legacyOn: string,
  storedItems: LegacyActionItem[] | null
): { outcome: LegacyConversationOutcome; summary: string | null; items: LegacyActionItem[] | null } {
  const entry = conversations.entries.get(docId);
  if (conversations.invalid.has(docId)) return { outcome: "summary_invalid", summary: null, items: null };
  if (!entry) return { outcome: "summary_missing", summary: null, items: null };
  if (entry.occurredOn !== legacyOn) return { outcome: "summary_stale", summary: null, items: null };
  const items = entry.actionItems && withDoneCarriedOver(entry.actionItems, storedItems);
  return { outcome: "loaded", summary: entry.summary, items };
}

// The legacy columns for one Student's doc, with each outcome counted.
class LegacyRun {
  readonly counts: LegacyDocCounts = { dated: 0, no_dates: 0, unreadable: 0, no_doc_link: 0 };
  readonly conversationCounts: LegacyConversationCounts = {
    loaded: 0, summary_missing: 0, summary_stale: 0, summary_invalid: 0, unused: 0,
  };
  readonly issues: LegacyConversationIssue[] = [];
  private readonly usedDocs = new Set<string>();

  constructor(
    readonly docs: LegacyProfileDocs,
    private readonly studentIds: Map<number, string | null>
  ) {}

  get conversations(): LegacyConversations | null {
    return this.docs.conversations ?? null;
  }

  // Sets next.legacyOn when the Student's doc was read, and with a
  // conversations file its summary and items: those of the file's entry for
  // a dated doc, NULL for a doc read without one. An unreadable doc or no
  // link keeps every stored value.
  apply(studentId: number, next: StudentLinks): void {
    const resolution = resolveLegacy(next, this.docs);
    this.counts[resolution.outcome]++;
    if (resolution.legacyOn === undefined) return;
    next.legacyOn = resolution.legacyOn;
    const conversations = this.conversations;
    if (conversations) this.applyConversation(studentId, next, conversations, resolution.docId, resolution.legacyOn);
  }

  // A read doc: its dated entry's summary from the file, else NULL.
  private applyConversation(
    studentId: number,
    next: StudentLinks,
    conversations: LegacyConversations,
    docId: string | undefined,
    legacyOn: string | null
  ): void {
    const storedItems = next.legacyActionItems;
    next.legacySummary = null;
    next.legacyActionItems = null;
    if (!docId || legacyOn === null) return;
    this.usedDocs.add(docId);
    const found = resolveConversation(conversations, docId, legacyOn, storedItems);
    this.conversationCounts[found.outcome]++;
    next.legacySummary = found.summary;
    next.legacyActionItems = found.items;
    const reason = conversations.invalid.get(docId);
    if (reason) this.issues.push({ studentId: this.studentIds.get(studentId) ?? null, reason });
  }

  report(): Pick<BlendedLinksImportReport, "legacy" | "legacyConversations" | "legacyConversationIssues"> {
    const conversations = this.conversations;
    if (conversations) {
      const fileDocs = [...conversations.entries.keys(), ...conversations.invalid.keys()];
      this.conversationCounts.unused = fileDocs.filter((docId) => !this.usedDocs.has(docId)).length;
    }
    return {
      legacy: this.counts,
      legacyConversations: conversations ? this.conversationCounts : null,
      legacyConversationIssues: this.issues,
    };
  }
}

// What the upsert does for one Student: null for one with no stored row and
// no link, who gets no row.
function writeKind(stored: StudentLinks | undefined, next: StudentLinks, columns: ColumnSet): keyof BlendedLinksWrites | null {
  if (!stored) return next.profileDocUrl || next.screenerUrl ? "inserted" : null;
  return sameLinks(stored, next, columns) ? "unchanged" : "updated";
}

// legacy_last_contact_on is read and written only with legacy Profile Docs,
// the legacy conversation only with its file too. Re-runnable: a doc read
// again rewrites them; a doc with no export keeps whatever is stored.
async function upsertLinks(
  found: Map<number, FoundLinks>,
  mode: BlendedLinksImportMode,
  legacy: LegacyRun | null
): Promise<BlendedLinksWrites> {
  const writes: BlendedLinksWrites = { inserted: 0, updated: 0, unchanged: 0 };
  if (found.size === 0) return writes;
  const columns: ColumnSet = { legacy: legacy !== null, conversations: Boolean(legacy?.conversations) };
  const existing = await loadExistingLinks([...found.keys()]);

  for (const [studentId, links] of found) {
    const stored = existing.get(studentId);
    const next = mergeLinks(links, stored);
    legacy?.apply(studentId, next);
    const kind = writeKind(stored, next, columns);
    if (!kind) continue;
    writes[kind]++;
    if (kind !== "unchanged" && mode === "apply") await writeLinks(studentId, next, columns);
  }
  return writes;
}

// Each matched Student's Student ID, for the report.
function studentIdsOf(students: StudentIndex): Map<number, string | null> {
  const ids = new Map<number, string | null>();
  for (const candidates of students.byName.values()) for (const student of candidates) ids.set(student.id, student.studentId);
  for (const student of students.byStudentId.values()) ids.set(student.id, student.studentId);
  return ids;
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
  // Also load legacy_last_contact_on from these Profile Doc exports (and,
  // with their conversations file, the latest conversation).
  legacyProfileDocs?: LegacyProfileDocs | null;
}): Promise<BlendedLinksImportReport> {
  const docs = params.legacyProfileDocs ?? null;
  const students = await loadActiveMappedStudents();
  const legacy = docs ? new LegacyRun(docs, studentIdsOf(students)) : null;
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
    legacyConversations: null,
    legacyConversationIssues: [],
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
  report.writes = await upsertLinks(found, params.mode, legacy);
  if (legacy) Object.assign(report, legacy.report());
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

function formatLegacyConversationCounts(counts: LegacyConversationCounts): string {
  return (
    `Legacy conversation (dated Profile Docs): loaded ${counts.loaded}, ` +
    `NULL with no summary for the doc ${counts.summary_missing}, ` +
    `NULL with a summary of another date ${counts.summary_stale}, ` +
    `NULL with an invalid summary ${counts.summary_invalid}; ` +
    `file entries no dated doc used ${counts.unused}`
  );
}

function formatLegacyConversationIssues(issues: LegacyConversationIssue[]): string[] {
  if (issues.length === 0) return [];
  return [
    "Invalid legacy conversations (left NULL)",
    ...issues.map((issue) => `- ${issue.studentId ? `Student ID ${issue.studentId}` : "Student without a Student ID"}: ${issue.reason}`),
  ];
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
  if (report.legacyConversations) lines.push(formatLegacyConversationCounts(report.legacyConversations));
  if (report.issues.length > 0) {
    lines.push("Issues");
    for (const issue of report.issues) {
      const student = issue.studentId ? ` (Student ID ${issue.studentId})` : "";
      lines.push(`- ${issue.tab} row ${issue.row}${student}: ${issue.reason}`);
    }
  }
  lines.push(...formatLegacyConversationIssues(report.legacyConversationIssues));
  return lines;
}
