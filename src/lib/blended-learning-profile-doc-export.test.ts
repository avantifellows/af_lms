import { describe, expect, it } from "vitest";

import {
  exportLatestProfileDocEntries,
  formatProfileDocExportReport,
  profileDocExportIds,
} from "./blended-learning-profile-doc-export";

// Synthetic Profile Doc exports only.
const WINDOW = { from: "2026-04-01", to: "2026-10-23" };
const tab = (title: string) => `<p class="title"><span>${title}</span></p>`;

describe("profileDocExportIds", () => {
  it("takes <Drive file id>.html names, sorted, and counts other files", () => {
    expect(profileDocExportIds(["b-2.html", "a_1.html", "notes.txt", ".DS_Store", "bad id.html"])).toEqual({
      docIds: ["a_1", "b-2"],
      skippedFiles: 3,
    });
  });
});

describe("exportLatestProfileDocEntries", () => {
  it("exports each dated doc's latest entry by doc id and counts the rest", () => {
    const html: Record<string, string> = {
      "doc-a": `${tab("September")}<p>Sep 17, 2026: called</p><p>Synthetic: talked about mocks.</p>`,
      "doc-b": `${tab("September")}<p>No dates written.</p>`,
    };
    const { entries, counts } = exportLatestProfileDocEntries(["doc-a", "doc-b"], (id) => html[id], WINDOW);
    expect(entries).toEqual({
      "doc-a": { occurredOn: "2026-09-17", text: "Sep 17, 2026: called\nSynthetic: talked about mocks." },
    });
    expect(counts).toEqual({ docs: 2, dated: 1, noDates: 1 });
  });
});

describe("formatProfileDocExportReport", () => {
  it("prints counts only", () => {
    expect(formatProfileDocExportReport({ docs: 3, dated: 2, noDates: 1, skippedFiles: 4 })).toEqual([
      "Latest Profile Doc entries export",
      "Profile Docs read: 3, exported (dated) 2, left out (no dated conversation) 1",
      "Other files skipped (not <Drive file id>.html): 4",
    ]);
  });
});
