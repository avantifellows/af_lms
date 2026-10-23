import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ query: vi.fn() }));

import { query } from "./db";
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
}

let linksTable: Map<number, LinkRow>;
let writes: unknown[][];

function givenDatabase(mapped: MappedStudent[], links: LinkRow[] = []) {
  linksTable = new Map(links.map((l) => [l.student_id, { ...l }]));
  writes = [];
  mockQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
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
      const [studentId, profileDocUrl, screenerUrl, legacyOn] = params as [
        number, string | null, string | null, string | null | undefined,
      ];
      const existing = linksTable.get(studentId);
      linksTable.set(studentId, {
        student_id: studentId,
        profile_doc_url: profileDocUrl,
        screener_url: screenerUrl,
        legacy_last_contact_on: /legacy_last_contact_on/.test(sql)
          ? (legacyOn ?? null)
          : (existing?.legacy_last_contact_on ?? null),
      });
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
