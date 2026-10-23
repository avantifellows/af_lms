// The latest dated conversation in a Blended Learning Profile Doc, read from
// the doc's Google Docs HTML export (File → Download → Web page, or the Drive
// API export as text/html). Pure and deterministic: no network, no LLM.
//
// The export renders every Docs tab's title as a `class="title"` paragraph.
// Tab 1 is the intake / profile and tab 2 the Student Story; those tabs are
// skipped by title. In the other tabs a conversation date is a paragraph,
// heading or tab title that starts with a full date ("Sep 3, 2026",
// "Date: Sep 3, 2026", "3 September 2026", "03/09/2026", "2026-09-03", a Meet
// notes header "abc-defg-hij (2026-09-03 16:05 …"), or a call recording ("…
// -2609031615.mp3", or a Meet chip "… - 2026/09/03 16:15 GMT+05:30 – Recording").
// A date without a year ("17 October") is never read: G13 docs carry the
// previous year's history in year-less tabs, and a wrong recent date would
// hide a Student from Talk to first. Dates inside tables (pasted data exports) or mid-sentence
// are never read. A date line with nothing under it (a placeholder) does not
// count, and neither does a date outside [from, to].

type DocBlock = { text: string; tabTitle: boolean; inTable: boolean; hasImage: boolean };

const BLOCK_TAGS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"]);

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", rsquo: "'", lsquo: "'",
  ldquo: '"', rdquo: '"', ndash: "–", mdash: "—", hellip: "…",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] !== "#") return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
    const value = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(value) ? String.fromCodePoint(value) : whole;
  });
}

// Splits the export into paragraph-level blocks, noting tab titles, table
// cells and images.
class BlockReader {
  readonly blocks: DocBlock[] = [];
  private current: DocBlock | null = null;
  private tableDepth = 0;

  private flush(): void {
    const block = this.current;
    this.current = null;
    if (!block) return;
    block.text = block.text.replace(/\s+/g, " ").trim();
    if (block.text || block.hasImage) this.blocks.push(block);
  }

  private open(tabTitle: boolean): void {
    this.flush();
    this.current = { text: "", tabTitle, inTable: this.tableDepth > 0, hasImage: false };
  }

  tag(closing: boolean, name: string, attributes: string): void {
    if (name === "table") {
      this.flush();
      this.tableDepth = Math.max(0, this.tableDepth + (closing ? -1 : 1));
    } else if (BLOCK_TAGS.has(name)) {
      if (closing) this.flush();
      else this.open(name === "p" && /class="(?:[^"]*\s)?title(?:\s[^"]*)?"/.test(attributes));
    } else if (name === "img" && !closing) {
      if (!this.current) this.open(false);
      this.current!.hasImage = true;
    } else if (name === "br" && this.current) {
      this.current.text += " ";
    }
  }

  text(raw: string): void {
    if (!this.current) {
      if (!raw.trim()) return;
      this.open(false);
    }
    this.current!.text += decodeEntities(raw);
  }

  done(): DocBlock[] {
    this.flush();
    return this.blocks;
  }
}

function docBlocks(html: string): DocBlock[] {
  const body = html.replace(/<(head|style|script)\b[\s\S]*?<\/\1>/gi, "");
  const reader = new BlockReader();
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>|([^<]+)/g)) {
    if (match[4] !== undefined) reader.text(match[4]);
    else reader.tag(match[1] === "/", match[2].toLowerCase(), match[3]);
  }
  return reader.done();
}

const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_NUMBER: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

type DatePattern = { pattern: RegExp; parts: (m: RegExpMatchArray) => [string, string, string] };

// Each pattern matches only at the start of a block; parts are [year, month, day].
const LEADING_DATES: DatePattern[] = [
  { pattern: new RegExp(`^${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "i"), parts: (m) => [m[3], m[1], m[2]] },
  { pattern: new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?,?\\s+(\\d{4})\\b`, "i"), parts: (m) => [m[3], m[2], m[1]] },
  { pattern: /^(\d{4})-(\d{2})-(\d{2})\b/, parts: (m) => [m[1], m[2], m[3]] },
  // Day first, as written in India.
  { pattern: /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/, parts: (m) => [m[3], m[2], m[1]] },
  // A Gemini Meet-notes header: Meet code, then the meeting's timestamp.
  { pattern: /^[a-z]{3}-[a-z]{4}-[a-z]{3}\s*\((\d{4})-(\d{2})-(\d{2})/i, parts: (m) => [m[1], m[2], m[3]] },
];

// A call recording: a file name ending in -YYMMDDhhmm, or a Meet recording
// or notes chip "<meeting> - YYYY/MM/DD hh:mm <zone> – Recording".
const RECORDINGS: DatePattern[] = [
  { pattern: /-(\d{2})(\d{2})(\d{2})\d{4}\.(?:mp3|m4a|wav)\b/i, parts: (m) => [`20${m[1]}`, m[2], m[3]] },
  {
    pattern: /\b(\d{4})\/(\d{2})\/(\d{2}) \d{1,2}:\d{2}\b.{0,20}?[–-]\s*(?:recording|transcript|notes by gemini)\b/i,
    parts: (m) => [m[1], m[2], m[3]],
  },
];

const MONTH_ONLY = new RegExp(`^${MONTH}\\.?(?:[\\s,'’-]+(?:20)?\\d{2})?$`, "i");

const SKIPPED_TAB = /\b(interview|profile|basic|information|details|story|case)\b/i;

function monthNumber(month: string): number {
  return /^\d+$/.test(month) ? Number(month) : MONTH_NUMBER[month.slice(0, 3).toLowerCase()];
}

function isoDate(year: string, month: string, day: string): string | null {
  const y = Number(year);
  const m = monthNumber(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

type Anchor = { date: string; ownContent: boolean };

function leadingDate(text: string): Anchor | null {
  const unlabelled = text.replace(/^date\s*[:\-–]?\s*/i, "");
  for (const { pattern, parts } of LEADING_DATES) {
    const match = unlabelled.match(pattern);
    if (!match) continue;
    const date = isoDate(...parts(match));
    if (!date) return null;
    // Text after the date ("Sep 3, 2026: parent call") is the entry itself.
    return { date, ownContent: /[a-z]{2}/i.test(unlabelled.slice(match[0].length)) };
  }
  return null;
}

function recordingDate(text: string): Anchor | null {
  for (const { pattern, parts } of RECORDINGS) {
    const match = text.match(pattern);
    const date = match ? isoDate(...parts(match)) : null;
    if (date) return { date, ownContent: true };
  }
  return null;
}

function blockAnchor(block: DocBlock): Anchor | null {
  if (block.inTable) return null;
  return leadingDate(block.text) ?? recordingDate(block.text);
}

function isContent(block: DocBlock): boolean {
  return block.hasImage || (/[a-z]{2}/i.test(block.text) && !MONTH_ONLY.test(block.text));
}

function splitTabs(blocks: DocBlock[]): DocBlock[][] {
  const tabs: DocBlock[][] = [[]];
  for (const block of blocks) {
    if (block.tabTitle) tabs.push([]);
    tabs[tabs.length - 1].push(block);
  }
  return tabs.filter((tab) => tab.length > 0);
}

// The intake / profile and Student Story tabs, by title. A tab titled with a
// date is a conversation, whatever else its title says.
function isSkippedTab(tab: DocBlock[]): boolean {
  const title = tab[0].tabTitle ? tab[0].text : null;
  return title !== null && !leadingDate(title) && SKIPPED_TAB.test(title);
}

// Usually the academic year's first day to today.
export type DateWindow = { from: string; to: string };

// Dates of the tab's entries that have something under them. Repeated date
// lines for one entry (a chip line duplicated, a dated tab title then the
// same date again) are one entry.
function tabEntryDates(tab: DocBlock[]): string[] {
  const dates: string[] = [];
  let pending: Anchor | null = null;
  const settle = () => {
    if (pending?.ownContent) dates.push(pending.date);
  };
  for (const block of tab) {
    const anchor = blockAnchor(block);
    if (anchor && pending?.date === anchor.date) {
      pending.ownContent ||= anchor.ownContent;
    } else if (anchor) {
      settle();
      pending = { ...anchor };
    } else if (pending && isContent(block)) {
      pending.ownContent = true;
    }
  }
  settle();
  return dates;
}

// The latest conversation date in the doc within the window, or null.
export function latestProfileDocConversationOn(html: string, window: DateWindow): string | null {
  let latest: string | null = null;
  for (const tab of splitTabs(docBlocks(html))) {
    if (isSkippedTab(tab)) continue;
    for (const date of tabEntryDates(tab)) {
      if (date >= window.from && date <= window.to && (latest === null || date > latest)) latest = date;
    }
  }
  return latest;
}
