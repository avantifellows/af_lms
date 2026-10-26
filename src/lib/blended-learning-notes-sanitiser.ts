import sanitizeHtml from "sanitize-html";

// Blended Learning notes sanitiser (server-only). The only path to a
// Conversation's `notes_html`: an allowlist of p, h3, b, i, ul, ol, li, table,
// tr, th, td and br with no attributes and no links. Disallowed tags are
// dropped but keep their text; script and style bodies are dropped whole.

const NOTES_MAX_BYTES = 100 * 1024;

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "h3", "b", "i", "ul", "ol", "li", "table", "tr", "th", "td", "br"],
  allowedAttributes: {},
  allowedSchemes: [],
  transformTags: { strong: "b", em: "i" },
};

export type SanitisedNotes = { ok: true; html: string | null } | { ok: false; error: string };

function hasText(html: string): boolean {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").trim() !== "";
}

// Null when there is nothing left to store (no notes, an empty editor).
export function sanitiseNotesHtml(input: string | null | undefined): SanitisedNotes {
  if (!input) return { ok: true, html: null };
  if (Buffer.byteLength(input, "utf8") > NOTES_MAX_BYTES) {
    return { ok: false, error: "Notes must be 100 KB or less." };
  }
  const html = sanitizeHtml(input, OPTIONS);
  return { ok: true, html: hasText(html) ? html : null };
}
