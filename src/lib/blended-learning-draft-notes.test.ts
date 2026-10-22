import { describe, expect, it } from "vitest";

import { draftNotesToHtml } from "./blended-learning-draft-notes";

describe("draftNotesToHtml", () => {
  it("turns each drafted section into a heading and a bulleted list", () => {
    expect(
      draftNotesToHtml([
        { heading: "Study plan", points: ["Revise optics", "Two mock tests a week"] },
        { heading: "Family", points: ["Father works nights"] },
      ])
    ).toBe(
      "<h3>Study plan</h3><ul><li>Revise optics</li><li>Two mock tests a week</li></ul>" +
        "<h3>Family</h3><ul><li>Father works nights</li></ul>"
    );
  });

  it("escapes the drafted text so it enters the editor as text, not markup", () => {
    expect(
      draftNotesToHtml([
        { heading: "Marks <b>& ranks</b>", points: ['<script>alert("x")</script>', "Scored >90 in 'maths'"] },
      ])
    ).toBe(
      "<h3>Marks &lt;b&gt;&amp; ranks&lt;/b&gt;</h3>" +
        "<ul><li>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</li><li>Scored &gt;90 in &#39;maths&#39;</li></ul>"
    );
  });

  it("leaves out a heading's list when it has no points", () => {
    expect(draftNotesToHtml([{ heading: "Nothing else", points: [] }])).toBe("<h3>Nothing else</h3>");
  });

  it("gives empty notes for no drafted notes", () => {
    expect(draftNotesToHtml(null)).toBe("");
    expect(draftNotesToHtml([])).toBe("");
  });
});
