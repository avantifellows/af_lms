import { describe, expect, it } from "vitest";
import { sanitiseNotesHtml } from "./blended-learning-notes-sanitiser";

// The notes sanitiser's rule table: the allowlist is p, h3, b, i, ul, ol, li,
// table, tr, th, td, br with no attributes and no links.

describe("sanitiseNotesHtml", () => {
  it.each([
    ["paragraphs and line breaks", "<p>Line one<br>Line two</p>", "<p>Line one<br />Line two</p>"],
    ["headings, bold and italic", "<h3>Exams</h3><p><b>Revise</b> <i>optics</i></p>", "<h3>Exams</h3><p><b>Revise</b> <i>optics</i></p>"],
    ["both list kinds", "<ul><li>One</li></ul><ol><li>Two</li></ol>", "<ul><li>One</li></ul><ol><li>Two</li></ol>"],
    [
      "a table",
      "<table><tr><th>Subject</th></tr><tr><td>Maths</td></tr></table>",
      "<table><tr><th>Subject</th></tr><tr><td>Maths</td></tr></table>",
    ],
  ])("keeps allowed tags: %s", (_case, input, expected) => {
    expect(sanitiseNotesHtml(input)).toEqual({ ok: true, html: expected });
  });

  it.each([
    ["strong becomes b", "<p><strong>Key</strong></p>", "<p><b>Key</b></p>"],
    ["em becomes i", "<p><em>aside</em></p>", "<p><i>aside</i></p>"],
  ])("normalises %s", (_case, input, expected) => {
    expect(sanitiseNotesHtml(input)).toEqual({ ok: true, html: expected });
  });

  it.each([
    ["a script and its body", "<p>Hi</p><script>alert(1)</script>", "<p>Hi</p>"],
    ["a style element and its body", "<style>p{color:red}</style><p>Hi</p>", "<p>Hi</p>"],
    ["inline styles and other attributes", '<p style="color:red" class="x" onclick="steal()">Hi</p>', "<p>Hi</p>"],
    ["table cell attributes", '<table><tr><td colspan="2" rowspan="1">A</td></tr></table>', "<table><tr><td>A</td></tr></table>"],
    ["a link, keeping its text", '<p>See <a href="javascript:alert(1)">this</a></p>', "<p>See this</p>"],
    ["an image", '<p>Hi<img src="x" onerror="alert(1)"></p>', "<p>Hi</p>"],
    ["other headings and wrappers, keeping their text", "<h1>Title</h1><div><span>Body</span></div>", "TitleBody"],
    ["an editor's tbody and colgroup", "<table><colgroup><col></colgroup><tbody><tr><td>A</td></tr></tbody></table>", "<table><tr><td>A</td></tr></table>"],
  ])("strips %s", (_case, input, expected) => {
    expect(sanitiseNotesHtml(input)).toEqual({ ok: true, html: expected });
  });

  it.each([
    ["missing notes", undefined],
    ["null notes", null],
    ["an empty string", ""],
    ["an empty editor paragraph", "<p></p>"],
    ["whitespace and line breaks only", "<p> </p><p><br></p>"],
    ["markup that sanitises to nothing", "<script>alert(1)</script>"],
  ])("drops %s to no notes", (_case, input) => {
    expect(sanitiseNotesHtml(input)).toEqual({ ok: true, html: null });
  });

  it("accepts notes of exactly 100 KB", () => {
    const input = `<p>${"a".repeat(100 * 1024 - 7)}</p>`;
    expect(sanitiseNotesHtml(input)).toEqual({ ok: true, html: input });
  });

  it("rejects notes over 100 KB", () => {
    const input = `<p>${"a".repeat(100 * 1024 - 6)}</p>`;
    expect(sanitiseNotesHtml(input)).toEqual({ ok: false, error: "Notes must be 100 KB or less." });
  });

  it("counts the 100 KB cap in bytes, not characters", () => {
    // "अ" is 3 bytes in UTF-8.
    const input = `<p>${"अ".repeat(34_200)}</p>`;
    expect(sanitiseNotesHtml(input)).toEqual({ ok: false, error: "Notes must be 100 KB or less." });
  });
});
