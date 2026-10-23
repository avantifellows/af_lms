import { describe, expect, it } from "vitest";

import { latestProfileDocConversationOn } from "./blended-learning-profile-doc-dates";

// Synthetic Google Docs HTML exports: each Docs tab title is a class="title"
// paragraph. No real Profile Doc content.
const WINDOW = { from: "2026-04-01", to: "2026-10-23" };

function tab(title: string): string {
  return `<p class="c3 title" id="h.x"><span class="c1">${title}</span></p>`;
}

function doc(...parts: string[]): string {
  return `<html><head><style>.title{font-size:26pt} p{margin:0}</style></head><body class="doc-content">${parts.join("")}</body></html>`;
}

function latest(...parts: string[]): string | null {
  return latestProfileDocConversationOn(doc(...parts), WINDOW);
}

describe("latestProfileDocConversationOn", () => {
  it.each([
    ["a date chip with a colon", "<p><span>Sep 3, 2026:</span></p><p>Talked about the mock test.</p>", "2026-09-03"],
    ["a Date: label", "<p>Date: Sep 24, 2026</p><h3>Action points:</h3><ul><li>Revise organic</li></ul>", "2026-09-24"],
    ["day month year as a heading", "<h2>9 July 2026</h2><p>Session notes</p>", "2026-07-09"],
    ["an ordinal and a comma", "<p>6th August, 2026</p><p>Called the parent.</p>", "2026-08-06"],
    ["day-first numbers", "<p>12/09/2026 - discussed the timetable</p>", "2026-09-12"],
    ["an ISO date", "<p>2026-08-14 call</p>", "2026-08-14"],
    ["a Meet notes header", "<p>abc-defg-hij (2026-07-21 17:24 GMT+5:30)</p><h1>Mentorship Session Notes</h1>", "2026-07-21"],
    ["a recording file name", "<p>Recording : call-2608191839.mp3</p>", "2026-08-19"],
    ["a Meet recording chip", "<p>Student_Interaction - 2026/07/09 16:33 GMT+05:30 – Recording</p>", "2026-07-09"],
    ["a text entry after the date on the same line", "<p>Jul 9, 2026: parent and student on the call</p>", "2026-07-09"],
  ])("reads %s", (_label, entries, expected) => {
    expect(latest(tab("Student Interview"), "<p>Notes</p>", tab("September"), entries)).toBe(expected);
  });

  it("takes the latest date across tabs, whatever their order in the doc", () => {
    expect(
      latest(
        tab("October"), "<p>Date: Oct 8, 2026</p><p>Mentorship summary</p>",
        tab("September"), "<p>Date: Sep 24, 2026</p><p>Notes</p><p>Date: Sep 15, 2026</p><p>Notes</p>"
      )
    ).toBe("2026-10-08");
  });

  it("uses a tab titled with a date as the entry's date", () => {
    expect(latest(tab("Sep 21, 2026 Mentor : Student call"), "<p>The call covered the test plan.</p>")).toBe("2026-09-21");
  });

  it("skips the intake and Student Story tabs", () => {
    expect(
      latest(
        tab("Interview / Profile"), "<p>Oct 1, 2026: interview held</p>",
        tab("Student Story"), "<p>Date: Oct 2, 2026</p><p>Story</p>",
        tab("Basic Details"), "<p>2026-10-03 form</p>",
        tab("Tab 3")
      )
    ).toBeNull();
  });

  it("never reads dates inside tables or mid-sentence", () => {
    expect(
      latest(
        tab("September"),
        "<table><tr><td><p>Oct 10, 2026, 9:00 AM</p></td><td><p>Test attempted</p></td></tr></table>",
        "<p>She has a test on Oct 12, 2026 and will call after.</p>"
      )
    ).toBeNull();
  });

  it("ignores a date line with nothing under it, and a month-only heading is not content", () => {
    expect(latest(tab("August"), "<p>Jul 30, 2026</p><p>Notes</p><p>Aug 22, 2026</p>")).toBe("2026-07-30");
    expect(latest(tab("Log"), "<p>Jul 30, 2026</p><p>Notes</p><p>Aug 22, 2026</p>", tab("September 2026"))).toBe("2026-07-30");
    expect(latest(tab("Log"), "<p>Aug 22, 2026</p><p>September</p>")).toBeNull();
  });

  it("treats a duplicated chip line for one date as one entry", () => {
    expect(latest(tab("Log"), "<p>Sep 3, 2026</p><p>Sep 3, 2026</p><p>Notes</p>")).toBe("2026-09-03");
  });

  it("ignores dates outside the window and impossible dates", () => {
    expect(
      latest(
        tab("Log"),
        "<p>Oct 30, 2026: planned call</p>",
        "<p>Mar 3, 2026: last year</p>",
        "<p>31/09/2026 call</p>",
        "<p>31/09 call</p>"
      )
    ).toBeNull();
  });

  it.each([
    ["day month", "<p>17 October</p><p>Notes</p>", "2026-10-17"],
    ["an ordinal and a short month", "<p>Date: 5th Sept</p><p>Notes</p>", "2026-09-05"],
    ["month day", "<p>Oct 7: called the parent</p>", "2026-10-07"],
    ["day-first numbers", "<p>17/10 - discussed the timetable</p>", "2026-10-17"],
  ])("reads a date without a year (%s) as the academic year's", (_label, entries, expected) => {
    expect(latest(tab("Log"), entries)).toBe(expected);
  });

  it("drops a year-less date after the as-of date, and never reads a decimal or a two-digit year as one", () => {
    expect(latest(tab("Log"), "<p>Jul 2, 2026</p><p>Notes</p>", "<p>30 October</p><p>Planned call</p>")).toBe("2026-07-02");
    expect(latest(tab("Log"), "<p>3.5 hours of revision</p>", "<p>17/10/26 call</p>", "<p>Oct 17 25 call</p>")).toBeNull();
  });

  it("skips the year-less dates in a tab of last year's history", () => {
    expect(
      latest(
        tab("Grade 12 log"), "<p>Aug 4, 2025: first call</p>", "<p>17 September</p><p>Notes</p>",
        tab("Grade 13 log"), "<p>6 July</p><p>Notes</p>"
      )
    ).toBe("2026-07-06");
  });

  it("counts an image under a date as content and decodes entities", () => {
    expect(latest(tab("Log"), '<p>Sep&nbsp;5,&#32;2026</p><p><img src="data:image/png;base64,AAAA"></p>')).toBe("2026-09-05");
  });

  it("reads a doc with no tabs at all", () => {
    expect(latestProfileDocConversationOn("<p>Sep 1, 2026</p><p>First call</p>", WINDOW)).toBe("2026-09-01");
    expect(latestProfileDocConversationOn("", WINDOW)).toBeNull();
  });
});
