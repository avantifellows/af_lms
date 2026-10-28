import { latestProfileDocEntry, type DateWindow } from "./blended-learning-profile-doc-dates";

// Operator-run export of each Profile Doc's latest dated conversation as
// plain text, keyed by Drive file id, for an external summarising step
// (not in this repo) that writes the importer's --legacy-conversations file.
// Run by scripts/export-latest-profile-doc-entries.ts. Pure: the script
// reads the HTML exports and writes the result. The text is minors' records,
// so only counts are ever printed.

export type LatestProfileDocEntries = Record<string, { occurredOn: string; text: string }>;

export interface ProfileDocExportCounts {
  // HTML exports read.
  docs: number;
  // With a dated conversation in the window: exported.
  dated: number;
  // Read, with no dated conversation: left out.
  noDates: number;
  // Files in the directory not named <Drive file id>.html: not read.
  skippedFiles: number;
}

const EXPORT_FILE = /^([A-Za-z0-9_-]+)\.html$/;

// The Drive file ids of the HTML exports among a directory's file names,
// sorted, and how many other files there were.
export function profileDocExportIds(fileNames: string[]): { docIds: string[]; skippedFiles: number } {
  const docIds = fileNames.flatMap((name) => EXPORT_FILE.exec(name)?.[1] ?? []).sort();
  return { docIds, skippedFiles: fileNames.length - docIds.length };
}

export function exportLatestProfileDocEntries(
  docIds: string[],
  readProfileDocHtml: (docId: string) => string,
  window: DateWindow
): { entries: LatestProfileDocEntries; counts: Omit<ProfileDocExportCounts, "skippedFiles"> } {
  const entries: LatestProfileDocEntries = {};
  for (const docId of docIds) {
    const entry = latestProfileDocEntry(readProfileDocHtml(docId), window);
    if (entry) entries[docId] = entry;
  }
  const dated = Object.keys(entries).length;
  return { entries, counts: { docs: docIds.length, dated, noDates: docIds.length - dated } };
}

export function formatProfileDocExportReport(counts: ProfileDocExportCounts): string[] {
  return [
    "Latest Profile Doc entries export",
    `Profile Docs read: ${counts.docs}, exported (dated) ${counts.dated}, left out (no dated conversation) ${counts.noDates}`,
    `Other files skipped (not <Drive file id>.html): ${counts.skippedFiles}`,
  ];
}
