import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
import { parseLegacyConversations } from "./blended-learning-legacy-conversations";
import {
  formatBlendedLinksImportReport,
  legacyDateWindow,
  profileDocId,
  runBlendedLinksImport,
} from "./blended-learning-links-import";

const mockQuery = vi.mocked(query);

// Fixture: active current-year Mappings (student pk, Student ID, name) and the
// links table as it stands. The fake answers the Mapping read, the links read
// and the upsert, keeping the links table in memory.
interface MappedStudent {
  id: number;
  studentId: string;
  firstName: string;
  lastName: string;
}
interface LinkRow {
  student_id: number;
  profile_doc_url: string | null;
  screener_url: string | null;
  legacy_last_contact_on: string | null;
  // Left undefined (so toEqual ignores them) until a run writes them.
  legacy_conversation_summary?: string | null;
}
// Profile Doc Action Items (from_profile_doc) as stored.
interface ItemRow {
  id: number;
  student_id: number;
  position: number;
  text: string;
  owner: string;
  status: "open" | "done";
}

let linksTable: Map<number, LinkRow>;
let itemsTable: ItemRow[];
let itemWrites: string[];
let writes: unknown[][];

// The fake's side of the importer's Profile Doc Action Item statements.
function fakeItemsQuery(sql: string, params: unknown[]): unknown[] | null {
  if (!/blended_learning_action_items/.test(sql)) return null;
  if (/^\s*SELECT/.test(sql)) {
    const ids = params[0] as number[];
    return itemsTable.filter((item) => ids.includes(item.student_id)).map((item) => ({ ...item }));
  }
  if (/^\s*DELETE/.test(sql)) {
    itemWrites.push("delete");
    const ids = params[0] as number[];
    itemsTable = itemsTable.filter((item) => !(ids.includes(item.id) && item.status === "open"));
    return [];
  }
  const rows = JSON.parse(params[0] as string) as Record<string, unknown>[];
  if (/^\s*INSERT/.test(sql)) {
    itemWrites.push("insert");
    for (const row of rows) {
      const id = Math.max(0, ...itemsTable.map((item) => item.id)) + 1;
      itemsTable.push({ id, status: "open", ...(row as Omit<ItemRow, "id" | "status">) });
    }
    return [];
  }
  itemWrites.push("update");
  for (const row of rows) {
    const item = itemsTable.find((candidate) => candidate.id === row.id);
    if (item) item.position = row.position as number;
  }
  return [];
}

function givenDatabase(mapped: MappedStudent[], links: LinkRow[] = [], items: ItemRow[] = []) {
  linksTable = new Map(links.map((l) => [l.student_id, { ...l }]));
  itemsTable = items.map((item) => ({ ...item }));
  itemWrites = [];
  writes = [];
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
    const items = fakeItemsQuery(sql, params ?? []);
    if (items) return items as never[];
    if (/FROM blended_learning_mentor_mentee_mappings/.test(sql)) {
      expect(params).toEqual(["2026-2027"]);
      return mapped.map((m) => ({
        id: m.id, student_id: m.studentId, first_name: m.firstName, last_name: m.lastName,
      })) as never[];
    }
    if (/^\s*SELECT[\s\S]*FROM blended_learning_student_links/.test(sql)) {
      return [...linksTable.values()].map((l) => ({ ...l })) as never[];
    }
    if (/INSERT INTO blended_learning_student_links/.test(sql)) {
      writes.push(params ?? []);
      // The upsert names its columns after student_id; params follow in order.
      const columns = sql.match(/\(student_id, ([^)]*)\)/)![1].split(",").map((name) => name.trim());
      const [studentId, ...values] = params as [number, ...unknown[]];
      const written = Object.fromEntries(columns.map((name, index) => [name, values[index]]));
      const existing = linksTable.get(studentId);
      linksTable.set(studentId, {
        legacy_last_contact_on: null,
        ...existing,
        ...written,
        student_id: studentId,
      } as LinkRow);
      return [];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  });
}

type CellSpec = string | number | null | { text: string; hyperlink: string };

function addSheet(workbook: ExcelJS.Workbook, name: string, header: string[], rows: CellSpec[][]) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(header);
  for (const row of rows) sheet.addRow(row);
  return sheet;
}

function link(text: string, hyperlink: string) {
  return { text, hyperlink };
}

const ASHA = { id: 501, studentId: "2612001", firstName: "Asha", lastName: "Verma" };
const RAVI = { id: 502, studentId: "2612002", firstName: "Ravi", lastName: "Kumar" };

const ASHA_DOC = "https://docs.google.com/document/d/asha-doc";
const ASHA_SCREENER = "https://forms.gle/asha-screener";

beforeEach(() => {
  mockQuery.mockReset();
});

describe("runBlendedLinksImport", () => {
  it("dry run reports matched, unmatched and skipped counts and writes nothing", async () => {
    givenDatabase([ASHA, RAVI]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name"], [
      ["2612001", link("Asha Verma", ASHA_DOC)],
      ["2612002", "Ravi Kumar"],
      ["2699999", link("Nobody Here", "https://docs.google.com/document/d/nobody")],
    ]);
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Screener Form"], [
      ["2612001", "Asha Verma", link("Form", ASHA_SCREENER)],
    ]);

    const report = await runBlendedLinksImport({ workbook, mode: "dry-run" });

    expect(report.counts).toEqual({ matched: 2, unmatched: 1, skipped: 1 });
    expect(writes).toEqual([]);
    expect(linksTable.size).toBe(0);
  });

  function ashaAndRaviWorkbook(ashaDoc: string) {
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name", "Profile Doc"], [
      ["2612001", "Asha Verma", link("Profile", ashaDoc)],
      ["2612002", "Ravi Kumar", link("Profile", "https://docs.google.com/document/d/ravi-doc")],
    ]);
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Screener Form"], [
      ["2612001", "Asha Verma", link("Form", ASHA_SCREENER)],
      ["2612002", "Ravi Kumar", null],
    ]);
    return workbook;
  }

  it("apply upserts each Student's links, updates changed URLs and leaves unchanged rows alone", async () => {
    givenDatabase([ASHA, RAVI]);

    const first = await runBlendedLinksImport({ workbook: ashaAndRaviWorkbook(ASHA_DOC), mode: "apply" });
    expect(first.writes).toEqual({ inserted: 2, updated: 0, unchanged: 0 });
    expect(linksTable.get(501)).toEqual({
      student_id: 501, profile_doc_url: ASHA_DOC, screener_url: ASHA_SCREENER,
      legacy_last_contact_on: null,
    });
    expect(linksTable.get(502)).toEqual({
      student_id: 502, profile_doc_url: "https://docs.google.com/document/d/ravi-doc",
      screener_url: null, legacy_last_contact_on: null,
    });

    writes = [];
    const unchanged = await runBlendedLinksImport({ workbook: ashaAndRaviWorkbook(ASHA_DOC), mode: "apply" });
    expect(unchanged.writes).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(writes).toEqual([]);

    const changed = await runBlendedLinksImport({
      workbook: ashaAndRaviWorkbook("https://docs.google.com/document/d/asha-doc-v2"),
      mode: "apply",
    });
    expect(changed.writes).toEqual({ inserted: 0, updated: 1, unchanged: 1 });
    expect(linksTable.get(501)?.profile_doc_url).toBe("https://docs.google.com/document/d/asha-doc-v2");
    expect(linksTable.get(501)?.screener_url).toBe(ASHA_SCREENER);
  });

  it("matches by exact normalised name without a Student ID, and reports duplicates, unmatched and non-https rows", async () => {
    const PRIYA_A = { id: 601, studentId: "2613001", firstName: "Priya", lastName: "Singh" };
    const PRIYA_B = { id: 602, studentId: "2613002", firstName: "Priya", lastName: "Singh" };
    givenDatabase([ASHA, RAVI, PRIYA_A, PRIYA_B]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Name", "Profile Doc"], [
      ["  asha   VERMA ", link("Profile", ASHA_DOC)],
      ["Ravi Kumar", link("Profile", "http://docs.google.com/document/d/ravi-doc")],
      ["Priya Singh", link("Profile", "https://docs.google.com/document/d/priya")],
      ["Ravi Kumarr", link("Profile", "https://docs.google.com/document/d/typo")],
    ]);
    addSheet(workbook, "Conversation", ["Name", "Screener Form"], [
      ["Ravi Kumar", { text: "Form", hyperlink: "mailto:ravi@example.com" }],
    ]);

    const report = await runBlendedLinksImport({ workbook, mode: "apply" });

    expect(report.counts).toEqual({ matched: 1, unmatched: 2, skipped: 2 });
    expect(report.issues).toEqual([
      { tab: "Student Profile Docs", row: 3, studentId: "2612002", reason: "not_https" },
      { tab: "Student Profile Docs", row: 4, studentId: null, reason: "ambiguous_name" },
      { tab: "Student Profile Docs", row: 5, studentId: null, reason: "no_match" },
      { tab: "Conversation", row: 2, studentId: "2612002", reason: "not_https" },
    ]);
    expect([...linksTable.keys()]).toEqual([501]);
    expect(linksTable.get(501)?.profile_doc_url).toBe(ASHA_DOC);
  });

  it("does not pick between two rows that give one Student different links", async () => {
    givenDatabase([ASHA, RAVI]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Name", "Profile Doc"], [
      ["2612001", "Asha Verma", link("Profile", ASHA_DOC)],
      ["2612002", "Ravi Kumar", link("Profile", "https://docs.google.com/document/d/ravi-1")],
      ["", "Ravi Kumar", link("Profile", "https://docs.google.com/document/d/ravi-2")],
      ["2612001", "Asha Verma", link("Profile", ASHA_DOC)],
    ]);

    const report = await runBlendedLinksImport({ workbook, mode: "apply" });

    expect(report.counts).toEqual({ matched: 2, unmatched: 2, skipped: 0 });
    expect(report.issues).toEqual([
      { tab: "Student Profile Docs", row: 3, studentId: "2612002", reason: "duplicate_row" },
      { tab: "Student Profile Docs", row: 4, studentId: "2612002", reason: "duplicate_row" },
    ]);
    expect([...linksTable.keys()]).toEqual([501]);
  });

  function conversationTab() {
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Screener Form"], [
      ["2612001", "Asha Verma", link("Form", "https://forms.gle/asha-screener-v2")],
      ["2612002", "Ravi Kumar", null],
    ]);
    return workbook;
  }

  it("leaves legacy_last_contact_on untouched without legacy Profile Docs", async () => {
    givenDatabase([ASHA, RAVI], [
      { student_id: 501, profile_doc_url: ASHA_DOC, screener_url: ASHA_SCREENER, legacy_last_contact_on: "2026-06-14" },
    ]);

    const report = await runBlendedLinksImport({ workbook: conversationTab(), mode: "apply" });

    expect(report.writes).toEqual({ inserted: 0, updated: 1, unchanged: 0 });
    expect(report.legacy).toBeNull();
    expect(linksTable.get(501)).toEqual({
      student_id: 501, profile_doc_url: ASHA_DOC, screener_url: "https://forms.gle/asha-screener-v2",
      legacy_last_contact_on: "2026-06-14",
    });
    expect(linksTable.has(502)).toBe(false);
  });

  // Synthetic Profile Doc exports: an intake tab, then a month tab.
  function profileDocHtml(...entries: string[]) {
    const tab = (title: string) => `<p class="title"><span>${title}</span></p>`;
    return `<html><body>${tab("Student Interview")}<p>Date of interview: 01/05/2026</p>${tab("September")}${entries.join("")}</body></html>`;
  }
  const NEHA = { id: 503, studentId: "2612003", firstName: "Neha", lastName: "Rao" };
  const RAVI_DOC = "https://drive.google.com/open?id=ravi-doc";

  function legacyWorkbook() {
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name", "Profile Doc"], [
      ["2612001", "Asha Verma", link("Profile", ASHA_DOC)],
      ["2612002", "Ravi Kumar", link("Profile", RAVI_DOC)],
      ["2612003", "Neha Rao", link("Profile", "https://docs.google.com/document/d/neha-doc/edit")],
    ]);
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Screener Form"], [
      ["2612001", "Asha Verma", null],
      ["2612002", "Ravi Kumar", null],
      ["2612003", "Neha Rao", null],
    ]);
    return workbook;
  }

  function legacyDocs(docs: Record<string, string>) {
    return {
      readProfileDocHtml: (docId: string) => docs[docId] ?? null,
      window: { from: "2026-04-01", to: "2026-10-23" },
    };
  }

  it("with legacy Profile Docs, stores the doc's latest dated conversation only, NULL when it has none", async () => {
    givenDatabase([ASHA, RAVI, NEHA]);
    const docs = legacyDocs({
      // A placeholder date line and a date after as-of do not count.
      "asha-doc": profileDocHtml("<p>Date: Sep 17, 2026</p><p>Talked about mock tests.</p>", "<p>Oct 5, 2026</p>", "<p>Oct 30, 2026: plan</p>"),
      "ravi-doc": profileDocHtml("<p>Spoke about the timetable, no date written.</p>"),
    });

    const report = await runBlendedLinksImport({ workbook: legacyWorkbook(), mode: "apply", legacyProfileDocs: docs });

    expect(report.legacy).toEqual({ dated: 1, no_dates: 1, unreadable: 1, no_doc_link: 0 });
    expect(linksTable.get(501)?.legacy_last_contact_on).toBe("2026-09-17");
    expect(linksTable.get(502)?.legacy_last_contact_on).toBeNull();
    expect(linksTable.get(503)?.legacy_last_contact_on).toBeNull();
    expect(writes.every((params) => params.length === 4)).toBe(true);
  });

  it("is re-runnable: unchanged on a second run, fills a doc once it is shared, keeps a stored date for an unreadable doc", async () => {
    givenDatabase([ASHA, RAVI, NEHA]);
    const asha = profileDocHtml("<p>Sep 17, 2026: called, discussed mocks</p>");
    await runBlendedLinksImport({ workbook: legacyWorkbook(), mode: "apply", legacyProfileDocs: legacyDocs({ "asha-doc": asha }) });

    writes = [];
    const again = await runBlendedLinksImport({
      workbook: legacyWorkbook(), mode: "apply", legacyProfileDocs: legacyDocs({ "asha-doc": asha }),
    });
    expect(again.writes).toEqual({ inserted: 0, updated: 0, unchanged: 3 });
    expect(writes).toEqual([]);

    const shared = await runBlendedLinksImport({
      workbook: legacyWorkbook(), mode: "apply",
      legacyProfileDocs: legacyDocs({ "neha-doc": profileDocHtml("<h2>2 October 2026</h2><p>Parent joined the call.</p>") }),
    });
    expect(shared.legacy).toEqual({ dated: 1, no_dates: 0, unreadable: 2, no_doc_link: 0 });
    expect(shared.writes).toEqual({ inserted: 0, updated: 1, unchanged: 2 });
    expect(linksTable.get(501)?.legacy_last_contact_on).toBe("2026-09-17");
    expect(linksTable.get(503)?.legacy_last_contact_on).toBe("2026-10-02");
  });

  it("dry run with legacy Profile Docs counts outcomes but writes nothing", async () => {
    givenDatabase([ASHA], [
      { student_id: 501, profile_doc_url: null, screener_url: null, legacy_last_contact_on: null },
    ]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name", "Profile Doc"], [["2612001", "Asha Verma", null]]);
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Screener Form"], [["2612001", "Asha Verma", null]]);

    const report = await runBlendedLinksImport({ workbook, mode: "dry-run", legacyProfileDocs: legacyDocs({}) });

    expect(report.legacy).toEqual({ dated: 0, no_dates: 0, unreadable: 0, no_doc_link: 1 });
    expect(writes).toEqual([]);
  });

  it("with legacy Profile Docs, writes no row for a matched Student with no link anywhere", async () => {
    givenDatabase([ASHA]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name", "Profile Doc"], [["2612001", "Asha Verma", null]]);
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Screener Form"], [["2612001", "Asha Verma", null]]);

    const report = await runBlendedLinksImport({ workbook, mode: "apply", legacyProfileDocs: legacyDocs({}) });

    expect(report.legacy).toEqual({ dated: 0, no_dates: 0, unreadable: 0, no_doc_link: 1 });
    expect(report.writes).toEqual({ inserted: 0, updated: 0, unchanged: 0 });
    expect(writes).toEqual([]);
  });

  it("takes a Profile Doc from a hyperlinked name, but never a Screener Link from another column", async () => {
    givenDatabase([ASHA], [
      { student_id: 501, profile_doc_url: null, screener_url: ASHA_SCREENER, legacy_last_contact_on: null },
    ]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name"], [
      ["2612001", link("Asha Verma", ASHA_DOC)],
    ]);
    // No "Screener Form" header: the hyperlinked name is not a Screener Link.
    addSheet(workbook, "Conversation", ["Student ID", "Name", "Notes"], [
      ["2612001", link("Asha Verma", "https://docs.google.com/document/d/unrelated"), "called twice"],
    ]);

    const report = await runBlendedLinksImport({ workbook, mode: "apply" });

    expect(report.issues).toEqual([{ tab: "Conversation", row: 2, studentId: "2612001", reason: "no_link" }]);
    expect(report.counts).toEqual({ matched: 1, unmatched: 0, skipped: 1 });
    expect(linksTable.get(501)).toEqual({
      student_id: 501, profile_doc_url: ASHA_DOC, screener_url: ASHA_SCREENER, legacy_last_contact_on: null,
    });
  });

  it("reads a HYPERLINK() formula's target, not its text", async () => {
    givenDatabase([ASHA]);
    const workbook = new ExcelJS.Workbook();
    const sheet = addSheet(workbook, "Student Profile Docs", ["Student ID", "Profile Doc"], [["2612001", null]]);
    sheet.getCell("B2").value = { formula: `HYPERLINK("${ASHA_DOC}","Open doc")`, result: "Open doc" };

    await runBlendedLinksImport({ workbook, mode: "apply" });

    expect(linksTable.get(501)?.profile_doc_url).toBe(ASHA_DOC);
  });
});

describe("formatBlendedLinksImportReport", () => {
  it("prints counts and issues by row and Student ID, never names or URLs", async () => {
    givenDatabase([ASHA, RAVI]);
    const workbook = new ExcelJS.Workbook();
    addSheet(workbook, "Student Profile Docs", ["Student ID", "Student Name"], [
      ["2612001", link("Asha Verma", ASHA_DOC)],
      ["2612002", link("Ravi Kumar", "http://docs.google.com/document/d/ravi-doc")],
      ["", link("Nobody Here", "https://docs.google.com/document/d/nobody")],
    ]);

    const lines = formatBlendedLinksImportReport(
      await runBlendedLinksImport({ workbook, mode: "dry-run" })
    );

    expect(lines).toEqual([
      "Blended Learning links import (dry-run)",
      "Not read (missing tab or no Student ID / Name header): Conversation",
      "Matched: 1, unmatched: 1, skipped: 1",
      "Writes (would be made): inserted 1, updated 0, unchanged 0",
      "Issues",
      "- Student Profile Docs row 3 (Student ID 2612002): not_https",
      "- Student Profile Docs row 4: no_match",
    ]);
    expect(lines.join("\n")).not.toMatch(/Asha|Ravi|Nobody|docs\.google/);
  });
});

describe("profileDocId", () => {
  it.each([
    ["https://docs.google.com/document/d/1AbC-d_9/edit?usp=sharing", "1AbC-d_9"],
    ["https://drive.google.com/open?id=1AbC-d_9", "1AbC-d_9"],
    ["https://forms.gle/xyz", null],
    [null, null],
  ])("reads the Drive file id from %s", (url, expected) => {
    expect(profileDocId(url)).toBe(expected);
  });
});

describe("legacyDateWindow", () => {
  it("runs from the academic year's first day to as-of", () => {
    expect(legacyDateWindow("2026-10-23")).toEqual({ from: "2026-04-01", to: "2026-10-23" });
  });
});

describe("formatBlendedLinksImportReport with legacy Profile Docs", () => {
  it("adds one line of legacy outcome counts", () => {
    const lines = formatBlendedLinksImportReport({
      mode: "apply",
      legacy: { dated: 5, no_dates: 2, unreadable: 3, no_doc_link: 1 },
      legacyConversations: null,
      legacyConversationIssues: [],
      profileDocActionItems: null,
      profileDocActionItemChanges: [],
      unreadTabs: [],
      counts: { matched: 11, unmatched: 0, skipped: 0 },
      writes: { inserted: 0, updated: 5, unchanged: 6 },
      issues: [],
    });
    expect(lines).toContain(
      "Legacy last contact (Profile Docs only): dated 5, NULL with no dated conversation 2, " +
        "unreadable (no export; stored value kept) 3, no Profile Doc link 1"
    );
  });
});

describe("runBlendedLinksImport with legacy conversations", () => {
  // Synthetic Profile Doc exports and summaries only.
  function profileDocHtml(...entries: string[]) {
    const tab = (title: string) => `<p class="title"><span>${title}</span></p>`;
    return `<html><body>${tab("Student Interview")}<p>Notes</p>${tab("September")}${entries.join("")}</body></html>`;
  }
  const NEHA = { id: 503, studentId: "2612003", firstName: "Neha", lastName: "Rao" };
  const KIRAN = { id: 504, studentId: "2612004", firstName: "Kiran", lastName: "Das" };
  const MOHIT = { id: 505, studentId: "2612005", firstName: "Mohit", lastName: "Jain" };
  const STUDENTS = [ASHA, RAVI, NEHA, KIRAN, MOHIT];

  function workbook() {
    const book = new ExcelJS.Workbook();
    addSheet(book, "Student Profile Docs", ["Student ID", "Student Name", "Profile Doc"],
      STUDENTS.map((s) => [s.studentId, `${s.firstName} ${s.lastName}`,
        link("Profile", `https://docs.google.com/document/d/${s.firstName.toLowerCase()}-doc`)]));
    addSheet(book, "Conversation", ["Student ID", "Name", "Screener Form"], []);
    return book;
  }

  const SEP_17 = profileDocHtml("<p>Sep 17, 2026: called</p><p>Talked about mock tests.</p>");
  const items = [
    { text: "Synthetic: revise optics", owner: "student" },
    { text: "Synthetic: send the timetable", owner: "mentor" },
  ];

  function docs(html: Record<string, string>, file: unknown) {
    return {
      readProfileDocHtml: (docId: string) => html[docId] ?? null,
      window: { from: "2026-04-01", to: "2026-10-23" },
      conversations: parseLegacyConversations(file),
    };
  }

  const FILE = {
    "asha-doc": { occurredOn: "2026-09-17", summary: "  Synthetic: planned mocks.  ", actionItems: items },
    // A summary of an older entry: the doc's latest is Sep 17.
    "ravi-doc": { occurredOn: "2026-09-01", summary: "Synthetic: older.", actionItems: [] },
    "kiran-doc": { occurredOn: "2026-09-17", summary: "Synthetic: no items.", actionItems: [] },
    "mohit-doc": { occurredOn: "2026-09-17", summary: "Synthetic", actionItems: [{ text: "x", owner: "teacher" }] },
    "nobody-doc": { occurredOn: "2026-09-17", summary: "Synthetic: unused.", actionItems: [] },
  };

  const asItems = (studentId: number) =>
    itemsTable
      .filter((item) => item.student_id === studentId)
      .sort((a, b) => a.position - b.position)
      .map(({ text, owner, status, position }) => ({ position, text, owner, status }));

  it("loads a dated doc's summary only for that date, NULL otherwise, its items as open Action Items, and reports by Student ID", async () => {
    givenDatabase(STUDENTS);
    const report = await runBlendedLinksImport({
      workbook: workbook(),
      mode: "apply",
      // Neha's doc is read but has no summary in the file.
      legacyProfileDocs: docs(
        { "asha-doc": SEP_17, "ravi-doc": SEP_17, "neha-doc": SEP_17, "kiran-doc": SEP_17, "mohit-doc": SEP_17 },
        FILE
      ),
    });

    expect(report.legacyConversations).toEqual({
      loaded: 2, summary_missing: 1, summary_stale: 1, summary_invalid: 1, unused: 1,
    });
    expect(report.legacyConversationIssues).toEqual([{ studentId: "2612005", reason: "bad_action_item" }]);
    expect(linksTable.get(501)).toMatchObject({
      legacy_last_contact_on: "2026-09-17",
      legacy_conversation_summary: "Synthetic: planned mocks.",
    });
    expect(asItems(501)).toEqual([
      { position: 1, ...items[0], status: "open" },
      { position: 2, ...items[1], status: "open" },
    ]);
    expect(linksTable.get(504)).toMatchObject({ legacy_conversation_summary: "Synthetic: no items." });
    for (const id of [502, 503, 505]) expect(linksTable.get(id)).toMatchObject({ legacy_conversation_summary: null });
    expect(itemsTable.every((item) => item.student_id === 501)).toBe(true);
    expect(report.profileDocActionItems).toEqual({ inserted: 2, kept: 0, removed: 0 });
    expect(report.profileDocActionItemChanges).toEqual([{ studentId: "2612001", inserted: 2, kept: 0, removed: 0 }]);

    const lines = formatBlendedLinksImportReport(report);
    expect(lines).toContain(
      "Legacy conversation (dated Profile Docs): loaded 2, NULL with no summary for the doc 1, " +
        "NULL with a summary of another date 1, NULL with an invalid summary 1; file entries no dated doc used 1"
    );
    expect(lines).toContain(
      "Profile Doc action items: inserted 2, kept 0, removed 0 (removed: open ones no longer in the doc; done ones are kept)"
    );
    expect(lines).toContain("- Student ID 2612001: inserted 2, kept 0, removed 0");
    expect(lines.slice(-2)).toEqual(["Invalid legacy conversations (left NULL)", "- Student ID 2612005: bad_action_item"]);
    expect(lines.join("\n")).not.toMatch(/Synthetic|-doc|mock|optics/);
  });

  it("is re-runnable, clears the summary and open items when the doc has no dated entry, and keeps both when it is unreadable", async () => {
    givenDatabase([ASHA, RAVI]);
    const file = {
      "asha-doc": FILE["asha-doc"],
      "ravi-doc": { occurredOn: "2026-09-17", summary: "Synthetic: Ravi.", actionItems: items },
    };
    const run = (html: Record<string, string>) =>
      runBlendedLinksImport({ workbook: workbook(), mode: "apply", legacyProfileDocs: docs(html, file) });

    await run({ "asha-doc": SEP_17, "ravi-doc": SEP_17 });
    writes = [];
    itemWrites = [];
    const again = await run({ "asha-doc": SEP_17, "ravi-doc": SEP_17 });
    expect(again.writes).toEqual({ inserted: 0, updated: 0, unchanged: 2 });
    expect(again.profileDocActionItems).toEqual({ inserted: 0, kept: 4, removed: 0 });
    expect(again.profileDocActionItemChanges).toEqual([]);
    expect(writes).toEqual([]);
    // Only a no-op position check: nothing inserted or deleted.
    expect(itemWrites).toEqual(["update"]);

    // Asha's first item was ticked done by a Conversation.
    itemsTable.find((item) => item.student_id === 501 && item.position === 1)!.status = "done";
    // Asha's doc now has no dated entry; Ravi's export is missing.
    const later = await run({ "asha-doc": profileDocHtml("<p>No dates any more.</p>") });
    expect(later.legacy).toMatchObject({ no_dates: 1, unreadable: 1 });
    expect(later.legacyConversations).toMatchObject({ loaded: 0, unused: 2 });
    expect(linksTable.get(501)).toMatchObject({ legacy_last_contact_on: null, legacy_conversation_summary: null });
    expect(asItems(501)).toEqual([{ position: 1, ...items[0], status: "done" }]);
    expect(later.profileDocActionItemChanges).toEqual([{ studentId: "2612001", inserted: 0, kept: 0, removed: 1 }]);
    expect(linksTable.get(502)).toMatchObject({ legacy_conversation_summary: "Synthetic: Ravi." });
    expect(asItems(502)).toHaveLength(2);
  });

  it("keeps matching items (open or done), inserts new ones and removes only open ones the doc dropped", async () => {
    givenDatabase(
      [ASHA],
      [
        {
          student_id: 501, profile_doc_url: "https://docs.google.com/document/d/asha-doc", screener_url: null,
          legacy_last_contact_on: "2026-09-17", legacy_conversation_summary: "Synthetic: planned mocks.",
        },
      ],
      [
        { id: 11, student_id: 501, position: 1, ...items[0], status: "done" },
        { id: 12, student_id: 501, position: 2, ...items[1], status: "open" },
        { id: 13, student_id: 501, position: 3, text: "Synthetic: dropped but done", owner: "parent", status: "done" },
      ]
    );
    // The summariser reworded the second item and put a new one first.
    const reworded = [
      { text: "Synthetic: call the parent", owner: "mentor" },
      items[0],
      { text: "Synthetic: send the timetable today", owner: "mentor" },
    ];
    const run = (mode: "dry-run" | "apply") =>
      runBlendedLinksImport({
        workbook: workbook(),
        mode,
        legacyProfileDocs: docs({ "asha-doc": SEP_17 }, { "asha-doc": { ...FILE["asha-doc"], actionItems: reworded } }),
      });

    const dry = await run("dry-run");
    expect(dry.profileDocActionItems).toEqual({ inserted: 2, kept: 1, removed: 1 });
    expect(formatBlendedLinksImportReport(dry)).toContain(
      "Profile Doc action items (would be): inserted 2, kept 1, removed 1 (removed: open ones no longer in the doc; done ones are kept)"
    );
    expect(itemWrites).toEqual([]);

    const applied = await run("apply");
    expect(applied.writes).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(applied.profileDocActionItemChanges).toEqual([{ studentId: "2612001", inserted: 2, kept: 1, removed: 1 }]);
    expect(itemsTable.map((item) => item.id).sort()).toEqual([11, 13, 14, 15]);
    expect(asItems(501)).toEqual([
      { position: 1, ...reworded[0], status: "open" },
      { position: 2, ...items[0], status: "done" },
      { position: 3, text: "Synthetic: dropped but done", owner: "parent", status: "done" },
      { position: 3, ...reworded[2], status: "open" },
    ]);
  });

  it("dry run counts what it would load and writes nothing", async () => {
    givenDatabase([ASHA]);
    const report = await runBlendedLinksImport({
      workbook: workbook(),
      mode: "dry-run",
      legacyProfileDocs: docs({ "asha-doc": SEP_17 }, { "asha-doc": FILE["asha-doc"] }),
    });
    expect(report.legacyConversations).toMatchObject({ loaded: 1 });
    expect(report.writes).toEqual({ inserted: 1, updated: 0, unchanged: 0 });
    expect(report.profileDocActionItems).toEqual({ inserted: 2, kept: 0, removed: 0 });
    expect(writes).toEqual([]);
    expect(itemWrites).toEqual([]);
  });

  it("writes the summary and items only with a conversations file", async () => {
    givenDatabase(
      [ASHA],
      [
        {
          student_id: 501, profile_doc_url: "https://docs.google.com/document/d/asha-doc", screener_url: null,
          legacy_last_contact_on: "2026-09-17", legacy_conversation_summary: "Synthetic: kept.",
        },
      ],
      [{ id: 11, student_id: 501, position: 1, ...items[0], status: "open" }]
    );
    const report = await runBlendedLinksImport({
      workbook: workbook(),
      mode: "apply",
      legacyProfileDocs: { readProfileDocHtml: () => SEP_17, window: { from: "2026-04-01", to: "2026-10-23" } },
    });
    expect(report.legacyConversations).toBeNull();
    expect(report.profileDocActionItems).toBeNull();
    expect(report.writes).toEqual({ inserted: 0, updated: 0, unchanged: 1 });
    expect(linksTable.get(501)?.legacy_conversation_summary).toBe("Synthetic: kept.");
    expect(itemsTable).toHaveLength(1);
    expect(itemWrites).toEqual([]);
  });

  it("names a Student without a Student ID in an invalid entry's issue", () => {
    const lines = formatBlendedLinksImportReport({
      mode: "dry-run",
      legacy: { dated: 1, no_dates: 0, unreadable: 0, no_doc_link: 0 },
      legacyConversations: { loaded: 0, summary_missing: 0, summary_stale: 0, summary_invalid: 1, unused: 0 },
      legacyConversationIssues: [{ studentId: null, reason: "blank_summary" }],
      profileDocActionItems: { inserted: 0, kept: 0, removed: 1 },
      profileDocActionItemChanges: [{ studentId: null, inserted: 0, kept: 0, removed: 1 }],
      unreadTabs: [],
      counts: { matched: 1, unmatched: 0, skipped: 0 },
      writes: { inserted: 0, updated: 1, unchanged: 0 },
      issues: [],
    });
    expect(lines.at(-1)).toBe("- Student without a Student ID: blank_summary");
  });
});
